package httpc

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/vars"
	"software.sslmate.com/src/go-pkcs12"
)

func status(rec interface{ Get(string) any }) any { return rec.Get("status") }

// proxy de mentira: recebe o request com URL absoluta e responde quem pediu
func fakeProxy(t *testing.T) (*httptest.Server, *[]string) {
	var seen []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.URL.String())
		fmt.Fprintf(w, "via proxy: %s", r.URL.String())
	}))
	t.Cleanup(srv.Close)
	return srv, &seen
}

func TestProxyPersonalizado(t *testing.T) {
	px, seen := fakeProxy(t)
	p := prep("GET", "http://zeno-teste.example/itens?a=1")
	p.Net = vars.Net{ProxyMode: "custom", ProxyURL: strings.TrimPrefix(px.URL, "http://")}
	rec := Send("r1", p, CookieHooks{})
	if status(rec) != 200 || !strings.Contains(rec.Str("body"), "http://zeno-teste.example/itens?a=1") {
		t.Fatalf("via proxy: %v %v %s", status(rec), rec.Get("error"), rec.Str("body"))
	}
	if tl := rec.Map("timeline"); tl.Str("proxy") != px.URL {
		t.Errorf("linha do tempo sem o proxy: %q", tl.Str("proxy"))
	}
	if len(*seen) != 1 {
		t.Errorf("proxy viu %d requests", len(*seen))
	}

	// no_proxy: host da lista vai direto (aqui o nome nem existe, então falha sem passar pelo proxy)
	p.Net.NoProxy = "localhost, .example"
	rec = Send("r2", p, CookieHooks{})
	if status(rec) != 0 || len(*seen) != 1 {
		t.Errorf("no_proxy: status %v, proxy viu %d", status(rec), len(*seen))
	}

	// erros de configuração viram erro do envio
	for _, n := range []vars.Net{{ProxyMode: "custom"}, {ProxyMode: "custom", ProxyURL: "ftp://x:21"}} {
		p := prep("GET", "http://zeno-teste.example/")
		p.Net = n
		if rec := Send("r3", p, CookieHooks{}); rec.Str("error") == "" {
			t.Errorf("%+v devia dar erro", n)
		}
	}
	// sem proxy (padrão): nada passa pelo proxy
	p = prep("GET", "http://zeno-teste.example/")
	Send("r4", p, CookieHooks{})
	if len(*seen) != 1 {
		t.Error("sem proxy configurado não pode usar proxy")
	}
}

// CA e certificados gerados no teste
type pki struct {
	caCert *x509.Certificate
	caKey  *ecdsa.PrivateKey
	caPEM  []byte
}

func newPKI(t *testing.T) *pki {
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tpl := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "CA de teste do Zeno"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IsCA: true, KeyUsage: x509.KeyUsageCertSign, BasicConstraintsValid: true}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	c, _ := x509.ParseCertificate(der)
	return &pki{c, key, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})}
}

func (p *pki) issue(t *testing.T, cn string, client bool) (tls.Certificate, *x509.Certificate, *ecdsa.PrivateKey) {
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tpl := &x509.Certificate{SerialNumber: big.NewInt(time.Now().UnixNano()), Subject: pkix.Name{CommonName: cn}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature}
	if client {
		tpl.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}
	} else {
		tpl.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}
		tpl.IPAddresses = []net.IP{net.ParseIP("127.0.0.1")}
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, p.caCert, &key.PublicKey, p.caKey)
	if err != nil {
		t.Fatal(err)
	}
	c, _ := x509.ParseCertificate(der)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key, Leaf: c}, c, key
}

func write(t *testing.T, dir, name string, b []byte) string {
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, b, 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestCAPropriaEMTLS(t *testing.T) {
	dir := t.TempDir()
	ca := newPKI(t)
	srvCert, _, _ := ca.issue(t, "servidor", false)
	clients := x509.NewCertPool()
	clients.AddCert(ca.caCert)
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "olá %s", r.TLS.PeerCertificates[0].Subject.CommonName)
	}))
	srv.TLS = &tls.Config{Certificates: []tls.Certificate{srvCert}, ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: clients}
	srv.StartTLS()
	defer srv.Close()
	caFile := write(t, dir, "ca.pem", ca.caPEM)

	// sem a CA: certificado do servidor não confere
	rec := Send("m1", prep("GET", srv.URL), CookieHooks{})
	if status(rec) != 0 || !strings.Contains(rec.Str("error"), "certificate") {
		t.Fatalf("sem CA devia falhar: %v", rec.Get("error"))
	}

	// com a CA mas sem certificado de cliente: o servidor recusa
	p := prep("GET", srv.URL)
	p.Net = vars.Net{CAFile: caFile}
	rec = Send("m2", p, CookieHooks{})
	if status(rec) != 0 {
		t.Fatalf("sem certificado de cliente devia falhar: %v", status(rec))
	}

	// PEM (certificado e chave)
	_, cc, ck := ca.issue(t, "cliente-pem", true)
	certFile := write(t, dir, "cliente.pem", pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cc.Raw}))
	kb, _ := x509.MarshalECPrivateKey(ck)
	keyFile := write(t, dir, "cliente.key", pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kb}))
	p.Net.ClientCerts = []vars.ClientCert{{Host: "outro.example", Cert: "/nao/existe.pem"}, {Host: "127.0.0.1", Cert: certFile, Key: keyFile}}
	rec = Send("m3", p, CookieHooks{})
	if status(rec) != 200 || rec.Str("body") != "olá cliente-pem" {
		t.Fatalf("mTLS com PEM: %v %v %q", status(rec), rec.Get("error"), rec.Str("body"))
	}
	if !rec.Map("timeline").Map("tls").Get("authorized").(bool) {
		t.Error("com a CA própria o certificado do servidor devia constar como válido")
	}

	// PFX com senha
	_, pc, pk := ca.issue(t, "cliente-pfx", true)
	pfx, err := pkcs12.Modern.Encode(pk, pc, []*x509.Certificate{ca.caCert}, "s3nha")
	if err != nil {
		t.Fatal(err)
	}
	pfxFile := write(t, dir, "cliente.pfx", pfx)
	p.Net.ClientCerts = []vars.ClientCert{{Host: "127.0.0.1", PFX: pfxFile, Passphrase: "s3nha"}}
	rec = Send("m4", p, CookieHooks{})
	if status(rec) != 200 || rec.Str("body") != "olá cliente-pfx" {
		t.Fatalf("mTLS com PFX: %v %v %q", status(rec), rec.Get("error"), rec.Str("body"))
	}
	p.Net.ClientCerts[0].Passphrase = "errada"
	rec = Send("m5", p, CookieHooks{})
	if status(rec) != 0 || !strings.Contains(rec.Str("error"), "PFX") {
		t.Errorf("senha errada: %v", rec.Get("error"))
	}

	// CA própria inválida
	p.Net = vars.Net{CAFile: write(t, dir, "lixo.pem", []byte("não é pem"))}
	if rec := Send("m6", p, CookieHooks{}); !strings.Contains(rec.Str("error"), "nenhum certificado PEM") {
		t.Errorf("CA inválida: %v", rec.Get("error"))
	}
}

func TestMatchHost(t *testing.T) {
	for _, c := range []struct {
		pattern, host, port string
		want                bool
	}{
		{"api.x.com", "api.x.com", "443", true},
		{"API.X.com", "api.x.com", "443", true},
		{"api.x.com:8443", "api.x.com", "8443", true},
		{"api.x.com:8443", "api.x.com", "443", false},
		{"*.x.com", "a.b.x.com", "443", true},
		{"*.x.com", "x.com", "443", false},
		{"x.com", "api.x.com", "443", false},
		{"", "x.com", "443", false},
	} {
		if got := matchHost(c.pattern, c.host, c.port); got != c.want {
			t.Errorf("matchHost(%q, %q, %q) = %v", c.pattern, c.host, c.port, got)
		}
	}
}
