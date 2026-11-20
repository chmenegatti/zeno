package vault

import (
	"testing"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

func TestRedactEscondeURLCabecalhoEBody(t *testing.T) {
	rec := doc.New("url", "https://api/x?key=s3gredo", "timeline", doc.New(
		"requestBody", `{"t":"s3gredo"}`,
		"hops", []any{doc.New("url", "https://api/x?key=s3gredo", "requestHead", "GET /x?key=s3gredo HTTP/1.1\r\nX: s3gredo\r\n")},
	))
	RedactTimeline(rec, map[string]bool{"s3gredo": true})
	b, _ := doc.Marshal(rec)
	if s := string(b); contains(s, "s3gredo") {
		t.Errorf("vazou: %s", s)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
