// Package i18n: idioma das mensagens geradas no Go (#132, segunda etapa). Mesma ideia da interface
// (src/shared/i18n): o texto em português é a chave e os dicionários (en_*.go) dão o inglês.
//
//	errors.New(i18n.T("request não encontrado"))
//	fmt.Errorf(i18n.T("arquivo %s: %w"), nome, err)   // sem args, T devolve o formato traduzido
//	i18n.T("%d requests", n)                           // com args, já formata
//
// Contexto opcional depois de §, como na interface: T("Sair§conta"). Sem Set, o idioma é português
// (testes e goldens continuam iguais); o app e a CLI escolhem na partida (padrão inglês).
package i18n

import (
	"fmt"
	"os"
	"strings"
	"sync/atomic"
)

var english atomic.Bool

var en = map[string]string{}

// add junta um dicionário (cada en_*.go chama no init)
func add(m map[string]string) {
	for k, v := range m {
		en[k] = v
	}
}

// Set escolhe o idioma: "pt" = português; qualquer outro valor (inclusive vazio) = inglês
func Set(lang string) {
	english.Store(lang != "pt")
}

// FromEnv: idioma da CLI pela variável ZENO_LANG (pt ou en; padrão inglês)
func FromEnv() {
	Set(strings.ToLower(strings.TrimSpace(os.Getenv("ZENO_LANG"))))
}

// English: idioma atual é inglês?
func English() bool { return english.Load() }

func strip(pt string) string {
	if i := strings.Index(pt, "§"); i >= 0 {
		return pt[:i]
	}
	return pt
}

// T traduz pt; com args, formata com fmt.Sprintf
func T(pt string, args ...any) string {
	s := strip(pt)
	if english.Load() {
		if e, ok := en[pt]; ok {
			s = e
		}
	}
	if len(args) > 0 {
		return fmt.Sprintf(s, args...)
	}
	return s
}
