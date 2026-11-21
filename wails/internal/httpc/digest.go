package httpc

// HTTP Digest (#150, RFC 7616/2617): no 401 com WWW-Authenticate: Digest, reenvia com o header calculado.
// MD5, MD5-sess, SHA-256 e SHA-256-sess; qop auth (auth-int quando é a única opção).

import (
	"crypto/md5"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"hash"
	"strings"

	"github.com/chmenegatti/zeno/wails/internal/vars"
)

// DigestAuth: usuário e senha já resolvidos (vars.Prepare)
type DigestAuth = vars.DigestAuth

// parseChallenge: parâmetros de "Digest realm="x", nonce="y", qop="auth,auth-int""
func parseChallenge(h string) (map[string]string, bool) {
	scheme, rest, _ := strings.Cut(strings.TrimSpace(h), " ")
	if !strings.EqualFold(scheme, "Digest") {
		return nil, false
	}
	out := map[string]string{}
	for rest != "" {
		rest = strings.TrimLeft(rest, " ,")
		k, v, ok := strings.Cut(rest, "=")
		if !ok {
			break
		}
		k = strings.ToLower(strings.TrimSpace(k))
		v = strings.TrimLeft(v, " ")
		if strings.HasPrefix(v, `"`) {
			end := 1
			for end < len(v) && (v[end] != '"' || v[end-1] == '\\') {
				end++
			}
			out[k] = strings.ReplaceAll(v[1:min(end, len(v))], `\"`, `"`)
			rest = v[min(end+1, len(v)):]
		} else {
			val, r, _ := strings.Cut(v, ",")
			out[k] = strings.TrimSpace(val)
			rest = r
		}
	}
	return out, true
}

func newCnonce() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// digestHeader monta o Authorization pra method/uri a partir do desafio
func digestHeader(a DigestAuth, ch map[string]string, method, uri string, body []byte, cnonce string) string {
	alg := strings.ToUpper(ch["algorithm"])
	if alg == "" {
		alg = "MD5"
	}
	newHash := func() hash.Hash { return md5.New() }
	if strings.HasPrefix(alg, "SHA-256") {
		newHash = sha256.New
	}
	H := func(s string) string {
		h := newHash()
		h.Write([]byte(s))
		return hex.EncodeToString(h.Sum(nil))
	}
	qop := ""
	if q := ch["qop"]; q != "" {
		opts := strings.Split(q, ",")
		for _, o := range opts {
			if strings.TrimSpace(o) == "auth" {
				qop = "auth"
			}
		}
		if qop == "" && strings.TrimSpace(opts[0]) == "auth-int" {
			qop = "auth-int"
		}
	}
	nc := "00000001"
	ha1 := H(a.Username + ":" + ch["realm"] + ":" + a.Password)
	if strings.HasSuffix(alg, "-SESS") {
		ha1 = H(ha1 + ":" + ch["nonce"] + ":" + cnonce)
	}
	ha2 := H(method + ":" + uri)
	if qop == "auth-int" {
		ha2 = H(method + ":" + uri + ":" + H(string(body)))
	}
	var resp string
	if qop != "" {
		resp = H(ha1 + ":" + ch["nonce"] + ":" + nc + ":" + cnonce + ":" + qop + ":" + ha2)
	} else {
		resp = H(ha1 + ":" + ch["nonce"] + ":" + ha2)
	}
	q := func(s string) string { return `"` + strings.ReplaceAll(s, `"`, `\"`) + `"` }
	parts := []string{"username=" + q(a.Username), "realm=" + q(ch["realm"]), "nonce=" + q(ch["nonce"]), "uri=" + q(uri)}
	if ch["algorithm"] != "" {
		parts = append(parts, "algorithm="+ch["algorithm"])
	}
	parts = append(parts, "response="+q(resp))
	if ch["opaque"] != "" {
		parts = append(parts, "opaque="+q(ch["opaque"]))
	}
	if qop != "" {
		parts = append(parts, "qop="+qop, "nc="+nc, "cnonce="+q(cnonce))
	}
	return "Digest " + strings.Join(parts, ", ")
}
