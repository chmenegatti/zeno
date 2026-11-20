package scripts

import (
	"encoding/base64"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

func input() *Doc {
	return doc.New("phase", "post", "where", "Login", "env", doc.New("tenant", "acme"), "base", doc.New("base_url", "https://x.test"), "vars", doc.New(),
		"request", doc.New("method", "POST", "url", "{{ base_url }}/login", "headers", []any{}, "params", []any{}, "body", doc.New("mime", "application/json", "text", "{}")),
		"response", doc.New("code", int64(200), "status", "OK", "headers", []any{[]any{"Content-Type", "application/json"}, []any{"X-Id", "7"}}, "body", `{"token":"abc","user":{"id":1,"roles":["adm"]}}`, "time", int64(12)))
}

func js(v any) string { b, _ := doc.Marshal(v); return string(b) }

func run(code string, in *Doc) *Doc { return Run(code, in, false, Timeout) }

// mesmos casos de test/scripts.test.ts
func TestPosLoginGuardaToken(t *testing.T) {
	out := run(`zeno.environment.set('token', zeno.response.json().token)`, input())
	if out.Str("error") != "" || js(out.Get("env")) != `{"tenant":"acme","token":"abc"}` {
		t.Errorf("%s", js(out))
	}
}

func TestTestesEExpect(t *testing.T) {
	out := run(`
      insomnia.test('status 200', () => insomnia.expect(insomnia.response.code).to.equal(200))
      pm.test('corpo', () => {
        const b = pm.response.json()
        pm.expect(b).to.have.property('token').that.is.a('string')
        pm.expect(b.user).to.deep.equal({ id: 1, roles: ['adm'] })
        pm.expect(b.user.roles).to.include('adm').and.have.lengthOf(1)
        pm.expect(b.token).to.not.be.empty
        pm.response.to.have.status(200)
        pm.response.to.be.ok
        pm.response.to.have.header('X-Id', '7')
      })
      zeno.test('falha', () => zeno.expect(zeno.response.code, 'código').to.be.below(100))
      zeno.test('async', async () => { await null; zeno.expect(1).to.eql(1) })
      `, input())
	if out.Str("error") != "" {
		t.Fatal(out.Str("error"))
	}
	var got [][2]any
	for _, x := range out.List("tests") {
		d := x.(*Doc)
		got = append(got, [2]any{d.Str("name"), d.Get("ok")})
	}
	want := [][2]any{{"status 200", true}, {"corpo", true}, {"falha", false}, {"async", true}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("testes: %v", got)
	}
	if e := out.List("tests")[2].(*Doc).Str("error"); e != "código: esperado 200 menor que 100" {
		t.Errorf("erro: %q", e)
	}
}

func TestPreRequestMexeNoRequest(t *testing.T) {
	in := input()
	in.Set("phase", "pre")
	in.Del("response")
	out := run(`
      zeno.request.headers.add({ key: 'X-Trace', value: 't1' })
      zeno.request.addHeader('X-B: 2')
      zeno.request.url = zeno.request.url + '?v=1'
      zeno.request.body.raw = JSON.stringify({ a: zeno.variables.get('tenant') })
      zeno.variables.set('local', 42)
      console.log('url', zeno.request.url, { ok: true })
      `, in)
	if out.Str("error") != "" {
		t.Fatal(out.Str("error"))
	}
	r := out.Map("request")
	if js(r.Get("headers")) != `[{"name":"X-Trace","value":"t1","enabled":true},{"name":"X-B","value":"2","enabled":true}]` || r.Str("url") != "{{ base_url }}/login?v=1" || r.Map("body").Str("text") != `{"a":"acme"}` {
		t.Errorf("request: %s", js(r))
	}
	if js(out.Get("vars")) != `{"local":42}` || js(out.Get("logs")) != `["url {{ base_url }}/login?v=1 {\"ok\":true}"]` {
		t.Errorf("vars/logs: %s %s", js(out.Get("vars")), js(out.Get("logs")))
	}
}

func TestPadroesDoInsomnia(t *testing.T) {
	in := input()
	in.Set("phase", "pre")
	in.Del("response")
	in.Map("request").Set("url", "https://api.test/login")
	out := run(`
      insomnia.request.url.addQueryParams('page=2&q=a')
      insomnia.request.addHeader({ key: 'Authorization', value: 'Basic ' + btoa('ana:s3nha') })
      const host = insomnia.request.url.getHost()
      insomnia.environment.set('url', insomnia.request.url.toString() + '#' + host)
      insomnia.environment.set('volta', atob(btoa('olá')))
      `, in)
	if out.Str("error") != "" {
		t.Fatal(out.Str("error"))
	}
	if js(out.Map("request").Get("params")) != `[{"name":"page","value":"2","enabled":true},{"name":"q","value":"a","enabled":true}]` {
		t.Errorf("params: %s", js(out.Map("request").Get("params")))
	}
	if v := out.Map("request").List("headers")[0].(*Doc).Str("value"); v != "Basic "+base64.StdEncoding.EncodeToString([]byte("ana:s3nha")) {
		t.Errorf("basic: %s", v)
	}
	if out.Map("env").Str("url") != "https://api.test/login#api.test" || out.Map("env").Str("volta") != "olá" {
		t.Errorf("env: %s", js(out.Get("env")))
	}
}

func TestAmbienteAtivoEhOBase(t *testing.T) {
	in := input()
	in.Set("env", in.Get("base"))
	out := Run(`zeno.environment.set('a', 1); zeno.baseEnvironment.set('b', 2)`, in, true, Timeout)
	if js(out.Get("base")) != `{"base_url":"https://x.test","a":1,"b":2}` || js(out.Get("env")) != js(out.Get("base")) {
		t.Errorf("%s / %s", js(out.Get("base")), js(out.Get("env")))
	}
}

func TestErros(t *testing.T) {
	if e := run(`zeno.response.json().nao.existe`, input()).Str("error"); !strings.HasPrefix(e, "TypeError: ") {
		t.Errorf("TypeError: %q", e)
	}
	if e := run(`const x = {`, input()).Str("error"); !strings.Contains(e, "sintaxe") {
		t.Errorf("sintaxe: %q", e)
	}
	if e := run(`throw new Error('falhou aqui')`, input()).Str("error"); e != "falhou aqui" {
		t.Errorf("throw: %q", e)
	}
	if e := run(`await new Promise(() => {})`, input()).Str("error"); !strings.Contains(e, "não terminou") {
		t.Errorf("promise: %q", e)
	}
}

func TestTimeout(t *testing.T) {
	for _, code := range []string{`while (true) {}`, `await null; while (true) {}`} {
		start := time.Now()
		if e := Run(code, input(), false, 200*time.Millisecond).Str("error"); !strings.Contains(e, "passou de 0.2 s") {
			t.Errorf("%s: %q", code, e)
		}
		if time.Since(start) > 2*time.Second {
			t.Errorf("%s demorou", code)
		}
	}
}

func TestIsolamento(t *testing.T) {
	probe := func(code string) string { return run(code, input()).Str("error") }
	cases := map[string]string{
		`require('fs')`:           `require is not defined`,
		`zeno.require('fs')`:      `require não é suportado`,
		`process.exit(1)`:         `process is not defined`,
		`setTimeout(() => {}, 1)`: `setTimeout is not defined`,
		`eval('1+1')`:             `disallowed`,
		`({}).constructor.constructor('return 1')()`:     `disallowed`,
		`zeno.environment.get.constructor('return 1')()`: `disallowed`,
		`(async () => {}).constructor('return 1')()`:     `disallowed`,
	}
	for code, want := range cases {
		if e := probe(code); !regexp.MustCompile(want).MatchString(e) {
			t.Errorf("%s: %q (quer %q)", code, e, want)
		}
	}
	if e := probe(`await import('fs')`); e == "" {
		t.Error("import deveria falhar")
	}
}

func TestRunPhase(t *testing.T) {
	base := doc.New("base_url", "https://x.test")
	in := input()
	st := State{Base: base, Env: base, EnvIsBase: true, Vars: doc.New(), Request: in.Map("request"), Response: in.Map("response")}
	rep := &Report{}
	out, failed := RunPhase("post", []Script{
		{"pasta API", `zeno.environment.set('n', 1); console.log('pasta')`},
		{"Login", `zeno.environment.set('n', zeno.environment.get('n') + 1); throw new Error('x')`},
		{"nunca", `zeno.environment.set('n', 99)`},
	}, st, rep, Timeout)
	if !failed || out.Base.Num("n", 0) != 2 || js(out.Env) != js(out.Base) {
		t.Errorf("estado: %v %s %s", failed, js(out.Base), js(out.Env))
	}
	if !reflect.DeepEqual(rep.Errors, []string{"pós-resposta (Login): x"}) || !reflect.DeepEqual(rep.Logs, []string{"[pasta API] pasta"}) {
		t.Errorf("report: %v %v", rep.Errors, rep.Logs)
	}
}
