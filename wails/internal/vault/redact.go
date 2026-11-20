package vault

import (
	"sort"
	"strings"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

// segredos abertos (valores) pra esconder na linha do tempo gravada
// CollectSecrets: valores abertos de tudo que estava cifrado em raw
func CollectSecrets(raw, open any, out map[string]bool) {
	if IsEncrypted(raw) {
		if s, ok := open.(string); ok && len(s) >= 3 {
			out[s] = true
		}
		return
	}
	switch r := raw.(type) {
	case []any:
		if o, ok := open.([]any); ok {
			for i := range r {
				if i < len(o) {
					CollectSecrets(r[i], o[i], out)
				}
			}
		}
	case *doc.Doc:
		if o, ok := open.(*doc.Doc); ok {
			for _, k := range r.Keys() {
				CollectSecrets(r.Get(k), o.Get(k), out)
			}
		}
	}
}

// troca segredos do cofre por ••• na URL, no cabeçalho e no body enviados (o que vai pro histórico em disco)
// RedactTimeline: esconde os segredos no registro antes de gravar
func RedactTimeline(rec *doc.Doc, secrets map[string]bool) {
	if len(secrets) == 0 {
		return
	}
	list := make([]string, 0, len(secrets))
	for s := range secrets {
		list = append(list, s)
	}
	sort.Slice(list, func(i, j int) bool { return len(list[i]) > len(list[j]) })
	hide := func(t string) string {
		for _, s := range list {
			t = strings.ReplaceAll(t, s, "•••••• (cofre)")
		}
		return t
	}
	// segredo pode estar na URL (query, caminho): também sai do registro gravado
	rec.Set("url", hide(rec.Str("url")))
	tl := rec.Map("timeline")
	if tl == nil {
		return
	}
	if tl.Has("requestBody") {
		tl.Set("requestBody", hide(tl.Str("requestBody")))
	}
	for _, h := range tl.List("hops") {
		if hd, ok := h.(*doc.Doc); ok {
			if hd.Has("requestHead") {
				hd.Set("requestHead", hide(hd.Str("requestHead")))
			}
			hd.Set("url", hide(hd.Str("url")))
		}
	}
}
