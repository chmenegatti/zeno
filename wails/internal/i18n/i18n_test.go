package i18n

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// chaves usadas em i18n.T("…") em todo o módulo
func usedKeys(t *testing.T) map[string]string {
	t.Helper()
	keys := map[string]string{}
	root := filepath.Join("..", "..")
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && (d.Name() == "node_modules" || d.Name() == "frontend" || d.Name() == "build") {
			return filepath.SkipDir
		}
		if d.IsDir() || !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
			return nil
		}
		f, err := parser.ParseFile(token.NewFileSet(), p, nil, 0)
		if err != nil {
			return err
		}
		ast.Inspect(f, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok || len(call.Args) == 0 {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || sel.Sel.Name != "T" {
				return true
			}
			if x, ok := sel.X.(*ast.Ident); !ok || x.Name != "i18n" {
				return true
			}
			if lit, ok := call.Args[0].(*ast.BasicLit); ok && lit.Kind == token.STRING {
				if s, err := strconv.Unquote(lit.Value); err == nil {
					keys[s] = p
				}
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return keys
}

func TestTodaChaveTemTraducao(t *testing.T) {
	for k, f := range usedKeys(t) {
		if _, ok := en[k]; !ok {
			t.Errorf("%s: sem tradução: %q", f, k)
		}
	}
}

var verbRe = regexp.MustCompile(`%[-+# 0]*[0-9]*(\.[0-9]+)?[a-zA-Z%]`)

func TestTraducaoMantemOsVerbos(t *testing.T) {
	for pt, e := range en {
		a, b := verbRe.FindAllString(pt, -1), verbRe.FindAllString(e, -1)
		if strings.Join(a, " ") != strings.Join(b, " ") {
			t.Errorf("verbos diferentes: %q %v → %q %v", pt, a, e, b)
		}
	}
}

func TestT(t *testing.T) {
	add(map[string]string{"arquivo %s§teste": "file %s"})
	Set("pt")
	if T("arquivo %s§teste", "a") != "arquivo a" {
		t.Error(T("arquivo %s§teste", "a"))
	}
	Set("en")
	if T("arquivo %s§teste", "a") != "file a" || T("sem tradução") != "sem tradução" {
		t.Error(T("arquivo %s§teste", "a"))
	}
	Set("pt")
}
