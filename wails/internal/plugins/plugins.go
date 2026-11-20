// Package plugins: plugins no formato do Insomnia (templateTags, requestHooks, responseHooks,
// requestActions) + importadores, port de src/main/plugins.ts.
//
// Cada plugin mora em <dataDir>/plugins/<pasta>/ com package.json ("main") e roda no próprio
// interpretador JavaScript (goja) com laço de eventos (setTimeout, promises). require só de módulos sem
// efeito colateral (crypto, url, buffer, util, querystring, events, assert) e de arquivos da própria
// pasta; sem fs, rede ou processos. Carga e chamadas têm tempo máximo; erro num plugin não derruba o app.
package plugins

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/i18n"
	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/buffer"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/dop251/goja_nodejs/url"
	"github.com/dop251/goja_nodejs/util"
)

//go:embed runtime.js
var runtimeJS string

// tempos máximos (como no Electron)
var (
	LoadTimeout = 2 * time.Second
	CallTimeout = 5 * time.Second
)

// módulos do Node liberados (os do Electron que existem aqui)
var allowed = []string{"crypto", "url", "buffer", "util", "querystring", "events", "assert"}

// sem equivalente no Go ainda: avisam com mensagem clara
var missing = []string{"string_decoder", "punycode", "zlib"}

// Arg: argumento declarado de uma tag (PluginArg)
type Arg struct {
	DisplayName  string   `json:"displayName"`
	Type         string   `json:"type"`
	DefaultValue any      `json:"defaultValue,omitempty"`
	Placeholder  string   `json:"placeholder,omitempty"`
	Options      []Option `json:"options,omitempty"`
}

// Option de argumento enum
type Option struct {
	DisplayName string `json:"displayName"`
	Value       string `json:"value"`
}

// TagInfo: tag {% %} de um plugin
type TagInfo struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Description string `json:"description,omitempty"`
	Args        []Arg  `json:"args"`
}

// Action: item do menu do request
type Action struct {
	Label string `json:"label"`
	Icon  string `json:"icon,omitempty"`
}

// Info: o que a tela de plugins mostra (PluginInfo)
type Info struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	DisplayName    string    `json:"displayName"`
	Description    string    `json:"description,omitempty"`
	Version        string    `json:"version,omitempty"`
	Dir            string    `json:"dir"`
	Enabled        bool      `json:"enabled"`
	Error          string    `json:"error,omitempty"`
	TemplateTags   []TagInfo `json:"templateTags"`
	RequestHooks   int       `json:"requestHooks"`
	ResponseHooks  int       `json:"responseHooks"`
	RequestActions []Action  `json:"requestActions"`
	Importers      []struct {
		Name string `json:"name"`
	} `json:"importers"`
}

type importer struct {
	name            string
	detect, convert goja.Value
}

type plugin struct {
	info      Info
	loop      *eventloop.EventLoop
	vm        *goja.Runtime
	tags      map[string]goja.Value
	reqHooks  []goja.Value
	respHooks []goja.Value
	actions   []goja.Value
	importers []importer
}

// Plugins: os plugins de uma pasta
type Plugins struct {
	dir      string
	disabled func(id string) bool
	mu       sync.Mutex
	loaded   []*plugin
}

// New: dir vazio = sem plugins (CLI sem pasta)
func New(dir string, disabled func(string) bool) *Plugins {
	if disabled == nil {
		disabled = func(string) bool { return false }
	}
	return &Plugins{dir: dir, disabled: disabled}
}

// Load (re)carrega tudo da pasta; nunca falha
func (ps *Plugins) Load() []Info {
	ps.mu.Lock()
	for _, p := range ps.loaded {
		if p.loop != nil {
			p.loop.StopNoWait()
		}
	}
	ps.loaded = nil
	if ps.dir != "" {
		ents, _ := os.ReadDir(ps.dir)
		for _, e := range ents {
			if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
				ps.loaded = append(ps.loaded, loadOne(filepath.Join(ps.dir, e.Name())))
			}
		}
	}
	slices.SortStableFunc(ps.loaded, func(a, b *plugin) int {
		return strings.Compare(strings.ToLower(a.info.DisplayName), strings.ToLower(b.info.DisplayName))
	})
	ps.mu.Unlock()
	return ps.List()
}

// List: plugins com o estado (ligado = carregou sem erro e não foi desligado)
func (ps *Plugins) List() []Info {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	out := []Info{}
	for _, p := range ps.loaded {
		i := p.info
		i.Enabled = i.Error == "" && !ps.disabled(i.ID)
		out = append(out, i)
	}
	return out
}

func (ps *Plugins) active() []*plugin {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	var out []*plugin
	for _, p := range ps.loaded {
		if p.info.Error == "" && !ps.disabled(p.info.ID) {
			out = append(out, p)
		}
	}
	return out
}

func clip(v any, max int) string {
	s, _ := v.(string)
	if len([]rune(s)) > max {
		return string([]rune(s)[:max])
	}
	return s
}

var tagName = regexp.MustCompile(`^[A-Za-z_]\w*$`)

func loadOne(dir string) *plugin {
	id := filepath.Base(dir)
	p := &plugin{info: Info{ID: id, Name: id, DisplayName: id, Dir: dir, TemplateTags: []TagInfo{}, RequestActions: []Action{}}, tags: map[string]goja.Value{}}
	p.info.Importers = []struct {
		Name string `json:"name"`
	}{}
	fail := func(err error) *plugin {
		p.info.Error = err.Error()
		if p.loop != nil {
			p.loop.StopNoWait()
			p.loop = nil
		}
		return p
	}
	raw, err := os.ReadFile(filepath.Join(dir, "package.json"))
	if err != nil {
		return fail(errors.New(i18n.T("sem package.json")))
	}
	var pkg map[string]any
	if err := json.Unmarshal(raw, &pkg); err != nil {
		return fail(fmt.Errorf(i18n.T("package.json inválido: %w"), err))
	}
	meta, _ := pkg["insomnia"].(map[string]any)
	if meta == nil {
		meta, _ = pkg["zeno"].(map[string]any)
	}
	first := func(vs ...any) string {
		for _, v := range vs {
			if s, ok := v.(string); ok && s != "" {
				return s
			}
		}
		return ""
	}
	p.info.Name = first(pkg["name"], id)
	p.info.DisplayName = first(meta["displayName"], meta["name"], pkg["name"], id)
	p.info.Description = clip(first(meta["description"], pkg["description"]), 300)
	p.info.Version = clip(pkg["version"], 40)
	mainRel := first(pkg["main"], "index.js")
	main, _ := filepath.Abs(filepath.Join(dir, mainRel))
	absDir, _ := filepath.Abs(dir)
	if !strings.HasPrefix(main, absDir+string(filepath.Separator)) {
		return fail(errors.New(i18n.T(`"main" aponta pra fora da pasta do plugin`)))
	}

	p.loop = eventloop.NewEventLoop(eventloop.EnableConsole(false))
	p.loop.Start()
	var exports *goja.Object
	_, err = p.run(LoadTimeout, i18n.T("carga"), func(vm *goja.Runtime) (goja.Value, error) {
		p.vm = vm
		if err := setup(vm, id); err != nil {
			return nil, err
		}
		v, err := runModule(vm, main, absDir, map[string]*goja.Object{})
		if err != nil {
			return nil, err
		}
		// o módulo principal precisa exportar um objeto; outro valor = nada exportado
		if o, ok := v.(*goja.Object); ok {
			exports = o
		} else {
			exports = vm.NewObject()
		}
		return goja.Undefined(), nil
	}, nil)
	if err != nil {
		return fail(err)
	}
	if err := p.collect(exports); err != nil {
		return fail(err)
	}
	return p
}

// lê o que o plugin exporta (dentro do laço do plugin)
func (p *plugin) collect(exp *goja.Object) error {
	var err error
	done := make(chan struct{})
	p.loop.RunOnLoop(func(vm *goja.Runtime) {
		defer close(done)
		arr := func(name string) []goja.Value {
			v := exp.Get(name)
			if v == nil || goja.IsUndefined(v) || goja.IsNull(v) {
				return nil
			}
			o := v.ToObject(vm)
			if o.ClassName() != "Array" {
				return nil
			}
			var out []goja.Value
			for i := 0; i < int(o.Get("length").ToInteger()); i++ {
				out = append(out, o.Get(fmt.Sprint(i)))
			}
			return out
		}
		isFn := func(v goja.Value) bool { _, ok := goja.AssertFunction(v); return ok }
		str := func(o *goja.Object, k string) string {
			v := o.Get(k)
			if v == nil || goja.IsUndefined(v) || goja.IsNull(v) {
				return ""
			}
			if s, ok := v.Export().(string); ok {
				return s
			}
			return ""
		}
		for _, t := range arr("templateTags") {
			if t == nil || goja.IsUndefined(t) || goja.IsNull(t) {
				continue
			}
			o := t.ToObject(vm)
			name := str(o, "name")
			if name == "" || !isFn(o.Get("run")) {
				continue
			}
			if !tagName.MatchString(name) {
				err = fmt.Errorf(i18n.T("templateTag com nome inválido: %s"), name)
				return
			}
			p.tags[name] = o.Get("run")
			ti := TagInfo{Name: name, DisplayName: clip(str(o, "displayName"), 200), Description: clip(str(o, "description"), 300), Args: []Arg{}}
			if ti.DisplayName == "" {
				ti.DisplayName = name
			}
			if a := o.Get("args"); a != nil && !goja.IsUndefined(a) {
				if list, ok := a.Export().([]any); ok {
					for _, x := range list {
						ti.Args = append(ti.Args, argInfo(x))
					}
				}
			}
			p.info.TemplateTags = append(p.info.TemplateTags, ti)
		}
		for _, h := range arr("requestHooks") {
			if isFn(h) {
				p.reqHooks = append(p.reqHooks, h)
			}
		}
		for _, h := range arr("responseHooks") {
			if isFn(h) {
				p.respHooks = append(p.respHooks, h)
			}
		}
		for _, a := range arr("requestActions") {
			if a == nil || goja.IsUndefined(a) || goja.IsNull(a) {
				continue
			}
			o := a.ToObject(vm)
			if !isFn(o.Get("action")) {
				continue
			}
			p.actions = append(p.actions, o.Get("action"))
			label := clip(str(o, "label"), 200)
			if label == "" {
				label = i18n.T("Ação")
			}
			p.info.RequestActions = append(p.info.RequestActions, Action{Label: label, Icon: clip(str(o, "icon"), 8)})
		}
		for _, im := range arr("importers") {
			if im == nil || goja.IsUndefined(im) || goja.IsNull(im) {
				continue
			}
			o := im.ToObject(vm)
			if !isFn(o.Get("convert")) {
				continue
			}
			name := clip(str(o, "name"), 200)
			if name == "" {
				name = p.info.ID
			}
			var det goja.Value
			if isFn(o.Get("detect")) {
				det = o.Get("detect")
			}
			p.importers = append(p.importers, importer{name, det, o.Get("convert")})
			p.info.Importers = append(p.info.Importers, struct {
				Name string `json:"name"`
			}{name})
		}
	})
	<-done
	if err != nil {
		return err
	}
	p.info.RequestHooks = len(p.reqHooks)
	p.info.ResponseHooks = len(p.respHooks)
	if len(p.tags)+len(p.reqHooks)+len(p.respHooks)+len(p.actions)+len(p.importers) == 0 {
		return errors.New(i18n.T("o plugin não exporta nada (templateTags, requestHooks, responseHooks, requestActions ou importers)"))
	}
	return nil
}

func argInfo(x any) Arg {
	m, _ := x.(map[string]any)
	t, _ := m["type"].(string)
	if !slices.Contains([]string{"string", "number", "boolean", "enum"}, t) {
		t = "string"
	}
	a := Arg{DisplayName: clip(m["displayName"], 200), Type: t, Placeholder: clip(m["placeholder"], 200)}
	if a.DisplayName == "" {
		a.DisplayName = "Valor"
	}
	switch d := m["defaultValue"].(type) {
	case string, bool, int64, float64:
		a.DefaultValue = d
	}
	if t == "enum" {
		a.Options = []Option{}
		if opts, ok := m["options"].([]any); ok {
			for _, o := range opts {
				om, _ := o.(map[string]any)
				v := fmt.Sprint(om["value"])
				if om["value"] == nil {
					v = ""
				}
				dn := v
				if s, ok := om["displayName"].(string); ok {
					dn = s
				}
				a.Options = append(a.Options, Option{DisplayName: dn, Value: v})
			}
		}
	}
	return a
}

// globais do interpretador do plugin
func setup(vm *goja.Runtime, id string) error {
	buffer.Enable(vm)
	url.Enable(vm)
	quiet := func(call goja.FunctionCall) goja.Value {
		parts := make([]string, len(call.Arguments))
		for i, a := range call.Arguments {
			parts[i] = a.String()
		}
		fmt.Fprintln(os.Stderr, "[plugin "+id+"]", strings.Join(parts, " "))
		return goja.Undefined()
	}
	con := vm.NewObject()
	for _, k := range []string{"log", "info", "warn", "error", "debug"} {
		_ = con.Set(k, quiet)
	}
	_ = vm.Set("console", con)
	_, err := vm.RunString(runtimeJS)
	return err
}

// require: módulos liberados e arquivos da própria pasta
func requireFn(vm *goja.Runtime, file, root string, cache map[string]*goja.Object) func(goja.FunctionCall) goja.Value {
	return func(call goja.FunctionCall) goja.Value {
		spec := call.Argument(0).String()
		name := strings.TrimPrefix(spec, "node:")
		if slices.Contains(allowed, name) {
			return nativeModule(vm, name)
		}
		if slices.Contains(missing, name) {
			panic(vm.NewGoError(fmt.Errorf(i18n.T("módulo %q ainda não está disponível pros plugins na versão Go"), spec)))
		}
		if strings.HasPrefix(spec, "./") || strings.HasPrefix(spec, "../") {
			target := filepath.Clean(filepath.Join(filepath.Dir(file), spec))
			if !strings.HasPrefix(target, root+string(filepath.Separator)) {
				panic(vm.NewGoError(fmt.Errorf(i18n.T("require fora da pasta do plugin: %s"), spec)))
			}
			if fi, err := os.Stat(target); err != nil {
				if _, err := os.Stat(target + ".js"); err == nil {
					target += ".js"
				}
			} else if fi.IsDir() {
				target = filepath.Join(target, "index.js")
			}
			if strings.HasSuffix(target, ".json") {
				b, err := os.ReadFile(target)
				if err != nil {
					panic(vm.NewGoError(err))
				}
				v, err := vm.RunString("(" + string(b) + ")")
				if err != nil {
					panic(err)
				}
				return v
			}
			exp, err := runModule(vm, target, root, cache)
			if err != nil {
				panic(err)
			}
			return exp
		}
		panic(vm.NewGoError(fmt.Errorf(i18n.T("módulo %q não é permitido em plugins (liberados: %s e arquivos do próprio plugin)"), spec, strings.Join(allowed, ", "))))
	}
}

// executa um arquivo como módulo CommonJS
func runModule(vm *goja.Runtime, file, root string, cache map[string]*goja.Object) (goja.Value, error) {
	if m, ok := cache[file]; ok {
		return m.Get("exports"), nil
	}
	code, err := os.ReadFile(file)
	if err != nil {
		return nil, err
	}
	mod := vm.NewObject()
	exports := vm.NewObject()
	_ = mod.Set("exports", exports)
	cache[file] = mod
	wrapper, err := vm.RunScript(file, "(function (exports, require, module, __filename, __dirname) {"+string(code)+"\n})")
	if err != nil {
		return nil, err
	}
	fn, _ := goja.AssertFunction(wrapper)
	if _, err := fn(goja.Undefined(), exports, vm.ToValue(requireFn(vm, file, root, cache)), mod, vm.ToValue(file), vm.ToValue(filepath.Dir(file))); err != nil {
		return nil, err
	}
	// como no Node: module.exports pode ser qualquer valor (false, número, função…)
	return mod.Get("exports"), nil
}

func nativeModule(vm *goja.Runtime, name string) goja.Value {
	mod := vm.NewObject()
	_ = mod.Set("exports", vm.NewObject())
	switch name {
	case "buffer":
		buffer.Require(vm, mod)
	case "url":
		url.Require(vm, mod)
	case "util":
		util.Require(vm, mod)
	case "crypto":
		return cryptoModule(vm)
	case "events":
		return call0(vm, "__zenoEvents")
	case "querystring":
		return call0(vm, "__zenoQuerystring")
	case "assert":
		return call0(vm, "__zenoAssert")
	}
	return mod.Get("exports")
}

func call0(vm *goja.Runtime, fn string) goja.Value {
	f, _ := goja.AssertFunction(vm.Get(fn))
	v, err := f(goja.Undefined())
	if err != nil {
		panic(err)
	}
	return v
}

// run: chama no laço do plugin com tempo máximo; promessa é esperada até o tempo acabar.
// conv converte o resultado (dentro do laço) pro Go.
func (p *plugin) run(timeout time.Duration, what string, fn func(vm *goja.Runtime) (goja.Value, error), conv func(vm *goja.Runtime, v goja.Value) any) (any, error) {
	type result struct {
		v   any
		err error
	}
	ch := make(chan result, 1)
	var once sync.Once
	send := func(r result) { once.Do(func() { ch <- r }) }
	finish := func(vm *goja.Runtime, v goja.Value) {
		if conv != nil {
			send(result{conv(vm, v), nil})
		} else {
			send(result{nil, nil})
		}
	}
	ok := p.loop.RunOnLoop(func(vm *goja.Runtime) {
		v, err := fn(vm)
		if err != nil {
			send(result{nil, err})
			return
		}
		if v != nil {
			if pr, isP := v.Export().(*goja.Promise); isP {
				switch pr.State() {
				case goja.PromiseStateFulfilled:
					finish(vm, pr.Result())
				case goja.PromiseStateRejected:
					send(result{nil, errors.New(jsError(pr.Result()))})
				default:
					then, _ := goja.AssertFunction(vm.Get("__zenoThen"))
					okFn := func(c goja.FunctionCall) goja.Value { finish(vm, c.Argument(0)); return goja.Undefined() }
					failFn := func(c goja.FunctionCall) goja.Value {
						send(result{nil, errors.New(c.Argument(0).String())})
						return goja.Undefined()
					}
					if _, err := then(goja.Undefined(), v, vm.ToValue(okFn), vm.ToValue(failFn)); err != nil {
						send(result{nil, err})
					}
				}
				return
			}
		}
		finish(vm, v)
	})
	if !ok {
		return nil, fmt.Errorf(i18n.T("plugin %s (%s): parado"), p.info.DisplayName, what)
	}
	select {
	case r := <-ch:
		if r.err != nil {
			return nil, fmt.Errorf("plugin %s (%s): %s", p.info.DisplayName, what, cleanErr(r.err))
		}
		return r.v, nil
	case <-time.After(timeout):
		// trava síncrona: interrompe; promessa pendurada: só desiste
		if p.vm != nil {
			p.vm.Interrupt("tempo esgotado")
			p.loop.RunOnLoop(func(vm *goja.Runtime) { vm.ClearInterrupt() })
		}
		return nil, fmt.Errorf(i18n.T("plugin %s (%s): passou de %s s"), p.info.DisplayName, what, doc.FormatNum(timeout.Seconds()))
	}
}

func jsError(v goja.Value) string {
	if o, ok := v.(*goja.Object); ok {
		if m := o.Get("message"); m != nil && !goja.IsUndefined(m) {
			return m.String()
		}
	}
	return v.String()
}

func cleanErr(err error) string {
	var ex *goja.Exception
	if errors.As(err, &ex) {
		return jsError(ex.Value())
	}
	var ie *goja.InterruptedError
	if errors.As(err, &ie) {
		return i18n.T("tempo esgotado")
	}
	return err.Error()
}

func textConv(vm *goja.Runtime, v goja.Value) any {
	f, _ := goja.AssertFunction(vm.Get("__zenoText"))
	s, err := f(goja.Undefined(), v)
	if err != nil {
		return ""
	}
	return s.String()
}

// ---------- API usada pelo app ----------

// HasTag: algum plugin ativo tem a tag
func (ps *Plugins) HasTag(name string) bool {
	for _, p := range ps.active() {
		if _, ok := p.tags[name]; ok {
			return true
		}
	}
	return false
}

// converte pelo tipo declarado (number → Number, boolean → true/false), como o Insomnia
func coerce(v string, t string) any {
	switch t {
	case "number":
		// como Number(v) com Number.isFinite: o texto inteiro tem que ser número
		if t := strings.TrimSpace(v); t != "" {
			if f, err := strconv.ParseFloat(t, 64); err == nil && !math.IsInf(f, 0) && !math.IsNaN(f) {
				return f
			}
		}
	case "boolean":
		switch v {
		case "true":
			return true
		case "false":
			return false
		}
	}
	return v
}

// RunTag roda {% nome args %}; render resolve {{ variáveis }} nos argumentos (como no Insomnia)
func (ps *Plugins) RunTag(name string, args []string, render func(string) string, vars *doc.Doc) (string, error) {
	var p *plugin
	for _, x := range ps.active() {
		if _, ok := x.tags[name]; ok {
			p = x
			break
		}
	}
	if p == nil {
		return "", fmt.Errorf(i18n.T("tag %q não suportada"), name)
	}
	var spec []Arg
	for _, t := range p.info.TemplateTags {
		if t.Name == name {
			spec = t.Args
		}
	}
	varsJSON, _ := doc.Marshal(vars)
	out, err := p.run(CallTimeout, "{% "+name+" %}", func(vm *goja.Runtime) (goja.Value, error) {
		ctxVars, err := vm.RunString("(" + string(varsJSON) + ")")
		if err != nil {
			return nil, err
		}
		util := vm.NewObject()
		_ = util.Set("render", func(c goja.FunctionCall) goja.Value {
			pr, resolve, _ := vm.NewPromise()
			_ = resolve(render(c.Argument(0).String()))
			return vm.ToValue(pr)
		})
		context := vm.NewObject()
		_ = context.Set("util", util)
		_ = context.Set("context", ctxVars)
		_ = context.Set("renderPurpose", "send")
		callArgs := []goja.Value{context}
		for i, a := range args {
			t := ""
			if i < len(spec) {
				t = spec[i].Type
			}
			callArgs = append(callArgs, vm.ToValue(coerce(render(a), t)))
		}
		fn, _ := goja.AssertFunction(p.tags[name])
		return fn(goja.Undefined(), callArgs...)
	}, textConv)
	if err != nil {
		return "", err
	}
	return out.(string), nil
}

// HookRequest: request que os requestHooks podem mudar
type HookRequest struct {
	Method  string      `json:"method"`
	URL     string      `json:"url"`
	Headers [][2]string `json:"headers"`
	Body    *string     `json:"body,omitempty"`
}

// BeforeSend: requestHooks de todos os plugins ativos, em ordem; erros viram avisos
func (ps *Plugins) BeforeSend(req HookRequest, vars *doc.Doc) (HookRequest, []string) {
	var warnings []string
	cur := req
	varsJSON, _ := doc.Marshal(vars)
	for _, p := range ps.active() {
		for _, h := range p.reqHooks {
			in, _ := json.Marshal(cur)
			out, err := p.run(CallTimeout, "requestHook", func(vm *goja.Runtime) (goja.Value, error) {
				r0, err := vm.RunString("(" + string(in) + ")")
				if err != nil {
					return nil, err
				}
				vs, err := vm.RunString("(" + string(varsJSON) + ")")
				if err != nil {
					return nil, err
				}
				mk, _ := goja.AssertFunction(vm.Get("__zenoRequest"))
				mr, err := mk(goja.Undefined(), r0, vs)
				if err != nil {
					return nil, err
				}
				// guarda o "get" pra ler o request depois (inclusive se o hook for async)
				_ = vm.Set("__zenoLast", mr)
				ctx := vm.NewObject()
				_ = ctx.Set("request", mr.ToObject(vm).Get("api"))
				fn, _ := goja.AssertFunction(h)
				return fn(goja.Undefined(), ctx)
			}, func(vm *goja.Runtime, _ goja.Value) any {
				get, _ := goja.AssertFunction(vm.Get("__zenoLast").ToObject(vm).Get("get"))
				s, err := get(goja.Undefined())
				if err != nil {
					return nil
				}
				return s.String()
			})
			if err != nil {
				warnings = append(warnings, err.Error())
				continue
			}
			if s, ok := out.(string); ok {
				var next HookRequest
				if json.Unmarshal([]byte(s), &next) == nil {
					cur = next
				}
			}
		}
	}
	return cur, warnings
}

// HookResponse: resposta pros responseHooks
type HookResponse struct {
	Status  int         `json:"status"`
	Headers [][2]string `json:"headers"`
	Body    string      `json:"body"`
}

// AfterResponse: responseHooks; erros viram avisos
func (ps *Plugins) AfterResponse(res HookResponse) []string {
	var warnings []string
	in, _ := json.Marshal(res)
	for _, p := range ps.active() {
		for _, h := range p.respHooks {
			_, err := p.run(CallTimeout, "responseHook", func(vm *goja.Runtime) (goja.Value, error) {
				r, err := vm.RunString("(" + string(in) + ")")
				if err != nil {
					return nil, err
				}
				mk, _ := goja.AssertFunction(vm.Get("__zenoResponse"))
				api, err := mk(goja.Undefined(), r)
				if err != nil {
					return nil, err
				}
				ctx := vm.NewObject()
				_ = ctx.Set("response", api)
				fn, _ := goja.AssertFunction(h)
				return fn(goja.Undefined(), ctx)
			}, nil)
			if err != nil {
				warnings = append(warnings, err.Error())
			}
		}
	}
	return warnings
}

// ActionRequest: request entregue às ações (já com variáveis resolvidas)
type ActionRequest struct {
	Name string `json:"name"`
	HookRequest
}

// RunAction: ação do menu do request; devolve as mensagens (app.alert) e o que foi copiado
func (ps *Plugins) RunAction(id string, index int, req ActionRequest) ([]string, *string, error) {
	var p *plugin
	for _, x := range ps.active() {
		if x.info.ID == id {
			p = x
		}
	}
	if p == nil || index < 0 || index >= len(p.actions) {
		return nil, nil, errors.New(i18n.T("ação de plugin não encontrada"))
	}
	messages := []string{}
	var clipboard *string
	in, _ := json.Marshal(req)
	_, err := p.run(CallTimeout, "requestAction", func(vm *goja.Runtime) (goja.Value, error) {
		r, err := vm.RunString("(" + string(in) + ")")
		if err != nil {
			return nil, err
		}
		app := vm.NewObject()
		_ = app.Set("alert", func(c goja.FunctionCall) goja.Value {
			var parts []string
			for _, a := range c.Arguments {
				if !goja.IsUndefined(a) {
					parts = append(parts, a.String())
				}
			}
			messages = append(messages, strings.Join(parts, ": "))
			return goja.Undefined()
		})
		cb := vm.NewObject()
		_ = cb.Set("writeText", func(c goja.FunctionCall) goja.Value {
			s := c.Argument(0).String()
			clipboard = &s
			return goja.Undefined()
		})
		_ = app.Set("clipboard", cb)
		ctx := vm.NewObject()
		_ = ctx.Set("app", app)
		data := vm.NewObject()
		_ = data.Set("request", r)
		fn, _ := goja.AssertFunction(p.actions[index])
		return fn(goja.Undefined(), ctx, data)
	}, nil)
	return messages, clipboard, err
}

// Importer de plugin: detect(texto) e convert(texto) → export do Insomnia v4
type Importer struct {
	Name    string
	Detect  func(text string) bool
	Convert func(text string) (any, error)
}

// Importers dos plugins ativos
func (ps *Plugins) Importers() []Importer {
	var out []Importer
	for _, p := range ps.active() {
		for _, im := range p.importers {
			im, p := im, p
			out = append(out, Importer{
				Name: im.name,
				Detect: func(text string) bool {
					if im.detect == nil {
						return false
					}
					v, err := p.run(CallTimeout, "importer", func(vm *goja.Runtime) (goja.Value, error) {
						fn, _ := goja.AssertFunction(im.detect)
						return fn(goja.Undefined(), vm.ToValue(text))
					}, func(_ *goja.Runtime, v goja.Value) any { return v.ToBoolean() })
					return err == nil && v == true
				},
				Convert: func(text string) (any, error) {
					v, err := p.run(CallTimeout, "importer", func(vm *goja.Runtime) (goja.Value, error) {
						fn, _ := goja.AssertFunction(im.convert)
						return fn(goja.Undefined(), vm.ToValue(text))
					}, func(vm *goja.Runtime, v goja.Value) any {
						f, _ := goja.AssertFunction(vm.Get("JSON").ToObject(vm).Get("stringify"))
						s, err := f(goja.Undefined(), v)
						if err != nil {
							return nil
						}
						return s.String()
					})
					if err != nil {
						return nil, err
					}
					s, _ := v.(string)
					return doc.FromJSON([]byte(s))
				},
			})
		}
	}
	return out
}
