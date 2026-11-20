// Package grpctest: servidor gRPC de teste (o loja.proto, sem código gerado) com server reflection,
// usado nos testes do grpcc e no e2e.
package grpctest

import (
	"context"
	_ "embed"
	"errors"
	"io"
	"net"
	"time"

	"github.com/bufbuild/protocompile"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/reflection"
	rv1 "google.golang.org/grpc/reflection/grpc_reflection_v1"
	rv1alpha "google.golang.org/grpc/reflection/grpc_reflection_v1alpha"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/dynamicpb"
)

//go:embed loja.proto
var lojaProto string

// resolvedor: arquivos do loja.proto e, pros imports, os registrados no Go
type resolver struct{ files *protoregistry.Files }

func (r resolver) FindFileByPath(p string) (protoreflect.FileDescriptor, error) {
	if f, err := r.files.FindFileByPath(p); err == nil {
		return f, nil
	}
	return protoregistry.GlobalFiles.FindFileByPath(p)
}

func (r resolver) FindDescriptorByName(n protoreflect.FullName) (protoreflect.Descriptor, error) {
	if d, err := r.files.FindDescriptorByName(n); err == nil {
		return d, nil
	}
	return protoregistry.GlobalFiles.FindDescriptorByName(n)
}

// Start sobe o servidor em addr ("127.0.0.1:0" = porta livre); devolve o endereço
func Start(addr string) (*grpc.Server, string, error) {
	comp := protocompile.Compiler{Resolver: protocompile.WithStandardImports(&protocompile.SourceResolver{
		Accessor: protocompile.SourceAccessorFromMap(map[string]string{"loja.proto": lojaProto}),
	})}
	files, err := comp.Compile(context.Background(), "loja.proto")
	if err != nil {
		return nil, "", err
	}
	fd := files[0]
	reg := &protoregistry.Files{}
	if err := reg.RegisterFile(fd); err != nil {
		return nil, "", err
	}
	svc := fd.Services().ByName("Loja")
	msg := func(n string) protoreflect.MessageDescriptor { return fd.Messages().ByName(protoreflect.Name(n)) }
	numero := func(n int64) *dynamicpb.Message {
		m := dynamicpb.NewMessage(msg("Numero"))
		m.Set(msg("Numero").Fields().ByName("n"), protoreflect.ValueOfInt64(n))
		return m
	}
	getN := func(m *dynamicpb.Message) int64 { return m.Get(msg("Numero").Fields().ByName("n")).Int() }
	desc := grpc.ServiceDesc{ServiceName: string(svc.FullName()), HandlerType: (*any)(nil),
		Methods: []grpc.MethodDesc{{MethodName: "ObterProduto", Handler: func(_ any, ctx context.Context, dec func(any) error, _ grpc.UnaryServerInterceptor) (any, error) {
			in := dynamicpb.NewMessage(msg("ProdutoReq"))
			if err := dec(in); err != nil {
				return nil, err
			}
			id := in.Get(msg("ProdutoReq").Fields().ByName("id")).String()
			if id == "404" {
				return nil, status.Error(codes.NotFound, "produto 404 não existe")
			}
			_ = grpc.SetHeader(ctx, metadata.Pairs("x-loja", "1"))
			_ = grpc.SetTrailer(ctx, metadata.Pairs("x-fim", "ok"))
			auth := ""
			if md, ok := metadata.FromIncomingContext(ctx); ok && len(md.Get("authorization")) > 0 {
				auth = md.Get("authorization")[0]
			}
			out := dynamicpb.NewMessage(msg("Produto"))
			f := msg("Produto").Fields()
			out.Set(f.ByName("id"), protoreflect.ValueOfString(id))
			out.Set(f.ByName("nome"), protoreflect.ValueOfString("Caneta "+id))
			out.Set(f.ByName("tipo"), protoreflect.ValueOfEnum(1))
			out.Set(f.ByName("auth"), protoreflect.ValueOfString(auth))
			return out, nil
		}}},
		Streams: []grpc.StreamDesc{
			{StreamName: "Contar", ServerStreams: true, Handler: func(_ any, st grpc.ServerStream) error {
				in := dynamicpb.NewMessage(msg("ContarReq"))
				if err := st.RecvMsg(in); err != nil {
					return err
				}
				ate := in.Get(msg("ContarReq").Fields().ByName("ate")).Int()
				for i := int64(1); i <= ate; i++ {
					if err := st.SendMsg(numero(i)); err != nil {
						return err
					}
					time.Sleep(100 * time.Millisecond)
				}
				return nil
			}},
			{StreamName: "Somar", ClientStreams: true, Handler: func(_ any, st grpc.ServerStream) error {
				var soma int64
				for {
					in := dynamicpb.NewMessage(msg("Numero"))
					if err := st.RecvMsg(in); err != nil {
						if errors.Is(err, io.EOF) {
							return st.SendMsg(numero(soma))
						}
						return err
					}
					soma += getN(in)
				}
			}},
			{StreamName: "Eco", ServerStreams: true, ClientStreams: true, Handler: func(_ any, st grpc.ServerStream) error {
				for {
					in := dynamicpb.NewMessage(msg("Numero"))
					if err := st.RecvMsg(in); err != nil {
						if errors.Is(err, io.EOF) {
							return nil
						}
						return err
					}
					if err := st.SendMsg(numero(getN(in) * 10)); err != nil {
						return err
					}
				}
			}},
		},
	}
	s := grpc.NewServer()
	s.RegisterService(&desc, struct{}{})
	opts := reflection.ServerOptions{Services: s, DescriptorResolver: resolver{reg}}
	rv1.RegisterServerReflectionServer(s, reflection.NewServerV1(opts))
	rv1alpha.RegisterServerReflectionServer(s, reflection.NewServer(opts))
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, "", err
	}
	go func() { _ = s.Serve(ln) }()
	return s, ln.Addr().String(), nil
}
