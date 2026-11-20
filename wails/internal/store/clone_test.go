package store

import (
	"strings"
	"testing"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

func TestCloneWorkspace(t *testing.T) {
	s := New(t.TempDir())
	s.Load()
	list, _ := s.CreateWorkspace("Loja")
	ws := list[0]
	_, fld, _ := s.CreateFolder(ws.Str("id"), "API", 0)
	_, login, _ := s.CreateRequest(fld, "login", 0)
	_, me, _ := s.CreateRequest(fld, "me", 1)
	cur, _ := doc.Find(s.Workspace(ws.Str("id")), me)
	r := cur.Clone()
	r.Set("url", "https://x/{% response 'body', '"+login+"', '', 'never' %}")
	if err := s.SaveRequest(r); err != nil {
		t.Fatal(err)
	}
	orig := s.Workspace(ws.Str("id"))
	cp := CloneWorkspace(orig, "Loja (cópia)")
	if err := s.WriteWorkspace(cp); err != nil {
		t.Fatal(err)
	}
	s.Load()
	c := s.Workspace(cp.Str("id"))
	if c == nil || c.Str("name") != "Loja (cópia)" || c.Map("location").Get("linked") != false {
		t.Fatalf("cópia: %v", c)
	}
	b, _ := doc.Marshal(c)
	for _, old := range []string{orig.Str("id"), fld, login, me} {
		if strings.Contains(string(b), old) {
			t.Errorf("id antigo %s na cópia", old)
		}
	}
	f := c.List("children")[0].(*Doc)
	kids := f.List("children")
	cLogin, cMe := kids[0].(*Doc), kids[1].(*Doc)
	if cMe.Str("url") != "https://x/{% response 'body', '"+cLogin.Str("id")+"', '', 'never' %}" {
		t.Errorf("tag: %s", cMe.Str("url"))
	}
	if len(c.List("environments")) != len(orig.List("environments")) {
		t.Error("ambientes")
	}
}
