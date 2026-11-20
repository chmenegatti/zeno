package store

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

const (
	maxResponses = 20
	// LargeBody: acima disso o body vai pra um arquivo próprio e o histórico guarda só a prévia
	LargeBody    = 5 * 1024 * 1024
	previewChars = 256 * 1024
)

var unsafeName = regexp.MustCompile(`[^\w-]`)

// ResponsesFile: histórico de um request
func (s *Store) ResponsesFile(reqID string) string {
	return filepath.Join(s.Dir, ".responses", unsafeName.ReplaceAllString(reqID, "_")+".json")
}

func (s *Store) bodyPath(resID string) string {
	return filepath.Join(s.Dir, ".responses", "bodies", unsafeName.ReplaceAllString(resID, "_"))
}

// GetResponses: histórico do request, mais nova primeiro
func (s *Store) GetResponses(reqID string) []any {
	b, err := os.ReadFile(s.ResponsesFile(reqID))
	if err != nil {
		return []any{}
	}
	v, err := doc.FromJSON(b)
	if l, ok := v.([]any); ok && err == nil {
		return l
	}
	return []any{}
}

// AddResponse põe no topo do histórico (máximo 20). Body grande vai pra .responses/bodies/<id> e o
// histórico guarda a prévia; o que sai do histórico leva o arquivo junto.
func (s *Store) AddResponse(rec *Doc) []any {
	body := rec.Str("body")
	if rec.Num("size", 0) > LargeBody || len(body) > LargeBody {
		bp := s.bodyPath(rec.Str("id"))
		_ = os.MkdirAll(filepath.Dir(bp), 0o755)
		_ = os.WriteFile(bp, []byte(body), 0o644)
		short := rec.Clone()
		if rec.Str("bodyEncoding") == "utf8" {
			short.Set("body", preview(body))
		} else {
			short.Set("body", "")
		}
		short.Set("bodyFile", true)
		rec = short
	}
	all := append([]any{rec}, s.GetResponses(rec.Str("requestId"))...)
	list := all
	if len(all) > maxResponses {
		list = all[:maxResponses]
		for _, old := range all[maxResponses:] {
			if d, _ := old.(*Doc); d != nil && d.Get("bodyFile") == true {
				_ = os.Remove(s.bodyPath(d.Str("id")))
			}
		}
	}
	file := s.ResponsesFile(rec.Str("requestId"))
	_ = os.MkdirAll(filepath.Dir(file), 0o755)
	b, _ := doc.Marshal(list)
	_ = os.WriteFile(file, b, 0o644)
	return list
}

// os primeiros 256 Ki caracteres (UTF-16, como body.slice no JavaScript)
func preview(s string) string {
	n := 0
	for i, r := range s {
		if n >= previewChars {
			return s[:i]
		}
		if r > 0xFFFF {
			n += 2
		} else {
			n++
		}
	}
	return s
}

// ResponseBody: body completo (lê do arquivo quando foi guardado à parte)
func (s *Store) ResponseBody(rec *Doc) (string, error) {
	if rec.Get("bodyFile") != true {
		return rec.Str("body"), nil
	}
	b, err := os.ReadFile(s.bodyPath(rec.Str("id")))
	if err != nil {
		return "", errors.New("o body completo desta resposta não está mais no disco")
	}
	return string(b), nil
}

// FindResponse acha uma resposta no histórico do request
func (s *Store) FindResponse(reqID, resID string) (*Doc, error) {
	for _, r := range s.GetResponses(reqID) {
		if d, _ := r.(*Doc); d != nil && d.Str("id") == resID {
			return d, nil
		}
	}
	return nil, errors.New("resposta não está mais no histórico")
}

// ClearResponses apaga o histórico do request e os bodies guardados à parte
func (s *Store) ClearResponses(reqID string) error {
	for _, r := range s.GetResponses(reqID) {
		if d, _ := r.(*Doc); d != nil && d.Get("bodyFile") == true {
			_ = os.Remove(s.bodyPath(d.Str("id")))
		}
	}
	if err := os.Remove(s.ResponsesFile(reqID)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
