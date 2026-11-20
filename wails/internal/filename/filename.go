// Package filename: nome sugerido pra "salvar em arquivo" (port de src/main/filename.ts):
// Content-Disposition, último trecho da URL ou "resposta" + extensão do tipo.
// O nome vem do servidor: nunca leva pastas (../) nem caracteres inválidos.
package filename

import (
	"net/url"
	"path"
	"regexp"
	"strings"
)

var ext = map[string]string{
	"application/json": ".json", "application/xml": ".xml", "text/xml": ".xml", "text/html": ".html", "text/plain": ".txt", "text/csv": ".csv",
	"application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/svg+xml": ".svg",
	"application/zip": ".zip", "audio/mpeg": ".mp3", "video/mp4": ".mp4", "application/octet-stream": ".bin",
}

// MimeExt: extensão pelo Content-Type
func MimeExt(ct string) string {
	t := strings.ToLower(strings.TrimSpace(strings.Split(ct, ";")[0]))
	if e, ok := ext[t]; ok {
		return e
	}
	switch {
	case strings.HasSuffix(t, "+json"):
		return ".json"
	case strings.HasSuffix(t, "+xml"):
		return ".xml"
	}
	return ""
}

var (
	invalid = regexp.MustCompile("[\x00-\x1f<>:\"|?*]")
	dots    = regexp.MustCompile(`^\.*$`)
	star    = regexp.MustCompile(`filename\*\s*=\s*(?:UTF-8|utf-8)?'[^']*'([^;]+)`)
	plain   = regexp.MustCompile(`(?i)filename\s*=\s*"?([^";]+)"?`)
	hasExt  = regexp.MustCompile(`\.\w{1,8}$`)
)

// CleanName: só o nome do arquivo, sem pastas nem caracteres de controle/inválidos
func CleanName(n string) string {
	if n == "" {
		return ""
	}
	base := path.Base(strings.ReplaceAll(n, `\`, "/"))
	if strings.HasSuffix(n, "/") || strings.HasSuffix(n, `\`) {
		base = ""
	}
	base = strings.TrimSpace(invalid.ReplaceAllString(base, "_"))
	if dots.MatchString(base) {
		return ""
	}
	return base
}

// Suggest: nome pro arquivo da resposta
func Suggest(headers [][2]string, rawURL string) string {
	header := func(n string) string {
		for _, h := range headers {
			if strings.EqualFold(h[0], n) {
				return h[1]
			}
		}
		return ""
	}
	cd := header("content-disposition")
	disp := ""
	var p string
	if m := plain.FindStringSubmatch(cd); m != nil {
		p = m[1]
	}
	if m := star.FindStringSubmatch(cd); m != nil {
		if dec, err := url.PathUnescape(m[1]); err == nil {
			disp = CleanName(dec)
		} else {
			disp = CleanName(p)
		}
	} else {
		disp = CleanName(p)
	}
	fromURL := ""
	if u, err := url.Parse(rawURL); err == nil && u.Scheme != "" {
		parts := strings.Split(u.EscapedPath(), "/")
		if last, err := url.PathUnescape(parts[len(parts)-1]); err == nil {
			fromURL = CleanName(last)
		}
	}
	if disp != "" {
		return disp
	}
	if fromURL != "" && hasExt.MatchString(fromURL) {
		return fromURL
	}
	if fromURL == "" {
		fromURL = "resposta"
	}
	return fromURL + MimeExt(header("content-type"))
}
