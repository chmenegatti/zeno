// Package httpc: envio HTTP (port de src/main/http.ts).
//
// Redirects na mão, um salto por vez na linha do tempo (com cookies em cada salto), multipart com
// arquivo do disco, timeout e cancelamento, e a linha do tempo medida pelo httptrace: DNS, conexão,
// TLS (com o certificado), primeiro byte e download. HTTP/1.1 como o undici do Electron.
package httpc

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/vars"
)

// CookieHooks: cookie jar do workspace (opcional): header pra URL e guardar Set-Cookie
type CookieHooks struct {
	Header func(url string) string
	Store  func(url string, setCookies []string)
}

var (
	inflightMu sync.Mutex
	inflight   = map[string]*flight{}
	errCancel  = errors.New("cancelado")
)

// envio em andamento (ponteiro único: o fim de um envio antigo não apaga o registro do novo)
type flight struct{ cancel context.CancelCauseFunc }

// Cancel interrompe o envio em andamento do request
func Cancel(id string) {
	inflightMu.Lock()
	defer inflightMu.Unlock()
	if f, ok := inflight[id]; ok {
		f.cancel(errCancel)
	}
}

func ms(d time.Duration) float64 { return float64(d.Microseconds()) / 1000 }
func round(f float64) int64      { return int64(math.Round(f)) }

// ResponseID: res_<ms em base 36><6 aleatórios>, como o Electron (dois envios no mesmo ms não colidem)
func ResponseID(t time.Time) string {
	const digits = "0123456789abcdefghijklmnopqrstuvwxyz"
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	for i := range b {
		b[i] = digits[int(b[i])%36]
	}
	return "res_" + strconv.FormatInt(t.UnixMilli(), 36) + string(b)
}

// FormEncode: pares na ordem da tela, como URLSearchParams (espaço vira +, só *-._ e alfanuméricos ficam)
func FormEncode(pairs [][2]string) string {
	enc := func(s string) string {
		var b strings.Builder
		for i := 0; i < len(s); i++ {
			c := s[i]
			switch {
			case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '*', c == '-', c == '.', c == '_':
				b.WriteByte(c)
			case c == ' ':
				b.WriteByte('+')
			default:
				fmt.Fprintf(&b, "%%%02X", c)
			}
		}
		return b.String()
	}
	parts := make([]string, len(pairs))
	for i, kv := range pairs {
		parts[i] = enc(kv[0]) + "=" + enc(kv[1])
	}
	return strings.Join(parts, "&")
}

var textRe = regexp.MustCompile(`(?i)^(text/|application/([\w.+-]*\+)?(json|xml|javascript|x-www-form-urlencoded|graphql|yaml|x-yaml)|image/svg)`)

// IsText: corpo vai como texto (utf8) ou base64
func IsText(contentType string, body []byte) bool {
	if contentType != "" {
		return textRe.MatchString(contentType)
	}
	// sem content-type: heurística, sem bytes nulos no primeiro 1k
	n := min(len(body), 1024)
	return !bytes.Contains(body[:n], []byte{0})
}

// body enviado em texto pra linha do tempo
func bodyText(p vars.Prepared) (string, bool) {
	cut := func(t string) string {
		if n := len([]rune(t)); n > 65536 {
			r := []rune(t)
			return string(r[:65536]) + fmt.Sprintf("\n… (%d caracteres a mais)", n-65536)
		}
		return t
	}
	switch p.BodyKind {
	case "text":
		return cut(p.Text), true
	case "form":
		return cut(FormEncode(p.Form)), true
	case "multipart":
		lines := make([]string, len(p.Multipart))
		for i, f := range p.Multipart {
			v := f.Value
			if f.File != "" {
				v = "arquivo " + f.File
			}
			lines[i] = "--- " + f.Name + ": " + v
		}
		return strings.Join(lines, "\n"), true
	}
	return "", false
}

// conexão aberta pelo envio: tempos e certificado
type conn struct {
	dnsMs, connectMs, tlsMs *int64
	remote                  *doc.Doc
	tls                     *doc.Doc
}

var redirects = map[int]bool{301: true, 302: true, 303: true, 307: true, 308: true}

const maxRedirects = 10

// headers da resposta como o Headers do fetch: nomes minúsculos, em ordem, repetidos juntos com ", "
// (menos set-cookie, um por linha)
func responseHeaders(h http.Header) [][2]string {
	names := make([]string, 0, len(h))
	for k := range h {
		names = append(names, k)
	}
	sort.Slice(names, func(i, j int) bool { return strings.ToLower(names[i]) < strings.ToLower(names[j]) })
	out := [][2]string{}
	for _, k := range names {
		lk := strings.ToLower(k)
		if lk == "set-cookie" {
			for _, v := range h[k] {
				out = append(out, [2]string{lk, v})
			}
			continue
		}
		out = append(out, [2]string{lk, strings.Join(h[k], ", ")})
	}
	return out
}

// nomes do certificado como o Node (CN, ou O)
func certName(n pkixName) string {
	if n.CommonName != "" {
		return n.CommonName
	}
	return strings.Join(n.Organization, ", ")
}

type pkixName = struct {
	CommonName   string
	Organization []string
}

func tlsVersion(v uint16) string {
	switch v {
	case tls.VersionTLS13:
		return "TLSv1.3"
	case tls.VersionTLS12:
		return "TLSv1.2"
	case tls.VersionTLS11:
		return "TLSv1.1"
	case tls.VersionTLS10:
		return "TLSv1"
	}
	return tls.VersionName(v)
}

// Send executa o request preparado e devolve o ResponseRecord (mesmo formato do Electron)
func Send(reqID string, p vars.Prepared, cookies CookieHooks) *doc.Doc {
	start := time.Now()
	ctx, cancel := context.WithCancelCause(context.Background())
	me := &flight{cancel}
	inflightMu.Lock()
	if prev, ok := inflight[reqID]; ok {
		prev.cancel(errCancel)
	}
	inflight[reqID] = me
	inflightMu.Unlock()
	var timer *time.Timer
	if p.TimeoutMs > 0 {
		timer = time.AfterFunc(time.Duration(p.TimeoutMs)*time.Millisecond, func() {
			cancel(fmt.Errorf("timeout de %s ms", doc.FormatNum(p.TimeoutMs)))
		})
	}
	defer func() {
		if timer != nil {
			timer.Stop()
		}
		cancel(nil)
		inflightMu.Lock()
		if inflight[reqID] == me {
			delete(inflight, reqID)
		}
		inflightMu.Unlock()
	}()

	// mesma ordem de campos do ResponseRecord do Electron
	rec := doc.New(
		"id", ResponseID(start),
		"requestId", reqID,
		"at", start.UnixMilli(),
		"method", p.Method,
		"url", p.URL,
	)

	// linha do tempo: conexões abertas por este envio e o cabeçalho bruto de cada salto
	var conns []*conn
	hops := []any{}
	timeline := func(headersMs, totalMs int64) *doc.Doc {
		tl := doc.New()
		if rb, ok := bodyText(p); ok {
			tl.Set("requestBody", rb)
		}
		tl.Set("hops", hops)
		first := &conn{}
		if len(conns) > 0 {
			first = conns[0]
		}
		var setup int64
		timing := doc.New()
		for _, kv := range []struct {
			k string
			v *int64
		}{{"dnsMs", first.dnsMs}, {"connectMs", first.connectMs}, {"tlsMs", first.tlsMs}} {
			if kv.v != nil {
				timing.Set(kv.k, *kv.v)
				setup += *kv.v
			}
		}
		timing.Set("ttfbMs", max(0, headersMs-setup))
		timing.Set("downloadMs", totalMs-headersMs)
		timing.Set("totalMs", totalMs)
		tl.Set("timing", timing)
		if len(conns) > 0 && conns[len(conns)-1].remote != nil {
			tl.Set("remote", conns[len(conns)-1].remote)
		}
		for _, c := range conns {
			if c.tls != nil {
				tl.Set("tls", c.tls)
				break
			}
		}
		return tl
	}
	fail := func(err error) *doc.Doc {
		total := round(ms(time.Since(start)))
		rec.Set("status", 0)
		rec.Set("statusText", "")
		rec.Set("headers", [][2]string{})
		rec.Set("body", "")
		rec.Set("bodyEncoding", "utf8")
		rec.Set("size", 0)
		rec.Set("timing", doc.New("headersMs", 0, "totalMs", total))
		// falhou no meio (TLS inválido, redirect…): o que deu pra registrar ajuda a entender
		if len(hops) > 0 || len(conns) > 0 {
			rec.Set("timeline", timeline(0, total))
		}
		msg := err.Error()
		if c := context.Cause(ctx); c != nil && ctx.Err() != nil {
			msg = c.Error()
		}
		rec.Set("error", msg)
		return rec
	}

	// TLS: verifica na mão pra registrar o erro mesmo quando o workspace aceita certificado inválido
	var cur *conn
	tlsCfg := &tls.Config{
		InsecureSkipVerify: true,
		VerifyConnection: func(cs tls.ConnectionState) error {
			var verr error
			if len(cs.PeerCertificates) == 0 {
				verr = errors.New("servidor não mandou certificado")
			} else {
				inter := x509.NewCertPool()
				for _, c := range cs.PeerCertificates[1:] {
					inter.AddCert(c)
				}
				_, verr = cs.PeerCertificates[0].Verify(x509.VerifyOptions{DNSName: cs.ServerName, Intermediates: inter})
			}
			if cur != nil {
				t := doc.New("protocol", tlsVersion(cs.Version), "cipher", tls.CipherSuiteName(cs.CipherSuite), "authorized", verr == nil)
				if verr != nil {
					t.Set("error", verr.Error())
				}
				if len(cs.PeerCertificates) > 0 {
					c := cs.PeerCertificates[0]
					t.Set("subject", certName(pkixName{c.Subject.CommonName, c.Subject.Organization}))
					t.Set("issuer", certName(pkixName{c.Issuer.CommonName, c.Issuer.Organization}))
					t.Set("validFrom", c.NotBefore.UTC().Format("Jan _2 15:04:05 2006 GMT"))
					t.Set("validTo", c.NotAfter.UTC().Format("Jan _2 15:04:05 2006 GMT"))
					names := make([]string, 0, len(c.DNSNames)+len(c.IPAddresses))
					for _, n := range c.DNSNames {
						names = append(names, "DNS:"+n)
					}
					for _, ip := range c.IPAddresses {
						names = append(names, "IP Address:"+ip.String())
					}
					if len(names) > 0 {
						t.Set("altNames", strings.Join(names, ", "))
					}
					sum := sha256.Sum256(c.Raw)
					hexes := make([]string, len(sum))
					for i, b := range sum {
						hexes[i] = fmt.Sprintf("%02X", b)
					}
					t.Set("fingerprint", strings.Join(hexes, ":"))
				}
				cur.tls = t
			}
			if verr != nil && !p.InsecureTLS {
				return verr
			}
			return nil
		},
	}
	// uma conexão por envio (reaproveitada entre saltos pro mesmo host), HTTP/1.1, sem proxy do ambiente
	tr := &http.Transport{
		TLSClientConfig:     tlsCfg,
		TLSNextProto:        map[string]func(string, *tls.Conn) http.RoundTripper{},
		DialContext:         (&net.Dialer{Timeout: 15 * time.Second}).DialContext,
		TLSHandshakeTimeout: 15 * time.Second,
	}
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

	// corpo (multipart lê os arquivos uma vez e reenvia igual se o redirect mantiver o método)
	var payload []byte
	contentType := ""
	switch p.BodyKind {
	case "text":
		payload = []byte(p.Text)
	case "form":
		payload = []byte(FormEncode(p.Form))
	case "multipart":
		var b bytes.Buffer
		mw := multipart.NewWriter(&b)
		for _, f := range p.Multipart {
			if f.File != "" {
				data, err := os.ReadFile(f.File)
				if err != nil {
					return fail(fmt.Errorf("arquivo do multipart: %w", err))
				}
				h := make(textproto.MIMEHeader)
				h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, escapeQuotes(f.Name), escapeQuotes(filepath.Base(f.File))))
				h.Set("Content-Type", "application/octet-stream")
				w, _ := mw.CreatePart(h)
				_, _ = w.Write(data)
			} else {
				_ = mw.WriteField(f.Name, f.Value)
			}
		}
		_ = mw.Close()
		payload = b.Bytes()
		contentType = mw.FormDataContentType()
	}
	if p.Method == "GET" || p.Method == "HEAD" {
		payload = nil
	}

	headers := http.Header{}
	userCookie := ""
	hostHeader := ""
	for _, h := range p.Headers {
		if h[0] == "" {
			continue
		}
		switch strings.ToLower(h[0]) {
		case "cookie":
			userCookie = strings.Join(filterEmpty(userCookie, h[1]), "; ")
			continue
		case "host":
			hostHeader = h[1]
			continue
		}
		// mantém o nome como foi digitado (sem canonizar)
		headers[h[0]] = append(headers[h[0]], h[1])
	}
	if contentType != "" && headerGet(headers, "content-type") == "" {
		headers["Content-Type"] = []string{contentType}
	}
	if headerGet(headers, "accept") == "" {
		headers["Accept"] = []string{"*/*"}
	}
	if headerGet(headers, "user-agent") == "" {
		headers["User-Agent"] = []string{"Zeno"}
	}

	u, method := p.URL, p.Method
	var res *http.Response
	for hop := 0; ; hop++ {
		jar := ""
		if cookies.Header != nil {
			jar = cookies.Header(u)
		}
		h := headers.Clone()
		if c := strings.Join(filterEmpty(userCookie, jar), "; "); c != "" {
			h["Cookie"] = []string{c}
		}
		var body io.Reader
		if payload != nil {
			body = bytes.NewReader(payload)
		}
		var head strings.Builder
		var dnsStart, connStart, tlsStart time.Time
		var c *conn
		trace := &httptrace.ClientTrace{
			// conexão nova (reaproveitada não passa por aqui); entra na lista mesmo se falhar depois
			DNSStart: func(httptrace.DNSStartInfo) {
				dnsStart = time.Now()
				c = &conn{}
				cur = c
				conns = append(conns, c)
			},
			DNSDone: func(httptrace.DNSDoneInfo) {
				v := round(ms(time.Since(dnsStart)))
				c.dnsMs = &v
			},
			ConnectStart: func(_, _ string) {
				connStart = time.Now()
				if c == nil {
					c = &conn{}
					cur = c
					conns = append(conns, c)
				}
			},
			ConnectDone: func(_, addr string, err error) {
				if err != nil {
					return
				}
				v := round(ms(time.Since(connStart)))
				c.connectMs = &v
				if host, port, e := net.SplitHostPort(addr); e == nil {
					pn, _ := strconv.Atoi(port)
					c.remote = doc.New("address", host, "port", pn)
				}
			},
			TLSHandshakeStart: func() { tlsStart = time.Now() },
			TLSHandshakeDone: func(tls.ConnectionState, error) {
				if c != nil {
					v := round(ms(time.Since(tlsStart)))
					c.tlsMs = &v
				}
			},
			WroteHeaderField: func(k string, v []string) {
				for _, x := range v {
					head.WriteString(k + ": " + x + "\r\n")
				}
			},
		}
		req, err := http.NewRequestWithContext(httptrace.WithClientTrace(ctx, trace), method, u, body)
		if err != nil {
			return fail(err)
		}
		req.Header = h
		if hostHeader != "" {
			req.Host = hostHeader
		}
		res, err = client.Do(req)
		if err != nil {
			return fail(unwrapURL(err))
		}
		// linha de requisição + headers como saíram no socket
		reqHead := fmt.Sprintf("%s %s HTTP/1.1\r\n", method, req.URL.RequestURI()) + head.String() + "\r\n"
		hops = append(hops, doc.New("method", method, "url", u, "requestHead", reqHead, "status", res.StatusCode,
			"statusText", statusText(res), "headers", responseHeaders(res.Header), "atMs", round(ms(time.Since(start)))))
		if set := res.Header.Values("Set-Cookie"); len(set) > 0 && cookies.Store != nil {
			cookies.Store(u, set)
		}
		loc := res.Header.Get("Location")
		if !redirects[res.StatusCode] || loc == "" || hop >= maxRedirects {
			break
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 1<<20))
		res.Body.Close()
		base, _ := url.Parse(u)
		next, err := base.Parse(loc)
		if err != nil {
			return fail(err)
		}
		// origem diferente: não leva credenciais escritas à mão (como o fetch faz)
		if origin(next) != origin(base) {
			deleteHeader(headers, "authorization")
			userCookie = ""
		}
		if res.StatusCode == 303 || ((res.StatusCode == 301 || res.StatusCode == 302) && method == "POST") {
			if method != "HEAD" {
				method = "GET"
			}
			payload = nil
			deleteHeader(headers, "content-type")
			deleteHeader(headers, "content-length")
		}
		u = next.String()
	}
	defer res.Body.Close()
	headersMs := ms(time.Since(start))
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return fail(err)
	}
	totalMs := ms(time.Since(start))

	rec.Set("url", u)
	rec.Set("status", res.StatusCode)
	rec.Set("statusText", statusText(res))
	rec.Set("headers", responseHeaders(res.Header))
	if IsText(res.Header.Get("Content-Type"), data) {
		rec.Set("body", string(data))
		rec.Set("bodyEncoding", "utf8")
	} else {
		rec.Set("body", base64.StdEncoding.EncodeToString(data))
		rec.Set("bodyEncoding", "base64")
	}
	rec.Set("size", len(data))
	rec.Set("timing", doc.New("headersMs", round(headersMs), "totalMs", round(totalMs)))
	rec.Set("timeline", timeline(round(headersMs), round(totalMs)))
	return rec
}

func statusText(res *http.Response) string {
	return strings.TrimSpace(strings.TrimPrefix(res.Status, strconv.Itoa(res.StatusCode)))
}

func origin(u *url.URL) string {
	host := u.Hostname()
	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	return strings.ToLower(u.Scheme) + "://" + strings.ToLower(host) + ":" + port
}

func headerGet(h http.Header, name string) string {
	for k, v := range h {
		if strings.EqualFold(k, name) && len(v) > 0 {
			return v[0]
		}
	}
	return ""
}

func deleteHeader(h http.Header, name string) {
	for k := range h {
		if strings.EqualFold(k, name) {
			delete(h, k)
		}
	}
}

func filterEmpty(xs ...string) []string {
	out := []string{}
	for _, x := range xs {
		if x != "" {
			out = append(out, x)
		}
	}
	return out
}

func escapeQuotes(s string) string {
	return strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s)
}

// erro do client.Do sem o prefixo `Get "url":` (a URL já aparece na tela)
func unwrapURL(err error) error {
	var ue *url.Error
	if errors.As(err, &ue) {
		return ue.Err
	}
	return err
}
