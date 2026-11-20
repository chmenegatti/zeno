package filename

import "testing"

func h(cd, ct string) [][2]string {
	out := [][2]string{{"content-type", ct}}
	if cd != "" {
		out = append(out, [2]string{"content-disposition", cd})
	}
	return out
}

// mesmos casos de test/filename.test.ts
func TestSuggest(t *testing.T) {
	cases := []struct {
		hs   [][2]string
		url  string
		want string
	}{
		{h(`attachment; filename="relatorio.pdf"`, "application/pdf"), "http://x/a", "relatorio.pdf"},
		{h(`attachment; filename*=UTF-8''relat%C3%B3rio%20final.pdf`, "application/pdf"), "http://x/a", "relatório final.pdf"},
		{h("", "application/pdf"), "http://x/files/nota.pdf", "nota.pdf"},
		{h("", "application/json"), "http://x/api/users", "users.json"},
		{h("", "image/png"), "http://x/", "resposta.png"},
		{h(`attachment; filename="../../../.bashrc"`, "application/pdf"), "http://x/a", ".bashrc"},
		{h(`attachment; filename="..\\..\\win.ini"`, "application/pdf"), "http://x/a", "win.ini"},
		{h(`attachment; filename=".."`, "application/pdf"), "http://x/doc.pdf", "doc.pdf"},
		{h(`attachment; filename="/etc/passwd"`, "application/pdf"), "http://x/a", "passwd"},
		{h("", "application/vnd.api+json"), "http://x/itens", "itens.json"},
	}
	for _, c := range cases {
		if got := Suggest(c.hs, c.url); got != c.want {
			t.Errorf("Suggest(%v, %q) = %q, quer %q", c.hs, c.url, got, c.want)
		}
	}
}
