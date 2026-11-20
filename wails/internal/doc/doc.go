// Package doc: documentos do Zeno (workspace, pasta, request, ambiente) como objetos com ordem de chaves.
//
// A ordem importa: os YAML são versionados em git pelos usuários, e o Electron grava as chaves na ordem
// em que foram criadas. Doc guarda essa ordem ao ler YAML e JSON e a respeita ao gravar.
package doc

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
)

// Doc é um objeto JSON/YAML com ordem de chaves. Valores: string, float64, int64, bool, nil, []any, *Doc.
type Doc struct {
	keys []string
	vals map[string]any
}

// New cria um Doc a partir de pares chave, valor.
func New(kv ...any) *Doc {
	d := &Doc{vals: make(map[string]any, len(kv)/2)}
	for i := 0; i+1 < len(kv); i += 2 {
		d.Set(kv[i].(string), kv[i+1])
	}
	return d
}

// Len: quantidade de chaves.
func (d *Doc) Len() int {
	if d == nil {
		return 0
	}
	return len(d.keys)
}

// Keys na ordem.
func (d *Doc) Keys() []string {
	if d == nil {
		return nil
	}
	return append([]string(nil), d.keys...)
}

// Has: a chave existe (mesmo com valor nil).
func (d *Doc) Has(k string) bool {
	if d == nil {
		return false
	}
	_, ok := d.vals[k]
	return ok
}

// Get devolve o valor (nil se ausente).
func (d *Doc) Get(k string) any {
	if d == nil {
		return nil
	}
	return d.vals[k]
}

// Set grava o valor; chave nova vai pro fim.
func (d *Doc) Set(k string, v any) *Doc {
	if d.vals == nil {
		d.vals = map[string]any{}
	}
	if _, ok := d.vals[k]; !ok {
		d.keys = append(d.keys, k)
	}
	d.vals[k] = v
	return d
}

// Del remove a chave.
func (d *Doc) Del(k string) {
	if d == nil {
		return
	}
	if _, ok := d.vals[k]; !ok {
		return
	}
	delete(d.vals, k)
	for i, x := range d.keys {
		if x == k {
			d.keys = append(d.keys[:i], d.keys[i+1:]...)
			break
		}
	}
}

// Str lê um campo como texto ("" se ausente; números e booleanos viram texto).
func (d *Doc) Str(k string) string {
	return AsStr(d.Get(k))
}

// AsStr converte um valor escalar em texto, como String(x) no JavaScript.
func AsStr(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case bool:
		if x {
			return "true"
		}
		return "false"
	case int64:
		return fmt.Sprint(x)
	case int:
		return fmt.Sprint(x)
	case float64:
		return FormatNum(x)
	}
	b, _ := json.Marshal(v)
	return string(b)
}

// Num lê um campo numérico (texto numérico também vale, como Number() no JavaScript).
func (d *Doc) Num(k string, def float64) float64 {
	switch x := d.Get(k).(type) {
	case int64:
		return float64(x)
	case int:
		return float64(x)
	case float64:
		return x
	case string:
		var f float64
		if _, err := fmt.Sscan(x, &f); err == nil {
			return f
		}
	}
	return def
}

// Map lê um campo objeto (nil se não for objeto).
func (d *Doc) Map(k string) *Doc {
	m, _ := d.Get(k).(*Doc)
	return m
}

// List lê um campo lista.
func (d *Doc) List(k string) []any {
	l, _ := d.Get(k).([]any)
	return l
}

// Clone: cópia profunda.
func (d *Doc) Clone() *Doc {
	if d == nil {
		return nil
	}
	return cloneVal(d).(*Doc)
}

func cloneVal(v any) any {
	switch x := v.(type) {
	case *Doc:
		if x == nil {
			return (*Doc)(nil)
		}
		c := &Doc{keys: append([]string(nil), x.keys...), vals: make(map[string]any, len(x.vals))}
		for k, val := range x.vals {
			c.vals[k] = cloneVal(val)
		}
		return c
	case []any:
		c := make([]any, len(x))
		for i, val := range x {
			c[i] = cloneVal(val)
		}
		return c
	}
	return v
}

// ---------- JSON (canal com a interface) ----------

// MarshalJSON grava na ordem das chaves.
func (d *Doc) MarshalJSON() ([]byte, error) {
	if d == nil {
		return []byte("null"), nil
	}
	var b bytes.Buffer
	b.WriteByte('{')
	for i, k := range d.keys {
		if i > 0 {
			b.WriteByte(',')
		}
		kb, _ := Marshal(k)
		b.Write(kb)
		b.WriteByte(':')
		vb, err := Marshal(d.vals[k])
		if err != nil {
			return nil, err
		}
		b.Write(vb)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

// Marshal como JSON.stringify: sem escapar <, > e & (o state.json fica igual ao do Electron)
func Marshal(v any) ([]byte, error) {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(b.Bytes(), []byte("\n")), nil
}

// MarshalIndent como JSON.stringify(v, null, 2)
func MarshalIndent(v any) ([]byte, error) {
	raw, err := Marshal(v)
	if err != nil {
		return nil, err
	}
	var b bytes.Buffer
	if err := json.Indent(&b, raw, "", "  "); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}

// UnmarshalJSON lê guardando a ordem; objetos aninhados também viram *Doc.
func (d *Doc) UnmarshalJSON(data []byte) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	v, err := decodeJSON(dec)
	if err != nil {
		return err
	}
	m, ok := v.(*Doc)
	if !ok {
		return fmt.Errorf("esperava objeto JSON")
	}
	*d = *m
	return nil
}

// FromJSON decodifica um valor JSON qualquer guardando a ordem dos objetos.
func FromJSON(data []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	return decodeJSON(dec)
}

func decodeJSON(dec *json.Decoder) (any, error) {
	t, err := dec.Token()
	if err != nil {
		return nil, err
	}
	switch x := t.(type) {
	case json.Delim:
		switch x {
		case '{':
			d := New()
			for dec.More() {
				kt, err := dec.Token()
				if err != nil {
					return nil, err
				}
				v, err := decodeJSON(dec)
				if err != nil {
					return nil, err
				}
				d.Set(kt.(string), v)
			}
			_, err := dec.Token()
			return d, err
		case '[':
			l := []any{}
			for dec.More() {
				v, err := decodeJSON(dec)
				if err != nil {
					return nil, err
				}
				l = append(l, v)
			}
			_, err := dec.Token()
			return l, err
		}
	case json.Number:
		if i, err := x.Int64(); err == nil {
			return i, nil
		}
		f, err := x.Float64()
		return f, err
	}
	return t, nil
}

// ---------- árvore do workspace ----------

// Sort ordena por sortKey e depois por nome, como sortNodes do Electron.
func Sort(nodes []*Doc) {
	sort.SliceStable(nodes, func(i, j int) bool {
		a, b := nodes[i].Num("sortKey", 0), nodes[j].Num("sortKey", 0)
		if a != b {
			return a < b
		}
		return nodes[i].Str("name") < nodes[j].Str("name")
	})
}

// Docs converte []*Doc em []any (pra guardar dentro de outro Doc).
func Docs(ds []*Doc) []any {
	out := make([]any, len(ds))
	for i, d := range ds {
		out[i] = d
	}
	return out
}

// Find acha um nó pela id na árvore de um workspace; devolve também as pastas acima dele.
func Find(ws *Doc, id string) (*Doc, []*Doc) {
	var walk func(children []any, anc []*Doc) (*Doc, []*Doc)
	walk = func(children []any, anc []*Doc) (*Doc, []*Doc) {
		for _, c := range children {
			d, _ := c.(*Doc)
			if d == nil {
				continue
			}
			if d.Str("id") == id {
				return d, anc
			}
			if d.Str("kind") == "folder" {
				if n, a := walk(d.List("children"), append(append([]*Doc{}, anc...), d)); n != nil {
					return n, a
				}
			}
		}
		return nil, nil
	}
	return walk(ws.List("children"), nil)
}

// Walk visita todos os nós da árvore (pastas e requests).
func Walk(children []any, fn func(n *Doc)) {
	for _, c := range children {
		if d, _ := c.(*Doc); d != nil {
			fn(d)
			if d.Str("kind") == "folder" {
				Walk(d.List("children"), fn)
			}
		}
	}
}
