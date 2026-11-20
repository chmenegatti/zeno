// {% prompt %} na janela: o motor (internal/engine) pergunta, a interface responde.

package main

import (
	"sync"

	"github.com/chmenegatti/zeno/wails/internal/tags"
)

type promptAnswer struct {
	Value    string `json:"value"`
	Remember bool   `json:"remember"`
}

type prompts struct {
	mu      sync.Mutex
	seq     int
	waiting map[int]chan *promptAnswer
	memory  map[string]string
}

// pergunta na janela; "lembrar" guarda o valor só enquanto o app estiver aberto
func (a *App) askPrompt(p tags.Prompt) (string, bool) {
	key := p.Key
	if key == "" {
		key = p.Title + "|" + p.Label
	}
	a.prompts.mu.Lock()
	if v, ok := a.prompts.memory[key]; ok {
		a.prompts.mu.Unlock()
		return v, true
	}
	if a.ctx == nil {
		a.prompts.mu.Unlock()
		return "", false
	}
	a.prompts.seq++
	id := a.prompts.seq
	ch := make(chan *promptAnswer, 1)
	a.prompts.waiting[id] = ch
	a.prompts.mu.Unlock()
	a.Emit("prompt:ask", id, p)
	ans := <-ch
	if ans == nil {
		return "", false
	}
	if ans.Remember {
		a.prompts.mu.Lock()
		a.prompts.memory[key] = ans.Value
		a.prompts.mu.Unlock()
	}
	return ans.Value, true
}

func (a *App) promptReply(id int, ans *promptAnswer) {
	a.prompts.mu.Lock()
	ch := a.prompts.waiting[id]
	delete(a.prompts.waiting, id)
	a.prompts.mu.Unlock()
	if ch != nil {
		ch <- ans
	}
}
