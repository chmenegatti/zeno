// YAML no mesmo formato que o Zeno em Electron grava (biblioteca `yaml`, YAML 1.2, lineWidth 0):
// chaves na ordem, aspas duplas só quando o texto puro mudaria de sentido, texto de várias linhas
// como bloco literal (|, |-, |+), listas indentadas sob a chave, [] e {} para vazios.

package doc

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// ParseYAML lê um documento YAML guardando a ordem das chaves.
func ParseYAML(data []byte) (any, error) {
	var n yaml.Node
	if err := yaml.Unmarshal(data, &n); err != nil {
		return nil, err
	}
	if n.Kind == 0 {
		return nil, nil
	}
	return fromNode(&n)
}

func fromNode(n *yaml.Node) (any, error) {
	switch n.Kind {
	case yaml.DocumentNode:
		if len(n.Content) == 0 {
			return nil, nil
		}
		return fromNode(n.Content[0])
	case yaml.AliasNode:
		return fromNode(n.Alias)
	case yaml.MappingNode:
		d := New()
		for i := 0; i+1 < len(n.Content); i += 2 {
			k := n.Content[i]
			if k.Kind == yaml.ScalarNode && k.Tag == "!!merge" {
				continue
			}
			v, err := fromNode(n.Content[i+1])
			if err != nil {
				return nil, err
			}
			d.Set(k.Value, v)
		}
		return d, nil
	case yaml.SequenceNode:
		l := make([]any, 0, len(n.Content))
		for _, c := range n.Content {
			v, err := fromNode(c)
			if err != nil {
				return nil, err
			}
			l = append(l, v)
		}
		return l, nil
	case yaml.ScalarNode:
		switch n.ShortTag() {
		case "!!null":
			return nil, nil
		case "!!bool":
			var b bool
			err := n.Decode(&b)
			return b, err
		case "!!int":
			var i int64
			if err := n.Decode(&i); err == nil {
				return i, nil
			}
			var f float64
			err := n.Decode(&f)
			return f, err
		case "!!float":
			var f float64
			err := n.Decode(&f)
			return f, err
		}
		return n.Value, nil
	}
	return nil, fmt.Errorf("nó YAML não suportado (%d)", n.Kind)
}

// EncodeYAML grava no formato do Electron.
func EncodeYAML(v any) []byte {
	var b bytes.Buffer
	writeValue(&b, v, "", false)
	out := b.Bytes()
	if len(out) == 0 || out[len(out)-1] != '\n' {
		out = append(out, '\n')
	}
	return out
}

// valor como documento/raiz ou depois de "chave:" / "- "
func writeValue(b *bytes.Buffer, v any, indent string, inline bool) {
	switch x := v.(type) {
	case *Doc:
		if x.Len() == 0 {
			if inline {
				b.WriteString(" ")
			}
			b.WriteString("{}\n")
			return
		}
		if inline {
			b.WriteString("\n")
		}
		writeMap(b, x, indent, false)
	case []any:
		if len(x) == 0 {
			if inline {
				b.WriteString(" ")
			}
			b.WriteString("[]\n")
			return
		}
		if inline {
			b.WriteString("\n")
		}
		writeSeq(b, x, indent)
	default:
		if inline {
			b.WriteString(" ")
		}
		b.WriteString(scalar(v, indent, false))
		b.WriteString("\n")
	}
}

// firstInline: a primeira chave continua a linha de "- "
func writeMap(b *bytes.Buffer, d *Doc, indent string, firstInline bool) {
	for i, k := range d.keys {
		if !(i == 0 && firstInline) {
			b.WriteString(indent)
		}
		b.WriteString(scalar(k, indent, true))
		b.WriteString(":")
		writeValue(b, d.vals[k], indent+"  ", true)
	}
}

func writeSeq(b *bytes.Buffer, l []any, indent string) {
	for _, item := range l {
		b.WriteString(indent)
		b.WriteString("-")
		switch x := item.(type) {
		case *Doc:
			if x.Len() == 0 {
				b.WriteString(" {}\n")
				continue
			}
			b.WriteString(" ")
			writeMap(b, x, indent+"  ", true)
		case []any:
			if len(x) == 0 {
				b.WriteString(" []\n")
				continue
			}
			// lista dentro de lista: "- - a"
			b.WriteString(" ")
			var inner bytes.Buffer
			writeSeq(&inner, x, indent+"  ")
			b.WriteString(strings.TrimPrefix(inner.String(), indent+"  "))
		default:
			b.WriteString(" ")
			b.WriteString(scalar(item, indent+"  ", false))
			b.WriteString("\n")
		}
	}
}

// FormatNum escreve número como o JavaScript (String(n)).
func FormatNum(f float64) string {
	switch {
	case math.IsNaN(f):
		return ".nan"
	case math.IsInf(f, 1):
		return ".inf"
	case math.IsInf(f, -1):
		return "-.inf"
	}
	a := math.Abs(f)
	if a != 0 && (a < 1e-6 || a >= 1e21) {
		s := strconv.FormatFloat(f, 'e', -1, 64)
		// Go: 1e+21, 1e-07; JS: 1e+21, 1e-7
		s = regexp.MustCompile(`e([+-])0*(\d)`).ReplaceAllString(s, "e$1$2")
		return s
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}

func scalar(v any, indent string, key bool) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case bool:
		if x {
			return "true"
		}
		return "false"
	case int64:
		return strconv.FormatInt(x, 10)
	case int:
		return strconv.Itoa(x)
	case float64:
		return FormatNum(x)
	case string:
		return str(x, indent, key)
	}
	b, _ := json.Marshal(v)
	return string(b)
}

var (
	// texto que não pode ficar puro (início especial, ": ", " #", espaço/":" no fim…)
	plainBad = regexp.MustCompile("^[\\n\\t ,\\[\\]{}#&*!|>'\"%@`]|^[?-]$|^[?-][ \\t]|[\\n:][ \\t]|[ \\t]\\n|[\\n\\t ]#|[\\n\\t :]$")
	docMark  = regexp.MustCompile(`(?m)^(%|---|\.\.\.)`)
	// texto que o YAML 1.2 leria como outro tipo
	coreTypes = []*regexp.Regexp{
		regexp.MustCompile(`^(?:~|[Nn]ull|NULL)?$`),
		regexp.MustCompile(`^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$`),
		regexp.MustCompile(`^0o[0-7]+$`),
		regexp.MustCompile(`^[-+]?[0-9]+$`),
		regexp.MustCompile(`^0x[0-9a-fA-F]+$`),
		regexp.MustCompile(`^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$`),
		regexp.MustCompile(`^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$`),
		regexp.MustCompile(`^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$`),
	}
	ctrlChars = regexp.MustCompile("[\x00-\x08\x0b-\x1f\x7f-\u009f]")
)

func str(s, indent string, key bool) string {
	if ctrlChars.MatchString(s) {
		return doubleQuoted(s)
	}
	multi := strings.Contains(s, "\n")
	if key && multi {
		return quoted(s)
	}
	if s == "" || plainBad.MatchString(s) {
		if key || !multi {
			return quoted(s)
		}
		return block(s, indent)
	}
	if !key && multi {
		return block(s, indent)
	}
	if docMark.MatchString(s) {
		return quoted(s)
	}
	for _, re := range coreTypes {
		if re.MatchString(s) {
			return quoted(s)
		}
	}
	return s
}

func quoted(s string) string {
	hasDouble, hasSingle := strings.Contains(s, `"`), strings.Contains(s, "'")
	if hasDouble && !hasSingle {
		if strings.Contains(s, "\n") || regexp.MustCompile(`[ \t]\n|\n[ \t]`).MatchString(s) {
			return doubleQuoted(s)
		}
		return "'" + strings.ReplaceAll(s, "'", "''") + "'"
	}
	return doubleQuoted(s)
}

// como JSON.stringify + os escapes curtos do YAML (\0, \a, \v, \e, \xNN)
func doubleQuoted(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case 0:
			b.WriteString(`\0`)
		case 7:
			b.WriteString(`\a`)
		case 0x0b:
			b.WriteString(`\v`)
		case 0x1b:
			b.WriteString(`\e`)
		default:
			if r < 0x20 {
				fmt.Fprintf(&b, `\x%02x`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return b.String()
}

// bloco literal: | (uma quebra no fim), |- (nenhuma), |+ (várias); indicador de indentação se começa com espaço
func block(s, indent string) string {
	if regexp.MustCompile(`\n[\t ]+$`).MatchString(s) || strings.TrimSpace(s) == "" {
		return quoted(s)
	}
	if indent == "" {
		indent = "  "
	}
	value := s
	endStart := len(value)
	for endStart > 0 {
		ch := value[endStart-1]
		if ch != '\n' && ch != '\t' && ch != ' ' {
			break
		}
		endStart--
	}
	end := value[endStart:]
	chomp := ""
	nl := strings.Index(end, "\n")
	switch {
	case nl == -1:
		chomp = "-"
	case value == end || nl != len(end)-1:
		chomp = "+"
	}
	if end != "" {
		value = value[:len(value)-len(end)]
		end = strings.TrimSuffix(end, "\n")
		end = regexp.MustCompile(`\n+`).ReplaceAllString(end, "$0"+indent)
	}
	startWithSpace := false
	startNl := -1
	startEnd := 0
	for ; startEnd < len(value); startEnd++ {
		ch := value[startEnd]
		if ch == ' ' {
			startWithSpace = true
		} else if ch == '\n' {
			startNl = startEnd
		} else {
			break
		}
	}
	cut := startEnd
	if startNl < startEnd {
		cut = startNl + 1
	}
	start := value[:cut]
	if start != "" {
		value = value[len(start):]
		start = regexp.MustCompile(`\n+`).ReplaceAllString(start, "$0"+indent)
	}
	header := chomp
	if startWithSpace {
		header = "2" + chomp
	}
	value = regexp.MustCompile(`\n+`).ReplaceAllString(value, "$0"+indent)
	return "|" + header + "\n" + indent + start + value + end
}
