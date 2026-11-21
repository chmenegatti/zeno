package httpc

import (
	"crypto/md5"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// exemplo da documentação da AWS (IAM ListUsers), assinatura conhecida
func TestSignAWSV4Exemplo(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08", nil)
	req.Header["Content-Type"] = []string{"application/x-www-form-urlencoded; charset=utf-8"}
	SignAWSV4(req, nil, AWSAuth{AccessKey: "AKIDEXAMPLE", SecretKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", Region: "us-east-1", Service: "iam"}, time.Date(2015, 8, 30, 12, 36, 0, 0, time.UTC))
	want := "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7"
	if got := req.Header.Get("Authorization"); got != want {
		t.Errorf("\n%s\n%s", got, want)
	}
	if req.Header.Get("X-Amz-Date") != "20150830T123600Z" {
		t.Error(req.Header.Get("X-Amz-Date"))
	}
}

func TestSignAWSV4S3ETokenDeSessao(t *testing.T) {
	req, _ := http.NewRequest("PUT", "https://bucket.s3.amazonaws.com/a b.txt", nil)
	SignAWSV4(req, []byte("oi"), AWSAuth{AccessKey: "K", SecretKey: "S", SessionToken: "T", Region: "sa-east-1", Service: "s3"}, time.Unix(0, 0))
	a := req.Header.Get("Authorization")
	if !strings.Contains(a, "SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token") || req.Header.Get("X-Amz-Security-Token") != "T" || req.Header.Get("X-Amz-Content-Sha256") == "" {
		t.Errorf("%s %v", a, req.Header)
	}
}

// exemplo da RFC 2617 (Mufasa)
func TestDigestRFC2617(t *testing.T) {
	ch, ok := parseChallenge(`Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"`)
	if !ok {
		t.Fatal("desafio")
	}
	h := digestHeader(DigestAuth{Username: "Mufasa", Password: "Circle Of Life"}, ch, "GET", "/dir/index.html", nil, "0a4f113b")
	if !strings.Contains(h, `response="6629fae49393a05397450978507c4ef1"`) || !strings.Contains(h, `opaque="5ccc069c403ebaf9f0171e9517f40e41"`) || !strings.Contains(h, "qop=auth, nc=00000001") {
		t.Error(h)
	}
	if _, ok := parseChallenge(`Basic realm="x"`); ok {
		t.Error("Basic não é Digest")
	}
}

// servidor Digest de verdade (MD5, qop=auth): 401 com desafio, depois confere a resposta
func TestSendDigest(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, ok := parseChallenge(r.Header.Get("Authorization"))
		if ok {
			md := func(s string) string { h := md5.Sum([]byte(s)); return hex.EncodeToString(h[:]) }
			ha1, ha2 := md("ana:zeno:s3nha"), md(r.Method+":"+got["uri"])
			if got["nonce"] == "n1" && got["uri"] == r.URL.RequestURI() && got["response"] == md(ha1+":n1:"+got["nc"]+":"+got["cnonce"]+":auth:"+ha2) {
				w.Write([]byte("entrou"))
				return
			}
		}
		w.Header().Set("WWW-Authenticate", `Digest realm="zeno", nonce="n1", qop="auth"`)
		w.WriteHeader(401)
	}))
	defer srv.Close()
	p := prep("GET", srv.URL+"/x?y=1")
	p.Digest = &DigestAuth{Username: "ana", Password: "s3nha"}
	r := Send("d1", p, CookieHooks{})
	if r.Num("status", 0) != 200 || r.Str("body") != "entrou" || len(r.Map("timeline").List("hops")) != 2 {
		t.Errorf("status %v body %q hops %d", r.Get("status"), r.Str("body"), len(r.Map("timeline").List("hops")))
	}
	p.Digest.Password = "errada"
	if r := Send("d2", p, CookieHooks{}); r.Num("status", 0) != 401 || len(r.Map("timeline").List("hops")) != 2 {
		t.Errorf("senha errada: %v", r.Get("status"))
	}
}

func TestSendAWS(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(r.Header.Get("Authorization") + "|" + r.Header.Get("X-Amz-Date")))
	}))
	defer srv.Close()
	p := prep("GET", srv.URL+"/")
	p.AWS = &AWSAuth{AccessKey: "AK", SecretKey: "SK", Region: "us-east-1", Service: "execute-api"}
	r := Send("a1", p, CookieHooks{})
	if b := r.Str("body"); !strings.HasPrefix(b, "AWS4-HMAC-SHA256 Credential=AK/") || !strings.Contains(b, "/us-east-1/execute-api/aws4_request") || strings.HasSuffix(b, "|") {
		t.Error(b)
	}
}
