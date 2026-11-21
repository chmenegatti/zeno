package httpc

// AWS Signature Version 4 (#150): assina o request final (depois de variáveis, tags e scripts).
// Assina host, content-type e os x-amz-*; S3 leva x-amz-content-sha256 e path sem codificar de novo.

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/vars"
)

// AWSAuth: credenciais já resolvidas (vars.Prepare)
type AWSAuth = vars.AWSAuth

func sha256Hex(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func hmacSHA256(key []byte, s string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(s))
	return m.Sum(nil)
}

// awsEscape: RFC 3986 (só A-Z a-z 0-9 - _ . ~ ficam)
func awsEscape(s string, slash bool) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '_' || c == '.' || c == '~' || (slash && c == '/') {
			b.WriteByte(c)
		} else {
			b.WriteString("%" + strings.ToUpper(hex.EncodeToString([]byte{c})))
		}
	}
	return b.String()
}

func awsCanonicalURI(u *url.URL, service string) string {
	p := u.EscapedPath()
	if p == "" {
		return "/"
	}
	if service == "s3" {
		return p
	}
	// demais serviços: cada segmento codificado de novo
	segs := strings.Split(p, "/")
	for i, s := range segs {
		segs[i] = awsEscape(s, false)
	}
	return strings.Join(segs, "/")
}

func awsCanonicalQuery(u *url.URL) string {
	q := u.Query()
	type kv struct{ k, v string }
	var all []kv
	for k, vs := range q {
		for _, v := range vs {
			all = append(all, kv{awsEscape(k, false), awsEscape(v, false)})
		}
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].k != all[j].k {
			return all[i].k < all[j].k
		}
		return all[i].v < all[j].v
	})
	parts := make([]string, len(all))
	for i, x := range all {
		parts[i] = x.k + "=" + x.v
	}
	return strings.Join(parts, "&")
}

// SignAWSV4 põe X-Amz-Date, X-Amz-Security-Token (se houver), X-Amz-Content-Sha256 (S3) e Authorization
func SignAWSV4(req *http.Request, payload []byte, a AWSAuth, now time.Time) {
	t := now.UTC()
	amzDate := t.Format("20060102T150405Z")
	day := t.Format("20060102")
	setHeader(req.Header, "X-Amz-Date", amzDate)
	if a.SessionToken != "" {
		setHeader(req.Header, "X-Amz-Security-Token", a.SessionToken)
	}
	payloadHash := sha256Hex(payload)
	if a.Service == "s3" {
		setHeader(req.Header, "X-Amz-Content-Sha256", payloadHash)
	}
	host := req.Host
	if host == "" {
		host = req.URL.Host
	}
	if h, port, ok := strings.Cut(host, ":"); ok && ((req.URL.Scheme == "https" && port == "443") || (req.URL.Scheme == "http" && port == "80")) {
		host = h
	}
	signed := map[string]string{"host": host}
	for k, vs := range req.Header {
		lk := strings.ToLower(k)
		if lk == "content-type" || strings.HasPrefix(lk, "x-amz-") {
			vals := make([]string, len(vs))
			for i, v := range vs {
				vals[i] = strings.Join(strings.Fields(v), " ")
			}
			signed[lk] = strings.Join(vals, ",")
		}
	}
	names := make([]string, 0, len(signed))
	for k := range signed {
		names = append(names, k)
	}
	sort.Strings(names)
	var ch strings.Builder
	for _, k := range names {
		ch.WriteString(k + ":" + signed[k] + "\n")
	}
	signedHeaders := strings.Join(names, ";")
	canonical := strings.Join([]string{req.Method, awsCanonicalURI(req.URL, a.Service), awsCanonicalQuery(req.URL), ch.String(), signedHeaders, payloadHash}, "\n")
	scope := day + "/" + a.Region + "/" + a.Service + "/aws4_request"
	toSign := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + sha256Hex([]byte(canonical))
	key := hmacSHA256([]byte("AWS4"+a.SecretKey), day)
	key = hmacSHA256(key, a.Region)
	key = hmacSHA256(key, a.Service)
	key = hmacSHA256(key, "aws4_request")
	sig := hex.EncodeToString(hmacSHA256(key, toSign))
	setHeader(req.Header, "Authorization", "AWS4-HMAC-SHA256 Credential="+a.AccessKey+"/"+scope+", SignedHeaders="+signedHeaders+", Signature="+sig)
}

// setHeader troca o header ignorando maiúsculas (os nomes ficam como o usuário digitou)
func setHeader(h http.Header, name, value string) {
	for k := range h {
		if strings.EqualFold(k, name) {
			delete(h, k)
		}
	}
	h[name] = []string{value}
}
