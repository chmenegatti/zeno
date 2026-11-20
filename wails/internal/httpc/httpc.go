// Package httpc: envio HTTP com net/http + httptrace: DNS, conexão, TLS, primeiro byte e download medidos nativamente.

package httpc

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/vars"
	"io"
	"math"
	"mime"
	"net"
	"net/http"
	"net/http/httptrace"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

var (
	cancelMu sync.Mutex
	cancels  = map[string]context.CancelFunc{}
)

// Cancel interrompe o envio em andamento do request
func Cancel(id string) {
	cancelMu.Lock()
	defer cancelMu.Unlock()
	if c, ok := cancels[id]; ok {
		c()
	}
}

func ms(d time.Duration) float64 { return float64(d.Microseconds()) / 1000 }

func isText(ct string, body []byte) bool {
	mt, _, _ := mime.ParseMediaType(ct)
	if strings.HasPrefix(mt, "text/") || strings.Contains(mt, "json") || strings.Contains(mt, "xml") || strings.Contains(mt, "javascript") || mt == "application/x-www-form-urlencoded" {
		return true
	}
	if mt == "" || mt == "application/octet-stream" {
		n := len(body)
		if n > 4096 {
			n = 4096
		}
		return utf8.Valid(body[:n])
	}
	return false
}

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

// Send executa o request preparado e devolve o ResponseRecord (mesmo formato do Electron)
func Send(reqID string, p vars.Prepared) *doc.Doc {
	start := time.Now()
	// mesma ordem de campos do ResponseRecord do Electron
	rec := doc.New(
		"id", ResponseID(start),
		"requestId", reqID,
		"at", start.UnixMilli(),
		"method", p.Method,
		"url", p.URL,
		"status", 0,
		"statusText", "",
		"headers", [][2]string{},
		"body", "",
		"bodyEncoding", "utf8",
		"size", 0,
		"timing", doc.New("headersMs", 0, "totalMs", 0),
	)
	fail := func(err error) *doc.Doc {
		rec.Set("error", err.Error())
		rec.Set("timing", doc.New("headersMs", 0, "totalMs", math.Round(ms(time.Since(start)))))
		return rec
	}

	var body io.Reader
	var reqBody string
	switch p.BodyKind {
	case "text":
		reqBody = p.Text
	case "form":
		reqBody = FormEncode(p.Form)
	}
	// como o Electron: GET e HEAD não levam body, mesmo que o request tenha um guardado
	if p.Method == "GET" || p.Method == "HEAD" {
		reqBody = ""
	}
	if reqBody != "" {
		body = strings.NewReader(reqBody)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(p.TimeoutMs)*time.Millisecond)
	if p.TimeoutMs <= 0 {
		ctx, cancel = context.WithCancel(context.Background())
	}
	cancelMu.Lock()
	cancels[reqID] = cancel
	cancelMu.Unlock()
	defer func() {
		cancel()
		cancelMu.Lock()
		delete(cancels, reqID)
		cancelMu.Unlock()
	}()

	var dnsStart, dnsDone, connStart, connDone, tlsStart, tlsDone, firstByte time.Time
	var remote net.Addr
	var tlsState *tls.ConnectionState
	trace := &httptrace.ClientTrace{
		DNSStart:             func(httptrace.DNSStartInfo) { dnsStart = time.Now() },
		DNSDone:              func(httptrace.DNSDoneInfo) { dnsDone = time.Now() },
		ConnectStart:         func(_, _ string) { connStart = time.Now() },
		ConnectDone:          func(_, _ string, _ error) { connDone = time.Now() },
		TLSHandshakeStart:    func() { tlsStart = time.Now() },
		TLSHandshakeDone:     func(s tls.ConnectionState, _ error) { tlsDone = time.Now(); tlsState = &s },
		GotConn:              func(i httptrace.GotConnInfo) { remote = i.Conn.RemoteAddr() },
		GotFirstResponseByte: func() { firstByte = time.Now() },
	}
	req, err := http.NewRequestWithContext(httptrace.WithClientTrace(ctx, trace), p.Method, p.URL, body)
	if err != nil {
		return fail(err)
	}
	for _, h := range p.Headers {
		req.Header.Add(h[0], h[1])
	}
	// conexão nova a cada envio, como o Zeno em Electron (timeline completa e sem keep-alive entre envios)
	tr := &http.Transport{Proxy: http.ProxyFromEnvironment, TLSClientConfig: &tls.Config{InsecureSkipVerify: p.InsecureTLS}, DisableKeepAlives: true, ForceAttemptHTTP2: true}
	client := &http.Client{Transport: tr, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		if ctx.Err() == context.Canceled {
			return fail(fmt.Errorf("cancelado"))
		}
		return fail(err)
	}
	defer res.Body.Close()
	headersAt := time.Now()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return fail(err)
	}
	end := time.Now()

	headers := [][2]string{}
	for k, vs := range res.Header {
		for _, v := range vs {
			headers = append(headers, [2]string{strings.ToLower(k), v})
		}
	}
	rec.Set("status", res.StatusCode)
	rec.Set("statusText", strings.TrimPrefix(res.Status, strconv.Itoa(res.StatusCode)+" "))
	rec.Set("headers", headers)
	rec.Set("size", len(data))
	if isText(res.Header.Get("Content-Type"), data) {
		rec.Set("body", string(data))
	} else {
		rec.Set("body", base64.StdEncoding.EncodeToString(data))
		rec.Set("bodyEncoding", "base64")
	}
	// como no Electron: tempo do resumo em ms inteiros; a linha do tempo mantém a fração
	rec.Set("timing", doc.New("headersMs", math.Round(ms(headersAt.Sub(start))), "totalMs", math.Round(ms(end.Sub(start)))))

	timing := doc.New()
	ttfb := 0.0
	if !dnsStart.IsZero() {
		timing.Set("dnsMs", ms(dnsDone.Sub(dnsStart)))
	}
	if !connStart.IsZero() {
		timing.Set("connectMs", ms(connDone.Sub(connStart)))
	}
	if !tlsStart.IsZero() {
		timing.Set("tlsMs", ms(tlsDone.Sub(tlsStart)))
	}
	if !firstByte.IsZero() {
		ref := connDone
		if !tlsDone.IsZero() {
			ref = tlsDone
		}
		if ref.IsZero() {
			ref = start
		}
		ttfb = ms(firstByte.Sub(ref))
	}
	var head strings.Builder
	fmt.Fprintf(&head, "%s %s HTTP/1.1\r\nHost: %s\r\n", p.Method, req.URL.RequestURI(), req.URL.Host)
	for _, h := range p.Headers {
		fmt.Fprintf(&head, "%s: %s\r\n", h[0], h[1])
	}
	timing.Set("ttfbMs", ttfb)
	timing.Set("downloadMs", ms(end.Sub(headersAt)))
	timing.Set("totalMs", ms(end.Sub(start)))
	tl := doc.New("hops", []any{doc.New("method", p.Method, "url", p.URL, "requestHead", head.String(), "status", res.StatusCode, "statusText", rec.Get("statusText"), "headers", headers, "atMs", ms(headersAt.Sub(start)))})
	if reqBody != "" {
		tl.Set("requestBody", reqBody)
	}
	tl.Set("timing", timing)
	if tcp, ok := remote.(*net.TCPAddr); ok {
		tl.Set("remote", doc.New("address", tcp.IP.String(), "port", tcp.Port))
	}
	if tlsState != nil {
		t := doc.New("protocol", tls.VersionName(tlsState.Version), "cipher", tls.CipherSuiteName(tlsState.CipherSuite), "authorized", !p.InsecureTLS)
		if len(tlsState.PeerCertificates) > 0 {
			c := tlsState.PeerCertificates[0]
			t.Set("subject", c.Subject.CommonName)
			t.Set("issuer", c.Issuer.CommonName)
			t.Set("validFrom", c.NotBefore.Format(time.RFC1123))
			t.Set("validTo", c.NotAfter.Format(time.RFC1123))
			t.Set("altNames", strings.Join(c.DNSNames, ", "))
		}
		tl.Set("tls", t)
	}
	rec.Set("timeline", tl)
	return rec
}
