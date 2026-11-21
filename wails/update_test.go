package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewerVersion(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{
		{"v1.5.0", "1.4.1", true},
		{"v1.4.1", "1.4.1", false},
		{"v1.4.0", "1.4.1", false},
		{"v1.10.0", "1.9.9", true},
		{"v2.0.0", "1.99.99", true},
		{"v1.5.0", "1.5.0-rc.1", true},
		{"v1.5.0-rc.1", "1.5.0", false},
		{"lixo", "1.4.1", false},
		{"v1.5.0", "dev", false},
	} {
		if got := newerVersion(c.a, c.b); got != c.want {
			t.Errorf("newerVersion(%q, %q) = %v", c.a, c.b, got)
		}
	}
}

func TestCheckUpdate(t *testing.T) {
	body := `{"tag_name":"v1.5.0","html_url":"https://example.test/r/v1.5.0","draft":false,"prerelease":false}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/fora" {
			w.WriteHeader(http.StatusForbidden) // cota da API
			return
		}
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()
	t.Setenv("ZENO_UPDATE_URL", srv.URL)
	u := checkUpdate(context.Background(), "1.4.1")
	if u == nil || u.Version != "1.5.0" || u.URL != "https://example.test/r/v1.5.0" {
		t.Fatalf("esperava 1.5.0: %+v", u)
	}
	if u := checkUpdate(context.Background(), "1.5.0"); u != nil {
		t.Fatalf("em dia: %+v", u)
	}
	t.Setenv("ZENO_UPDATE_URL", srv.URL+"/fora")
	if u := checkUpdate(context.Background(), "1.4.1"); u != nil {
		t.Fatalf("erro da API: %+v", u)
	}
	t.Setenv("ZENO_UPDATE_URL", srv.URL)
	t.Setenv("ZENO_NO_UPDATE_CHECK", "1")
	if u := checkUpdate(context.Background(), "1.4.1"); u != nil {
		t.Fatalf("desligado: %+v", u)
	}
}
