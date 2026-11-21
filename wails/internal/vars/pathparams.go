package vars

// Parâmetros de caminho (#149): `:id` e `{id}` no path da URL. Port de src/shared/pathparams.ts.

import (
	"regexp"
	"strings"
)

type pathMatch struct {
	name       string
	start, end int
}

var (
	templateRe   = regexp.MustCompile(`\{\{.*?\}\}|\{%.*?%\}`)
	schemeAuthRe = regexp.MustCompile(`(?i)^[a-z][a-z0-9+.-]*://[^/?#]*`)
	pathParamRe  = regexp.MustCompile(`/:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\}`)
)

// pathParamMatches: parâmetros do path (sem esquema/host, query e fragmento), na ordem
func pathParamMatches(u string) []pathMatch {
	// {{ variáveis }} e {% tags %} não contam; mesmas posições em bytes
	masked := templateRe.ReplaceAllStringFunc(u, func(m string) string { return strings.Repeat("\x01", len(m)) })
	from := 0
	if a := schemeAuthRe.FindString(masked); a != "" {
		from = len(a)
	} else {
		for from < len(masked) && masked[from] == '\x01' {
			from++
		}
		if from == 0 {
			if i := strings.IndexByte(masked, '/'); i >= 0 {
				from = i
			} else {
				from = len(masked)
			}
		}
	}
	to := len(masked)
	for _, c := range []byte{'?', '#'} {
		if i := strings.IndexByte(masked[from:], c); i >= 0 && from+i < to {
			to = from + i
		}
	}
	var out []pathMatch
	for _, m := range pathParamRe.FindAllStringSubmatchIndex(masked[from:to], -1) {
		if m[2] >= 0 {
			out = append(out, pathMatch{masked[from+m[2] : from+m[3]], from + m[0] + 1, from + m[1]})
		} else {
			out = append(out, pathMatch{masked[from+m[4] : from+m[5]], from + m[0], from + m[1]})
		}
	}
	return out
}

// PathParamNames: nomes únicos, na ordem em que aparecem
func PathParamNames(u string) []string {
	var out []string
	seen := map[string]bool{}
	for _, m := range pathParamMatches(u) {
		if !seen[m.name] {
			seen[m.name] = true
			out = append(out, m.name)
		}
	}
	return out
}

// ReplacePathParams troca cada parâmetro pelo valor; ok=false deixa o trecho como está
func ReplacePathParams(u string, value func(name string) (string, bool)) string {
	ms := pathParamMatches(u)
	for i := len(ms) - 1; i >= 0; i-- {
		if v, ok := value(ms[i].name); ok {
			u = u[:ms[i].start] + v + u[ms[i].end:]
		}
	}
	return u
}
