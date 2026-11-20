package doc

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func stdMarshal(v any) string {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
	return strings.TrimSuffix(b.String(), "\n")
}

// mesma saída do encoding/json (SetEscapeHTML(false)) em tudo que o codificador direto trata
func TestEncodeIgualEncodingJSON(t *testing.T) {
	strs := []string{"", "simples", `aspas " e \ barra`, "<b>&amp;</b>", "\b\f\n\r\t\x00\x01\x1f\x7f", "ação 😀 中文", "\u2028\u2029", "inválido \xff\xfe fim", strings.Repeat("x\"", 1000)}
	for _, s := range strs {
		got, _ := appendValue(nil, s)
		if want := stdMarshal(s); string(got) != want {
			t.Errorf("%q:\n got %s\nwant %s", s, got, want)
		}
	}
	vals := []any{nil, true, false, int64(-42), 7, 1.5, 1e21, 0.000001, -0.0, []any{}, []any{nil, "a", int64(1)}, [][2]string{{"a", "b"}}, map[string]any{"z": 1, "a": "<"}}
	for _, v := range vals {
		got, _ := appendValue(nil, v)
		if want := stdMarshal(v); string(got) != want {
			t.Errorf("%#v: got %s want %s", v, got, want)
		}
	}
	// documento aninhado: ordem das chaves preservada
	d := New("b", New("y", []any{"\n", New("k", 1.25)}), "a", "x")
	got, _ := Marshal(d)
	if want := `{"b":{"y":["\n",{"k":1.25}]},"a":"x"}`; string(got) != want {
		t.Errorf("got %s want %s", got, want)
	}
	// e o encoding/json usando o MarshalJSON dá o mesmo
	if std := stdMarshal([]any{d}); std != "["+string(got)+"]" {
		t.Errorf("via encoding/json: %s", std)
	}
}

func BenchmarkMarshalHistorico(b *testing.B) {
	body := strings.Repeat(`{"id":1,"nome":"Produto \"x\""},`, 90000)
	list := []any{}
	for i := 0; i < 3; i++ {
		list = append(list, New("id", "res", "body", body, "headers", []any{[]any{"a", "b"}}))
	}
	b.SetBytes(int64(len(body) * 3))
	for i := 0; i < b.N; i++ {
		_, _ = Marshal(list)
	}
}
