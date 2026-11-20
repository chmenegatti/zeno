// Package grpcc: cliente gRPC dos requests grpc:// e grpcs:// (#5). Descobre serviços por server
// reflection ou por um arquivo .proto (compilado na hora), chama qualquer tipo de método (unary,
// server, client e bidi streaming) com mensagens em JSON e emite cada passo como Event.
package grpcc

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/bufbuild/protocompile"
	"github.com/jhump/protoreflect/grpcreflect"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"

	"github.com/chmenegatti/zeno/wails/internal/i18n"
)

// ParseURL: grpc://host:porta (sem TLS) ou grpcs://host[:porta] (TLS, padrão 443)
func ParseURL(raw string) (addr string, secure bool, err error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" || (u.Scheme != "grpc" && u.Scheme != "grpcs") {
		return "", false, fmt.Errorf(i18n.T("endereço gRPC inválido (grpc://host:porta ou grpcs://host): %s"), raw)
	}
	secure = u.Scheme == "grpcs"
	addr = u.Host
	if u.Port() == "" {
		if secure {
			addr += ":443"
		} else {
			addr += ":80"
		}
	}
	return addr, secure, nil
}

// Dial: conexão (preguiçosa) com TLS do workspace ou sem TLS; dialer (opcional) abre o TCP, ex.: pelo
// proxy do workspace (recebe host:porta sem resolver, pro proxy decidir)
func Dial(addr string, tlsCfg *tls.Config, dialer func(context.Context, string) (net.Conn, error)) (*grpc.ClientConn, error) {
	creds := insecure.NewCredentials()
	if tlsCfg != nil {
		creds = credentials.NewTLS(tlsCfg)
	}
	opts := []grpc.DialOption{grpc.WithTransportCredentials(creds), grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(64 << 20))}
	if dialer != nil {
		opts = append(opts, grpc.WithContextDialer(dialer))
		addr = "passthrough:///" + addr
	}
	return grpc.NewClient(addr, opts...)
}

// Method: um método do serviço; Input é um JSON de exemplo da mensagem de entrada
type Method struct {
	Name         string `json:"name"`
	ClientStream bool   `json:"clientStream"`
	ServerStream bool   `json:"serverStream"`
	Input        string `json:"input"`
	InputType    string `json:"inputType"`
	OutputType   string `json:"outputType"`
}

type Service struct {
	Name    string   `json:"name"`
	Methods []Method `json:"methods"`
}

// Source: de onde vêm os descritores: arquivo .proto (com a pasta dele como import) ou reflection
type Source struct {
	Conn      *grpc.ClientConn
	ProtoFile string
	MD        metadata.MD
}

func (s Source) services(ctx context.Context) ([]protoreflect.ServiceDescriptor, func(), error) {
	if s.ProtoFile != "" {
		comp := protocompile.Compiler{Resolver: protocompile.WithStandardImports(&protocompile.SourceResolver{ImportPaths: []string{filepath.Dir(s.ProtoFile)}})}
		files, err := comp.Compile(ctx, filepath.Base(s.ProtoFile))
		if err != nil {
			return nil, nil, fmt.Errorf(".proto: %w", err)
		}
		var out []protoreflect.ServiceDescriptor
		for _, f := range files {
			for i := 0; i < f.Services().Len(); i++ {
				out = append(out, f.Services().Get(i))
			}
		}
		return out, func() {}, nil
	}
	if s.Conn == nil {
		return nil, nil, errors.New(i18n.T("sem conexão"))
	}
	rctx := metadata.NewOutgoingContext(ctx, s.MD)
	rc := grpcreflect.NewClientAuto(rctx, s.Conn)
	names, err := rc.ListServices()
	if err != nil {
		rc.Reset()
		return nil, nil, fmt.Errorf(i18n.T("server reflection: %s (sem reflection? escolha um arquivo .proto)"), status.Convert(err).Message())
	}
	var out []protoreflect.ServiceDescriptor
	for _, n := range names {
		if strings.HasPrefix(n, "grpc.reflection.") {
			continue
		}
		sd, err := rc.ResolveService(n)
		if err != nil {
			rc.Reset()
			return nil, nil, err
		}
		out = append(out, sd.UnwrapService())
	}
	return out, rc.Reset, nil
}

// Describe: serviços e métodos, em ordem alfabética
func Describe(ctx context.Context, src Source) ([]Service, error) {
	sds, done, err := src.services(ctx)
	if err != nil {
		return nil, err
	}
	defer done()
	var out []Service
	for _, sd := range sds {
		s := Service{Name: string(sd.FullName())}
		for i := 0; i < sd.Methods().Len(); i++ {
			m := sd.Methods().Get(i)
			s.Methods = append(s.Methods, Method{Name: string(m.Name()), ClientStream: m.IsStreamingClient(), ServerStream: m.IsStreamingServer(),
				Input: Skeleton(m.Input()), InputType: string(m.Input().FullName()), OutputType: string(m.Output().FullName())})
		}
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// FindMethod: descritor de serviço/método
func FindMethod(ctx context.Context, src Source, service, method string) (protoreflect.MethodDescriptor, error) {
	if service == "" || method == "" {
		return nil, errors.New(i18n.T("escolha o serviço e o método"))
	}
	sds, done, err := src.services(ctx)
	if err != nil {
		return nil, err
	}
	defer done()
	for _, sd := range sds {
		if string(sd.FullName()) == service {
			if m := sd.Methods().ByName(protoreflect.Name(method)); m != nil {
				return m, nil
			}
		}
	}
	return nil, fmt.Errorf(i18n.T("método %s/%s não encontrado"), service, method)
}

// Skeleton: JSON de exemplo da mensagem (campos com valor vazio, enums no primeiro valor)
func Skeleton(md protoreflect.MessageDescriptor) string {
	b, _ := json.MarshalIndent(skel(md, 0), "", "  ")
	return string(b)
}

func skel(md protoreflect.MessageDescriptor, depth int) map[string]any {
	out := map[string]any{}
	if depth > 3 {
		return out
	}
	fields := md.Fields()
	for i := 0; i < fields.Len(); i++ {
		f := fields.Get(i)
		var v any
		switch {
		case f.IsMap():
			v = map[string]any{}
		case f.Kind() == protoreflect.MessageKind || f.Kind() == protoreflect.GroupKind:
			v = wellKnown(f.Message(), depth)
		case f.Kind() == protoreflect.EnumKind:
			if f.Enum().Values().Len() > 0 {
				v = string(f.Enum().Values().Get(0).Name())
			} else {
				v = ""
			}
		case f.Kind() == protoreflect.BoolKind:
			v = false
		case f.Kind() == protoreflect.StringKind || f.Kind() == protoreflect.BytesKind:
			v = ""
		case f.Kind() == protoreflect.Int64Kind || f.Kind() == protoreflect.Uint64Kind || f.Kind() == protoreflect.Sint64Kind ||
			f.Kind() == protoreflect.Fixed64Kind || f.Kind() == protoreflect.Sfixed64Kind:
			v = "0"
		default:
			v = 0
		}
		if f.IsList() {
			v = []any{v}
		}
		out[f.JSONName()] = v
	}
	return out
}

func wellKnown(md protoreflect.MessageDescriptor, depth int) any {
	switch md.FullName() {
	case "google.protobuf.Timestamp":
		return time.Now().UTC().Format(time.RFC3339)
	case "google.protobuf.Duration":
		return "1s"
	case "google.protobuf.Struct":
		return map[string]any{}
	case "google.protobuf.Value":
		return nil
	case "google.protobuf.StringValue", "google.protobuf.BytesValue":
		return ""
	case "google.protobuf.BoolValue":
		return false
	}
	if strings.HasPrefix(string(md.FullName()), "google.protobuf.") && strings.HasSuffix(string(md.Name()), "Value") {
		return 0
	}
	return skel(md, depth+1)
}

// ---------- chamadas ----------

// Event: o que aconteceu na chamada. Kind: start, headers, sent, message, status, error
type Event struct {
	ReqID string `json:"reqId"`
	Kind  string `json:"kind"`
	Data  string `json:"data,omitempty"`
	At    int64  `json:"at"`
	// status: código numérico e nome (OK, NOT_FOUND…)
	Code     int         `json:"code"`
	CodeName string      `json:"codeName,omitempty"`
	Metadata [][2]string `json:"metadata,omitempty"`
	// start: o método (Svc/Método) e se o envio é por stream
	Method       string `json:"method,omitempty"`
	ClientStream bool   `json:"clientStream,omitempty"`
}

type session struct {
	stream grpc.ClientStream
	input  protoreflect.MessageDescriptor
	cancel context.CancelFunc
	mu     sync.Mutex
	closed bool
}

// Manager: chamadas em andamento (uma por request)
type Manager struct {
	Emit  func(Event)
	mu    sync.Mutex
	calls map[string]*session
}

func (m *Manager) emit(e Event) {
	e.At = time.Now().UnixMilli()
	if m.Emit != nil {
		m.Emit(e)
	}
}

func pairs(md metadata.MD) [][2]string {
	var out [][2]string
	keys := make([]string, 0, len(md))
	for k := range md {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		for _, v := range md[k] {
			out = append(out, [2]string{k, v})
		}
	}
	return out
}

var codeNames = func() map[codes.Code]string {
	out := map[codes.Code]string{}
	for c := codes.OK; c <= codes.Unauthenticated; c++ {
		// codes.Code.String() devolve "NotFound": vira NOT_FOUND como no gRPC
		n := c.String()
		var b strings.Builder
		prev := rune(0)
		for _, r := range n {
			if r >= 'A' && r <= 'Z' && prev >= 'a' && prev <= 'z' {
				b.WriteByte('_')
			}
			b.WriteRune(r)
			prev = r
		}
		out[c] = strings.ToUpper(b.String())
	}
	out[codes.Canceled] = "CANCELLED"
	return out
}()

// Active: chamada em andamento pro request?
func (m *Manager) Active(reqID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.calls[reqID] != nil
}

// Start abre a chamada (dona da conexão: fecha no fim). Sem client streaming, first é a mensagem
// única e o envio fecha na hora; com client streaming, as mensagens vão por Send e terminam em CloseSend.
func (m *Manager) Start(reqID string, conn *grpc.ClientConn, md protoreflect.MethodDescriptor, meta metadata.MD, first string, timeout time.Duration) error {
	m.Cancel(reqID)
	// timeout do workspace só no unary: stream fica aberto até o fim ou cancelar
	var ctx context.Context
	var cancel context.CancelFunc
	if timeout > 0 && !md.IsStreamingClient() && !md.IsStreamingServer() {
		ctx, cancel = context.WithTimeout(context.Background(), timeout)
	} else {
		ctx, cancel = context.WithCancel(context.Background())
	}
	ctx = metadata.NewOutgoingContext(ctx, meta)
	full := "/" + string(md.Parent().FullName()) + "/" + string(md.Name())
	stream, err := conn.NewStream(ctx, &grpc.StreamDesc{ServerStreams: md.IsStreamingServer(), ClientStreams: md.IsStreamingClient()}, full)
	if err != nil {
		cancel()
		conn.Close()
		return err
	}
	s := &session{stream: stream, input: md.Input(), cancel: cancel}
	m.mu.Lock()
	if m.calls == nil {
		m.calls = map[string]*session{}
	}
	m.calls[reqID] = s
	m.mu.Unlock()
	m.emit(Event{ReqID: reqID, Kind: "start", Method: strings.TrimPrefix(full, "/"), ClientStream: md.IsStreamingClient()})
	if !md.IsStreamingClient() {
		if err := m.send(reqID, s, first); err != nil {
			m.finish(reqID, s, conn, err)
			return nil
		}
		m.closeSend(s)
	}
	go func() {
		if h, err := stream.Header(); err == nil && len(h) > 0 {
			m.emit(Event{ReqID: reqID, Kind: "headers", Metadata: pairs(h)})
		}
		for {
			out := dynamicpb.NewMessage(md.Output())
			if err := stream.RecvMsg(out); err != nil {
				if err == io.EOF {
					err = nil
				}
				m.finish(reqID, s, conn, err)
				return
			}
			b, _ := protojson.MarshalOptions{EmitUnpopulated: true}.Marshal(out)
			m.emit(Event{ReqID: reqID, Kind: "message", Data: pretty(b)})
		}
	}()
	return nil
}

func (m *Manager) finish(reqID string, s *session, conn *grpc.ClientConn, err error) {
	st := status.Convert(err)
	e := Event{ReqID: reqID, Kind: "status", Code: int(st.Code()), CodeName: codeNames[st.Code()], Data: st.Message()}
	if t := s.stream.Trailer(); len(t) > 0 {
		e.Metadata = pairs(t)
	}
	m.emit(e)
	m.mu.Lock()
	if m.calls[reqID] == s {
		delete(m.calls, reqID)
	}
	m.mu.Unlock()
	s.cancel()
	conn.Close()
}

func (m *Manager) send(reqID string, s *session, text string) error {
	msg := dynamicpb.NewMessage(s.input)
	if strings.TrimSpace(text) != "" {
		if err := (protojson.UnmarshalOptions{}).Unmarshal([]byte(text), msg); err != nil {
			return fmt.Errorf(i18n.T("mensagem não confere com %s: %w"), s.input.FullName(), err)
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return errors.New(i18n.T("envio já finalizado"))
	}
	if err := s.stream.SendMsg(msg); err != nil {
		return err
	}
	b, _ := protojson.Marshal(msg)
	m.emit(Event{ReqID: reqID, Kind: "sent", Data: pretty(b)})
	return nil
}

// pretty: o protojson muda o espaçamento de propósito (saída instável); reindenta estável
func pretty(b []byte) string {
	var out bytes.Buffer
	if json.Indent(&out, b, "", "  ") != nil {
		return string(b)
	}
	return out.String()
}

func (m *Manager) closeSend(s *session) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.closed {
		s.closed = true
		_ = s.stream.CloseSend()
	}
}

func (m *Manager) get(reqID string) *session {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.calls[reqID]
}

// Send: mais uma mensagem (client/bidi streaming)
func (m *Manager) Send(reqID, text string) error {
	s := m.get(reqID)
	if s == nil {
		return errors.New(i18n.T("nenhuma chamada gRPC em andamento"))
	}
	return m.send(reqID, s, text)
}

// CloseSend: fim das mensagens do cliente (a resposta/status chega depois)
func (m *Manager) CloseSend(reqID string) error {
	s := m.get(reqID)
	if s == nil {
		return errors.New(i18n.T("nenhuma chamada gRPC em andamento"))
	}
	m.closeSend(s)
	return nil
}

// Cancel: interrompe (o status CANCELLED chega pelo evento)
func (m *Manager) Cancel(reqID string) {
	if s := m.get(reqID); s != nil {
		s.cancel()
	}
}

// CancelAll: ao sair do app
func (m *Manager) CancelAll() {
	m.mu.Lock()
	list := make([]*session, 0, len(m.calls))
	for _, s := range m.calls {
		list = append(list, s)
	}
	m.mu.Unlock()
	for _, s := range list {
		s.cancel()
	}
}
