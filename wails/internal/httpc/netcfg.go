package httpc

// Rede do workspace (#18): proxy (do sistema ou personalizado, HTTP/HTTPS/SOCKS5, com no_proxy), CA
// própria somada às do sistema e certificado de cliente (mTLS) escolhido pelo host de cada salto.

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/vars"
	"golang.org/x/net/http/httpproxy"
	"software.sslmate.com/src/go-pkcs12"
)

// proxyFunc: nil = sem proxy. used recebe o proxy de cada conexão (linha do tempo). Proxy HTTPS com
// destino HTTPS vira túnel aberto pelo próprio Zeno (tunnel, dialTunnel), não pelo http.Transport, que
// usaria o mesmo tls.Config (com o certificado de cliente do destino) no aperto de mão com o proxy.
// Como no Go, requests pra localhost/loopback não passam pelo proxy.
func proxyFunc(n vars.Net, used func(*url.URL), tunnel *tunnels) (func(*http.Request) (*url.URL, error), error) {
	var cfg *httpproxy.Config
	switch n.ProxyMode {
	case "system":
		cfg = httpproxy.FromEnvironment()
	case "custom":
		raw := n.ProxyURL
		if raw == "" {
			return nil, errors.New("proxy personalizado sem endereço (configurações do workspace)")
		}
		if !strings.Contains(raw, "://") {
			raw = "http://" + raw
		}
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" {
			return nil, fmt.Errorf("endereço do proxy inválido: %q", n.ProxyURL)
		}
		switch u.Scheme {
		case "http", "https", "socks5", "socks5h":
		default:
			return nil, fmt.Errorf("proxy %q: use http://, https:// ou socks5://", u.Scheme)
		}
		cfg = &httpproxy.Config{HTTPProxy: raw, HTTPSProxy: raw, NoProxy: n.NoProxy}
	default:
		return nil, nil
	}
	f := cfg.ProxyFunc()
	return func(r *http.Request) (*url.URL, error) {
		u, err := f(r.URL)
		if u != nil && used != nil {
			used(u)
		}
		if u != nil && u.Scheme == "https" && r.URL.Scheme == "https" && tunnel != nil {
			tunnel.set(canonicalAddr(r.URL), u)
			return nil, err
		}
		return u, err
	}, nil
}

// rootCAs: CAs do sistema + as do arquivo PEM (nil = só as do sistema)
func rootCAs(file string) (*x509.CertPool, error) {
	if file == "" {
		return nil, nil
	}
	b, err := os.ReadFile(file)
	if err != nil {
		return nil, fmt.Errorf("CA própria: %w", err)
	}
	pool, err := x509.SystemCertPool()
	if err != nil || pool == nil {
		pool = x509.NewCertPool()
	}
	if !pool.AppendCertsFromPEM(b) {
		return nil, fmt.Errorf("CA própria: nenhum certificado PEM em %s", file)
	}
	return pool, nil
}

// matchHost: "api.x.com", "api.x.com:8443" ou "*.x.com" (subdomínios), sem diferenciar maiúsculas
func matchHost(pattern, host, port string) bool {
	pattern = strings.ToLower(strings.TrimSpace(pattern))
	host = strings.ToLower(host)
	if h, p, err := net.SplitHostPort(pattern); err == nil {
		if p != port {
			return false
		}
		pattern = h
	}
	if strings.HasPrefix(pattern, "*.") {
		return strings.HasSuffix(host, pattern[1:])
	}
	return pattern != "" && pattern == host
}

// clientCerts escolhe e carrega (uma vez) o certificado do host atual
type clientCerts struct {
	list   []vars.ClientCert
	mu     sync.Mutex
	host   string
	port   string
	loaded map[int]*tls.Certificate
}

func (c *clientCerts) setTarget(u *url.URL) {
	if u.Scheme != "https" {
		// destino sem TLS: nenhum certificado de cliente (nem pro proxy no caminho)
		c.mu.Lock()
		c.host, c.port = "", ""
		c.mu.Unlock()
		return
	}
	port := u.Port()
	if port == "" {
		port = map[string]string{"https": "443", "http": "80"}[u.Scheme]
	}
	c.mu.Lock()
	c.host, c.port = u.Hostname(), port
	c.mu.Unlock()
}

func loadCert(cc vars.ClientCert) (*tls.Certificate, error) {
	if cc.PFX != "" {
		data, err := os.ReadFile(cc.PFX)
		if err != nil {
			return nil, err
		}
		key, leaf, chain, err := pkcs12.DecodeChain(data, cc.Passphrase)
		if err != nil {
			return nil, fmt.Errorf("PFX: %w (senha certa?)", err)
		}
		c := &tls.Certificate{Certificate: [][]byte{leaf.Raw}, PrivateKey: key, Leaf: leaf}
		for _, ca := range chain {
			c.Certificate = append(c.Certificate, ca.Raw)
		}
		return c, nil
	}
	if cc.Cert == "" {
		return nil, errors.New("sem arquivo de certificado")
	}
	key := cc.Key
	if key == "" {
		key = cc.Cert
	}
	c, err := tls.LoadX509KeyPair(cc.Cert, key)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// get: GetClientCertificate do tls.Config. Sem certificado pro host: segue sem (o servidor decide).
func (c *clientCerts) get(*tls.CertificateRequestInfo) (*tls.Certificate, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for i, cc := range c.list {
		if !matchHost(cc.Host, c.host, c.port) {
			continue
		}
		if cert, ok := c.loaded[i]; ok {
			return cert, nil
		}
		cert, err := loadCert(cc)
		if err != nil {
			return nil, fmt.Errorf("certificado do cliente pra %s: %w", cc.Host, err)
		}
		if c.loaded == nil {
			c.loaded = map[int]*tls.Certificate{}
		}
		c.loaded[i] = cert
		return cert, nil
	}
	return &tls.Certificate{}, nil
}

func canonicalAddr(u *url.URL) string {
	port := u.Port()
	if port == "" {
		port = map[string]string{"https": "443", "http": "80"}[u.Scheme]
	}
	return net.JoinHostPort(u.Hostname(), port)
}

// tunnels: destino (host:porta) → proxy HTTPS por onde ele sai
type tunnels struct {
	mu sync.Mutex
	m  map[string]*url.URL
}

func (t *tunnels) set(addr string, proxy *url.URL) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.m == nil {
		t.m = map[string]*url.URL{}
	}
	t.m[addr] = proxy
}

func (t *tunnels) get(addr string) *url.URL {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.m[addr]
}

// dialTunnel: TLS até o proxy (sem certificado de cliente, validado com as CAs do sistema + a própria)
// e CONNECT pro destino; o TLS do destino é feito depois, pelo http.Transport, dentro do túnel
func dialTunnel(ctx context.Context, proxy *url.URL, addr string, roots *x509.CertPool, insecure bool) (net.Conn, error) {
	port := proxy.Port()
	if port == "" {
		port = "443"
	}
	d := &tls.Dialer{NetDialer: &net.Dialer{Timeout: 15 * time.Second}, Config: &tls.Config{ServerName: proxy.Hostname(), RootCAs: roots, InsecureSkipVerify: insecure}}
	conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort(proxy.Hostname(), port))
	if err != nil {
		return nil, fmt.Errorf("proxy %s: %w", proxy.Host, err)
	}
	req := "CONNECT " + addr + " HTTP/1.1\r\nHost: " + addr + "\r\n"
	if proxy.User != nil {
		pass, _ := proxy.User.Password()
		req += "Proxy-Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte(proxy.User.Username()+":"+pass)) + "\r\n"
	}
	if _, err := conn.Write([]byte(req + "\r\n")); err != nil {
		conn.Close()
		return nil, err
	}
	br := bufio.NewReader(conn)
	res, err := http.ReadResponse(br, &http.Request{Method: http.MethodConnect})
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("proxy %s: %w", proxy.Host, err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		conn.Close()
		return nil, fmt.Errorf("proxy %s recusou o túnel: %s", proxy.Host, res.Status)
	}
	if br.Buffered() > 0 {
		conn.Close()
		return nil, fmt.Errorf("proxy %s mandou dados antes do túnel", proxy.Host)
	}
	return conn, nil
}

// NetClient (#6): cliente HTTP/1.1 com a rede do workspace (proxy, CA própria, certificado de
// cliente, TLS inválido aceito ou não) pra quem não passa pelo Send, como o WebSocket. target é a
// URL http(s) equivalente (escolhe o certificado de cliente).
func NetClient(p vars.Prepared, target *url.URL) (*http.Client, error) {
	tun := &tunnels{}
	proxy, err := proxyFunc(p.Net, func(*url.URL) {}, tun)
	if err != nil {
		return nil, err
	}
	tlsCfg, roots, err := tlsFor(p, target)
	if err != nil {
		return nil, err
	}
	tr := &http.Transport{
		Proxy:           proxy,
		TLSClientConfig: tlsCfg,
		TLSNextProto:    map[string]func(string, *tls.Conn) http.RoundTripper{},
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			if px := tun.get(addr); px != nil {
				return dialTunnel(ctx, px, addr, roots, p.InsecureTLS)
			}
			return (&net.Dialer{Timeout: 15 * time.Second}).DialContext(ctx, network, addr)
		},
		TLSHandshakeTimeout: 15 * time.Second,
	}
	return &http.Client{Transport: tr}, nil
}

// TLSConfig (#5): TLS do workspace (CA própria, certificado de cliente do host de target, aceitar
// inválido) pra conexões fora do HTTP, como o gRPC
func TLSConfig(p vars.Prepared, target *url.URL) (*tls.Config, error) {
	c, _, err := tlsFor(p, target)
	return c, err
}

func tlsFor(p vars.Prepared, target *url.URL) (*tls.Config, *x509.CertPool, error) {
	certs := &clientCerts{list: p.Net.ClientCerts}
	certs.setTarget(target)
	roots, err := rootCAs(p.Net.CAFile)
	if err != nil {
		return nil, nil, err
	}
	return &tls.Config{
		InsecureSkipVerify:   true,
		GetClientCertificate: certs.get,
		VerifyConnection: func(cs tls.ConnectionState) error {
			if p.InsecureTLS {
				return nil
			}
			if len(cs.PeerCertificates) == 0 {
				return errors.New("servidor não mandou certificado")
			}
			inter := x509.NewCertPool()
			for _, c := range cs.PeerCertificates[1:] {
				inter.AddCert(c)
			}
			_, err := cs.PeerCertificates[0].Verify(x509.VerifyOptions{DNSName: cs.ServerName, Intermediates: inter, Roots: roots})
			return err
		},
	}, roots, nil
}
