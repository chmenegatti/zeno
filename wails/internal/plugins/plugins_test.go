package plugins

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

const example = "../../../examples/plugins/zeno-plugin-exemplo"

func copyDir(t *testing.T, src, dst string) {
	t.Helper()
	_ = filepath.WalkDir(src, func(p string, d os.DirEntry, err error) error {
		rel, _ := filepath.Rel(src, p)
		if d.IsDir() {
			return os.MkdirAll(filepath.Join(dst, rel), 0o755)
		}
		b, _ := os.ReadFile(p)
		return os.WriteFile(filepath.Join(dst, rel), b, 0o644)
	})
}

// pasta de plugins temporária com o exemplo e os plugins dados (nome → index.js)
func newTest(t *testing.T, extra map[string]string, off ...string) *Plugins {
	dir := t.TempDir()
	copyDir(t, example, filepath.Join(dir, "exemplo"))
	for name, code := range extra {
		_ = os.MkdirAll(filepath.Join(dir, name), 0o755)
		_ = os.WriteFile(filepath.Join(dir, name, "package.json"), []byte(`{"name":"`+name+`","main":"index.js"}`), 0o644)
		_ = os.WriteFile(filepath.Join(dir, name, "index.js"), []byte(code), 0o644)
	}
	p := New(dir, func(id string) bool { return slices.Contains(off, id) })
	p.Load()
	return p
}

var vars = doc.New("usuario", "ana")
var varRe = regexp.MustCompile(`\{\{\s*(\w+)\s*\}\}`)

func render(s string) string {
	return varRe.ReplaceAllStringFunc(s, func(m string) string { return vars.Str(varRe.FindStringSubmatch(m)[1]) })
}

func byID(p *Plugins) map[string]Info {
	out := map[string]Info{}
	for _, i := range p.List() {
		out[i.ID] = i
	}
	return out
}

// mesmos casos de test/plugins.test.ts
func TestExemplo(t *testing.T) {
	p := newTest(t, nil)
	ex := byID(p)["exemplo"]
	if !ex.Enabled || ex.DisplayName != "Exemplo do Zeno" || ex.RequestHooks != 1 || len(ex.RequestActions) != 1 || ex.RequestActions[0].Label != "Copiar URL final" || len(ex.Importers) != 1 || ex.Importers[0].Name != "CSV de requests" {
		t.Fatalf("info: %+v", ex)
	}
	if len(ex.TemplateTags) != 2 || ex.TemplateTags[0].Name != "minha_funcao" || ex.TemplateTags[1].Name != "hmac_exemplo" {
		t.Errorf("tags: %+v", ex.TemplateTags)
	}
	if a := ex.TemplateTags[0].Args[1]; a.DisplayName != "Maiúsculas" || a.Type != "boolean" {
		t.Errorf("arg: %+v", a)
	}
	if v, err := p.RunTag("minha_funcao", []string{"{{ usuario }}", "true"}, render, vars); err != nil || v != "OLÁ, ANA!" {
		t.Errorf("minha_funcao: %q %v", v, err)
	}
	mac := hmac.New(sha256.New, []byte("k"))
	mac.Write([]byte("x"))
	if v, err := p.RunTag("hmac_exemplo", []string{"k", "x", "hex"}, render, vars); err != nil || v != hex.EncodeToString(mac.Sum(nil)) {
		t.Errorf("hmac: %q %v", v, err)
	}
}

func TestHookAcaoEImportador(t *testing.T) {
	p := newTest(t, nil)
	req, warns := p.BeforeSend(HookRequest{Method: "GET", URL: "http://x", Headers: [][2]string{{"Accept", "*/*"}}}, vars)
	if len(warns) > 0 || !slices.Contains(req.Headers, [2]string{"X-Zeno-Plugin", "exemplo"}) {
		t.Errorf("hook: %+v %v", req, warns)
	}
	msgs, clip, err := p.RunAction("exemplo", 0, ActionRequest{Name: "r", HookRequest: HookRequest{Method: "GET", URL: "http://x/final", Headers: [][2]string{}}})
	if err != nil || !slices.Equal(msgs, []string{"URL copiada: http://x/final"}) || clip == nil || *clip != "http://x/final" {
		t.Errorf("ação: %v %v %v", msgs, clip, err)
	}
	ims := p.Importers()
	text := "nome,metodo,url\nListar,GET,http://api/itens\nCriar,POST,http://api/itens"
	if len(ims) != 1 || !ims[0].Detect(text) || ims[0].Detect("outra coisa") {
		t.Fatalf("detect")
	}
	v, err := ims[0].Convert(text)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := doc.Marshal(v)
	if !strings.Contains(string(b), `"name":"Importado do CSV"`) || !strings.Contains(string(b), `"name":"Criar","method":"POST"`) {
		t.Errorf("convert: %s", b)
	}
}

func TestPluginComErroNaoDerruba(t *testing.T) {
	p := newTest(t, map[string]string{
		"quebrado": "module.exports = {",
		"fs":       "const fs = require('fs'); module.exports.templateTags = [{ name: 'x', run: () => 1 }]",
		"laco":     "while (true) {}",
		"vazio":    "module.exports = {}",
		"lento":    "module.exports.templateTags = [{ name: 'lento', run: () => { while (true) {} } }]",
		"espera":   "module.exports.templateTags = [{ name: 'espera', run: () => new Promise(() => {}) }]",
	})
	by := byID(p)
	if by["quebrado"].Enabled || by["quebrado"].Error == "" {
		t.Errorf("quebrado: %+v", by["quebrado"])
	}
	if !strings.Contains(by["fs"].Error, "não é permitido") {
		t.Errorf("fs: %q", by["fs"].Error)
	}
	if !regexp.MustCompile(`tempo|passou`).MatchString(by["laco"].Error) {
		t.Errorf("laço: %q", by["laco"].Error)
	}
	if !strings.Contains(by["vazio"].Error, "não exporta nada") || !by["exemplo"].Enabled {
		t.Errorf("vazio/exemplo: %+v", by)
	}
	// função travada: estoura o tempo e vira erro, sem travar o resto
	old := CallTimeout
	CallTimeout = 300 * time.Millisecond
	defer func() { CallTimeout = old }()
	if _, err := p.RunTag("lento", nil, render, vars); err == nil || !strings.Contains(err.Error(), "plugin lento") {
		t.Errorf("lento: %v", err)
	}
	if _, err := p.RunTag("espera", nil, render, vars); err == nil || !strings.Contains(err.Error(), "passou de") {
		t.Errorf("espera: %v", err)
	}
	// e o interpretador do plugin travado continua usável
	if v, err := p.RunTag("minha_funcao", []string{"Bia", "false"}, render, vars); err != nil || v != "Olá, Bia!" {
		t.Errorf("depois: %q %v", v, err)
	}
}

func TestArgumentosComTipo(t *testing.T) {
	p := newTest(t, map[string]string{
		"tipos": "module.exports.templateTags = [{ name: 'soma', args: [{ type: 'number' }, { type: 'number' }, { type: 'boolean' }], run: (c, a, b, neg) => (neg ? -(a + b) : a + b) + ':' + typeof a + ':' + typeof neg }]",
	})
	if v, _ := p.RunTag("soma", []string{"2", "3", "false"}, render, vars); v != "5:number:boolean" {
		t.Errorf("%q", v)
	}
	if v, _ := p.RunTag("soma", []string{"2", "3", "true"}, render, vars); v != "-5:number:boolean" {
		t.Errorf("%q", v)
	}
}

func TestDesligadoNaoRoda(t *testing.T) {
	p := newTest(t, nil, "exemplo")
	if p.List()[0].Enabled || p.HasTag("minha_funcao") {
		t.Error("desligado")
	}
	if r, _ := p.BeforeSend(HookRequest{Method: "GET", URL: "http://x", Headers: [][2]string{}}, doc.New()); len(r.Headers) != 0 {
		t.Errorf("hook rodou: %v", r.Headers)
	}
}

func TestModulosEGlobais(t *testing.T) {
	p := newTest(t, map[string]string{
		"mods": `const crypto = require('crypto'), { URL } = require('url'), qs = require('querystring'), EE = require('events'), assert = require('assert')
module.exports.templateTags = [{ name: 'mods', run: async (ctx) => {
  const e = new EE(); let got = 0; e.on('x', (n) => { got = n }); e.emit('x', 7)
  assert.equal(got, 7)
  await new Promise((r) => setTimeout(r, 10))
  const u = new URL('https://a.b/c?d=1')
  const r = await ctx.util.render('{{ usuario }}')
  return [crypto.createHash('md5').update('abc').digest('hex'), u.host, qs.stringify({ a: [1, 2] }), Buffer.from('oi').toString('base64'), btoa('oi'), new TextDecoder().decode(new TextEncoder().encode('é')), r, ctx.context.usuario, crypto.randomUUID().length].join('|')
} }]`,
	})
	v, err := p.RunTag("mods", nil, render, vars)
	if err != nil || v != "900150983cd24fb0d6963f7d28e17f72|a.b|a=1&a=2|b2k=|b2k=|é|ana|ana|36" {
		t.Errorf("%q %v", v, err)
	}
}
