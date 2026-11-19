// Envio HTTP com net/http + httptrace: DNS, conexão, TLS, primeiro byte e download medidos nativamente.

package main

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/url"
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

func cancelSend(id string) {
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

// send executa o request preparado e devolve o ResponseRecord (mesmo formato do Electron)
func send(reqID string, p Prepared) Doc {
	start := time.Now()
	rec := Doc{
		"id":           "res_" + strconv.FormatInt(start.UnixMilli(), 36),
		"requestId":    reqID,
		"at":           start.UnixMilli(),
		"method":       p.Method,
		"url":          p.URL,
		"status":       0,
		"statusText":   "",
		"headers":      [][2]string{},
		"body":         "",
		"bodyEncoding": "utf8",
		"size":         0,
		"timing":       Doc{"headersMs": 0, "totalMs": 0},
	}
	fail := func(err error) Doc {
		rec["error"] = err.Error()
		rec["timing"] = Doc{"headersMs": 0, "totalMs": ms(time.Since(start))}
		return rec
	}

	var body io.Reader
	var reqBody string
	switch p.BodyKind {
	case "text":
		reqBody = p.Text
	case "form":
		v := url.Values{}
		for _, f := range p.Form {
			v.Add(f[0], f[1])
		}
		reqBody = v.Encode()
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
	rec["status"] = res.StatusCode
	rec["statusText"] = strings.TrimPrefix(res.Status, strconv.Itoa(res.StatusCode)+" ")
	rec["headers"] = headers
	rec["size"] = len(data)
	if isText(res.Header.Get("Content-Type"), data) {
		rec["body"] = string(data)
	} else {
		rec["body"] = base64.StdEncoding.EncodeToString(data)
		rec["bodyEncoding"] = "base64"
	}
	rec["timing"] = Doc{"headersMs": ms(headersAt.Sub(start)), "totalMs": ms(end.Sub(start))}

	timing := Doc{"ttfbMs": 0.0, "downloadMs": ms(end.Sub(headersAt)), "totalMs": ms(end.Sub(start))}
	if !dnsStart.IsZero() {
		timing["dnsMs"] = ms(dnsDone.Sub(dnsStart))
	}
	if !connStart.IsZero() {
		timing["connectMs"] = ms(connDone.Sub(connStart))
	}
	if !tlsStart.IsZero() {
		timing["tlsMs"] = ms(tlsDone.Sub(tlsStart))
	}
	if !firstByte.IsZero() {
		ref := connDone
		if !tlsDone.IsZero() {
			ref = tlsDone
		}
		if ref.IsZero() {
			ref = start
		}
		timing["ttfbMs"] = ms(firstByte.Sub(ref))
	}
	var head strings.Builder
	fmt.Fprintf(&head, "%s %s HTTP/1.1\r\nHost: %s\r\n", p.Method, req.URL.RequestURI(), req.URL.Host)
	for _, h := range p.Headers {
		fmt.Fprintf(&head, "%s: %s\r\n", h[0], h[1])
	}
	tl := Doc{
		"hops":   []any{Doc{"method": p.Method, "url": p.URL, "requestHead": head.String(), "status": res.StatusCode, "statusText": rec["statusText"], "headers": headers, "atMs": ms(headersAt.Sub(start))}},
		"timing": timing,
	}
	if reqBody != "" {
		tl["requestBody"] = reqBody
	}
	if tcp, ok := remote.(*net.TCPAddr); ok {
		tl["remote"] = Doc{"address": tcp.IP.String(), "port": tcp.Port}
	}
	if tlsState != nil {
		t := Doc{"protocol": tls.VersionName(tlsState.Version), "cipher": tls.CipherSuiteName(tlsState.CipherSuite), "authorized": !p.InsecureTLS}
		if len(tlsState.PeerCertificates) > 0 {
			c := tlsState.PeerCertificates[0]
			t["subject"] = c.Subject.CommonName
			t["issuer"] = c.Issuer.CommonName
			t["validFrom"] = c.NotBefore.Format(time.RFC1123)
			t["validTo"] = c.NotAfter.Format(time.RFC1123)
			t["altNames"] = strings.Join(c.DNSNames, ", ")
		}
		tl["tls"] = t
	}
	rec["timeline"] = tl
	return rec
}
