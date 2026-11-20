package tags

import (
	"crypto/sha1"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

// mesmos casos de test/tags.test.ts

func res(body string, at time.Time) *doc.Doc {
	return doc.New("id", "r", "requestId", "req_tok", "at", at.UnixMilli(), "url", "http://x/login", "status", int64(200),
		"headers", []any{[]any{"X-Session", "abc"}}, "body", body, "bodyEncoding", "utf8")
}

func b64(s string) string { return "b64::" + base64.StdEncoding.EncodeToString([]byte(s)) }

func eq(t *testing.T, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %#v, want %#v", got, want)
	}
}

func TestParseArgs(t *testing.T) {
	for _, empty := range []string{"{% %}", "{%%}", "{%  \t %}"} {
		n, a := ParseArgs(empty)
		eq(t, n, "")
		eq(t, a, []string{})
	}
	n, a := ParseArgs("{% response 'body', 'req_tok', 'b64::JC50', 'always', 60 %}")
	eq(t, n, "response")
	eq(t, a, []string{"body", "req_tok", "b64::JC50", "always", "60"})
	_, a = ParseArgs(`{% hash 'sha256', 'hex', 'a\'b' %}`)
	eq(t, a, []string{"sha256", "hex", "a'b"})
}

func TestExtract(t *testing.T) {
	now := time.Now()
	v, _ := Extract(res(`{"access_token":"T","a":[{"b":1}]}`, now), "body", b64("$.access_token"))
	eq(t, v, "T")
	v, _ = Extract(res(`{"a":[{"b":1}]}`, now), "body", "$.a[0].b")
	eq(t, v, "1")
	v, _ = Extract(res(`<response><result><key>K</key></result></response>`, now), "body", b64("response/result/key"))
	eq(t, v, "K")
	v, _ = Extract(res("", now), "header", b64("x-session"))
	eq(t, v, "abc")
	// resposta recém-enviada (dependência): headers como [][2]string
	fresh := res("", now)
	fresh.Set("headers", [][2]string{{"X-Session", "abc"}})
	v, _ = Extract(fresh, "header", b64("x-session"))
	eq(t, v, "abc")
	v, _ = Extract(res(`{"a":[{"id":1},{"id":2}]}`, now), "body", "$.a[-1].id")
	eq(t, v, "2")
	v, _ = Extract(res(`{"a":[{"id":1},{"id":2}]}`, now), "body", "$..id")
	eq(t, v, "[1,2]")
	v, _ = Extract(res(`{"a":1}`, now), "raw", "")
	eq(t, v, `{"a":1}`)
	eq(t, DecodeFilter("b64::JC5hY2Nlc3NfdG9rZW4=::46b"), "$.access_token")
	eq(t, DecodeFilter(b64("$.ação")), "$.ação")
}

func TestWhenExpired(t *testing.T) {
	sent := 0
	ctx := func(r *doc.Doc) *Context {
		return &Context{Latest: func(string) *doc.Doc { return r }, SendByID: func(string) (*doc.Doc, error) { sent++; return res(`{"token":"novo"}`, time.Now()), nil }}
	}
	tag := "{% response 'body', 'req_tok', '" + b64("$.token") + "', 'when-expired', 60 %}"
	v, _, _ := Resolve([]string{tag}, ctx(res(`{"token":"velho"}`, time.Now())))
	eq(t, v[tag], "velho")
	eq(t, sent, 0)
	v, _, _ = Resolve([]string{tag}, ctx(res(`{"token":"velho"}`, time.Now().Add(-120*time.Second))))
	eq(t, v[tag], "novo")
	eq(t, sent, 1)
	_, errs, _ := Resolve([]string{"{% response 'body', 'req_x', '', 'never' %}"}, &Context{Latest: func(string) *doc.Doc { return nil }})
	if len(errs) != 1 || !strings.Contains(errs[0], "ainda não tem resposta") {
		t.Errorf("never: %v", errs)
	}
}

func TestFuncoes(t *testing.T) {
	vars := map[string]string{"user": "ana", "pass": "s3nha", "perfil": `{"id":7,"tags":["a","b"]}`}
	re := regexp.MustCompile(`\{\{\s*(\w+)\s*\}\}`)
	c := &Context{Render: func(s string) string {
		return re.ReplaceAllStringFunc(s, func(m string) string { return vars[re.FindStringSubmatch(m)[1]] })
	}}
	must := func(name string, args ...string) string {
		t.Helper()
		v, err := EvalFn(name, args, c)
		if err != nil {
			t.Fatal(name, err)
		}
		return v
	}
	if n, _ := strconv.ParseInt(must("timestamp", "millis"), 10, 64); n < 1.7e12 {
		t.Error("millis")
	}
	if !regexp.MustCompile(`^\d{10}$`).MatchString(must("timestamp", "unix")) || !regexp.MustCompile(`^\d{4}-\d\d-\d\dT`).MatchString(must("timestamp", "iso")) {
		t.Error("timestamp")
	}
	eq(t, must("hash", "sha256", "hex", "abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
	eq(t, must("hash", "md5", "abc"), "900150983cd24fb0d6963f7d28e17f72")
	s := sha1.Sum([]byte("ana"))
	eq(t, must("hash", "sha1", "base64", "{{ user }}"), base64.StdEncoding.EncodeToString(s[:]))
	if _, err := EvalFn("hash", []string{"crc32", "hex", "x"}, nil); err == nil || !strings.Contains(err.Error(), "não suportado") {
		t.Error("crc32")
	}
	eq(t, must("base64", "encode", "normal", "{{ user }}:{{ pass }}"), "YW5hOnMzbmhh")
	eq(t, must("base64", "decode", "YW5hOnMzbmhh"), "ana:s3nha")
	eq(t, must("base64", "encode", "url", "??>>"), "Pz8-Pg")
	eq(t, must("base64", "decode", "url", "Pz8-Pg"), "??>>")
	f := filepath.Join(t.TempDir(), "k.txt")
	_ = os.WriteFile(f, []byte("conteúdo"), 0o644)
	eq(t, must("file", f), "conteúdo")
	if _, err := EvalFn("file", []string{""}, nil); err == nil || !strings.Contains(err.Error(), "caminho") {
		t.Error("file vazio")
	}
	eq(t, must("jsonpath", "{{ perfil }}", "$.id"), "7")
	eq(t, must("jsonpath", "{{ perfil }}", "$.tags"), `["a","b"]`)
	if _, err := EvalFn("jsonpath", []string{"não é json", "$.a"}, nil); err == nil || !strings.Contains(err.Error(), "JSON") {
		t.Error("jsonpath inválido")
	}
	eq(t, FnArgs("timestamp", nil), []string{"millis"})
	eq(t, FnArgs("hash", []string{"md5", "x"}), []string{"md5", "hex", "x"})
}

func TestFaker(t *testing.T) {
	if v, _ := EvalFn("faker", []string{"randomEmail"}, nil); !regexp.MustCompile(`^[\w.]+@[\w.]+$`).MatchString(v) {
		t.Errorf("email: %s", v)
	}
	if v, _ := Fake("$randomUUID"); !regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).MatchString(v) {
		t.Errorf("uuid: %s", v)
	}
	v, _ := Fake("randomCPF")
	d := []int{}
	for _, r := range v {
		if r >= '0' && r <= '9' {
			d = append(d, int(r-'0'))
		}
	}
	dv := func(n int) int {
		s := 0
		for i := 0; i < n; i++ {
			s += d[i] * (n + 1 - i)
		}
		s %= 11
		if s < 2 {
			return 0
		}
		return 11 - s
	}
	eq(t, []int{d[9], d[10]}, []int{dv(9), dv(10)})
	for k := range Faker {
		if v, _ := Fake(k); v == "" {
			t.Errorf("%s vazio", k)
		}
	}
	if _, err := EvalFn("faker", []string{"naoExiste"}, nil); err == nil || !strings.Contains(err.Error(), "não existe") {
		t.Error("desconhecido")
	}
}

func TestPrompt(t *testing.T) {
	n := 0
	tag := "{% prompt 'Código', 'do app', '', 'otp', true %}"
	c := &Context{Ask: func(p Prompt) (string, bool) {
		n++
		eq(t, p, Prompt{Title: "Código", Label: "do app", Key: "otp", Mask: true})
		return "123456", true
	}}
	v, _, _ := Resolve([]string{tag, tag}, c)
	eq(t, v[tag], "123456")
	eq(t, n, 1)
	_, _, err := Resolve([]string{tag}, &Context{Ask: func(Prompt) (string, bool) { return "", false }})
	var pc *ErrPromptCancelled
	if !errors.As(err, &pc) {
		t.Errorf("cancelar: %v", err)
	}
	_, errs, _ := Resolve([]string{tag}, &Context{})
	if len(errs) != 1 || !strings.Contains(errs[0], "pergunta na hora de enviar") {
		t.Errorf("sem prompt: %v", errs)
	}
}

func TestResponsePorNome(t *testing.T) {
	tree := []any{
		doc.New("kind", "folder", "id", "f1", "name", "Auth", "children", []any{doc.New("kind", "request", "id", "req_1", "name", "Login")}),
		doc.New("kind", "folder", "id", "f2", "name", "Admin", "children", []any{doc.New("kind", "request", "id", "req_2", "name", "Login"), doc.New("kind", "request", "id", "req_3", "name", "Usuários")}),
	}
	id := func(ref string) string {
		if n := FindRequestRef(tree, ref); n != nil {
			return n.Str("id")
		}
		return ""
	}
	eq(t, id("req_3"), "req_3")
	eq(t, id("Usuários"), "req_3")
	eq(t, id("auth/login"), "req_1")
	eq(t, id("Admin / Login"), "req_2")
	eq(t, id("Login"), "") // ambíguo
	asked := ""
	tag := "{% response 'body', 'Auth / Login', '$.t', 'never' %}"
	v, _, _ := Resolve([]string{tag}, &Context{Latest: func(id string) *doc.Doc { asked = id; return res(`{"t":"ok"}`, time.Now()) }, ResolveRequest: id})
	eq(t, []string{asked, v[tag]}, []string{"req_1", "ok"})
}
