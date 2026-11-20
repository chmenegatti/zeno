// Package scripts: scripts pré-request e pós-resposta (port de src/main/scripts.ts).
//
// A API (zeno, e os apelidos insomnia e pm, expect estilo chai, btoa/atob…) é o mesmo texto JavaScript
// do Electron (bootstrap.js, conferido contra src/main/scripts.ts num teste), rodando no goja: um
// interpretador novo por script, sem require, process, arquivos, rede ou timers; eval e o construtor
// Function ficam desligados. Entrada e saída em JSON; timeout cobre também as promises.
package scripts

import (
	_ "embed"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/dop251/goja"
)

//go:embed bootstrap.js
var bootstrap string

// Timeout padrão de cada script
const Timeout = 5 * time.Second

type Doc = doc.Doc

// sem geração de código a partir de texto (como codeGeneration.strings=false no node:vm)
const lockdown = `(() => {
  const no = function () { throw new EvalError('Code generation from strings disallowed for this context') }
  for (const f of [function () {}, async function () {}, function* () {}]) {
    Object.defineProperty(Object.getPrototypeOf(f), 'constructor', { value: no, writable: false, configurable: false })
  }
  globalThis.eval = no
  globalThis.Function = no
})()`

// Run roda um script; nunca falha: erro do script volta em "error" na saída.
// input: phase, where, env, base, vars, request, response (como ScriptInput do Electron).
func Run(code string, input *Doc, envIsBase bool, timeout time.Duration) *Doc {
	in := input.Clone()
	in.Set("envIsBase", envIsBase)
	raw, _ := doc.Marshal(in)
	fail := func(msg string) *Doc {
		return doc.New("env", input.Get("env"), "base", input.Get("base"), "vars", input.Get("vars"), "request", input.Get("request"),
			"logs", []any{}, "tests", []any{}, "error", msg)
	}
	vm := goja.New()
	if _, err := vm.RunString(lockdown); err != nil {
		return fail(err.Error())
	}
	_ = vm.Set("__input", string(raw))
	source := bootstrap + `
;(async () => {
  try {
    await (async () => {
` + code + `
    })()
    await Promise.all(pending)
  } catch (e) {
    S.error = (e && e.name && e.name !== 'Error' ? e.name + ': ' : '') + (e && e.message !== undefined ? e.message : String(e))
  }
  __output = JSON.stringify({ env: S.env, base: S.envIsBase ? S.env : S.base, vars: S.vars, request: S.request, logs, tests, error: S.error })
})()`
	prog, err := goja.Compile(input.Str("where")+".js", source, false)
	if err != nil {
		return fail("erro de sintaxe: " + err.Error())
	}
	timer := time.AfterFunc(timeout, func() { vm.Interrupt("timeout") })
	defer timer.Stop()
	if _, err := vm.RunProgram(prog); err != nil {
		var ie *goja.InterruptedError
		if errors.As(err, &ie) {
			return fail(fmt.Sprintf("passou de %s s (laço infinito?)", doc.FormatNum(timeout.Seconds())))
		}
		return fail(err.Error())
	}
	var out string
	ok := false
	if o := vm.Get("__output"); o != nil {
		out, ok = o.Export().(string)
	}
	if !ok {
		return fail("o script não terminou (await em algo que nunca resolve?)")
	}
	v, err := doc.FromJSON([]byte(out))
	d, isDoc := v.(*Doc)
	if err != nil || !isDoc {
		return fail("não deu pra ler o resultado do script (valor não serializável em variável?)")
	}
	return d
}

// Script de uma fase: dono (pasta ou request) e código
type Script struct {
	Where, Code string
}

// State: estado que passa de um script pro próximo (PhaseState do Electron)
type State struct {
	Env, Base *Doc
	// EnvIsBase: o ambiente ativo é o próprio Base (nenhum sub-ambiente escolhido)
	EnvIsBase bool
	Vars      *Doc
	Request   *Doc
	Response  *Doc
}

// Report: logs, testes e erros juntados das fases
type Report struct {
	Logs   []string
	Tests  []any
	Errors []string
}

// RunPhase roda os scripts em ordem (pastas de fora pra dentro, depois o request), passando o estado
// adiante; para no primeiro erro
func RunPhase(phase string, list []Script, st State, rep *Report, timeout time.Duration) (State, bool) {
	cur := st
	for _, s := range list {
		env := cur.Env
		if cur.EnvIsBase {
			env = cur.Base
		}
		in := doc.New("phase", phase, "where", s.Where, "env", env, "base", cur.Base, "vars", cur.Vars, "request", cur.Request)
		if cur.Response != nil {
			in.Set("response", cur.Response)
		}
		out := Run(s.Code, in, cur.EnvIsBase, timeout)
		for _, l := range out.List("logs") {
			line := doc.AsStr(l)
			if len(list) > 1 {
				line = "[" + s.Where + "] " + line
			}
			rep.Logs = append(rep.Logs, line)
		}
		rep.Tests = append(rep.Tests, out.List("tests")...)
		next := cur
		next.Base = out.Map("base")
		if cur.EnvIsBase {
			next.Env = next.Base
		} else {
			next.Env = out.Map("env")
		}
		next.Vars = out.Map("vars")
		next.Request = out.Map("request")
		cur = next
		if e := out.Str("error"); e != "" {
			name := "pós-resposta"
			if phase == "pre" {
				name = "pré-request"
			}
			rep.Errors = append(rep.Errors, name+" ("+s.Where+"): "+e)
			return cur, true
		}
	}
	return cur, false
}

// Strip: tira espaços do fim (pra comparar o bootstrap com o do Electron)
func Strip(s string) string { return strings.TrimRight(s, "\n ") }
