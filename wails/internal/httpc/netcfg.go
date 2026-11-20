package httpc

// Rede do workspace (#18): proxy (do sistema ou personalizado, HTTP/HTTPS/SOCKS5, com no_proxy), CA
// própria somada às do sistema e certificado de cliente (mTLS) escolhido pelo host de cada salto.

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"

	"github.com/chmenegatti/zeno/wails/internal/vars"
	"golang.org/x/net/http/httpproxy"
	"software.sslmate.com/src/go-pkcs12"
)

// proxyFunc: nil = sem proxy. used recebe o proxy de cada conexão (sem senha), pra linha do tempo.
// Como no Go, requests pra localhost/loopback não passam pelo proxy.
func proxyFunc(n vars.Net, used func(string)) (func(*http.Request) (*url.URL, error), error) {
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
			used(u.Redacted())
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
