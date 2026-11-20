package doc

// Codificador JSON direto pros tipos do documento (*Doc, []any, string, números…). O encoding/json
// revalida e compacta os bytes devolvidos por cada MarshalJSON aninhado, então um histórico de respostas
// com bodies de MBs era percorrido várias vezes. A saída é a mesma do encoding/json com SetEscapeHTML(false).

import (
	"bytes"
	"encoding/json"
	"strconv"
	"unicode/utf8"
)

const hexDigits = "0123456789abcdef"

// appendString como o encoding/json (sem escapar <, > e &): \b \f \n \r \t, \u00XX nos outros controles,
// � em UTF-8 inválido e  /
func appendString(dst []byte, s string) []byte {
	dst = append(dst, '"')
	start := 0
	for i := 0; i < len(s); {
		if b := s[i]; b < utf8.RuneSelf {
			if b >= 0x20 && b != '"' && b != '\\' {
				i++
				continue
			}
			dst = append(dst, s[start:i]...)
			switch b {
			case '\\', '"':
				dst = append(dst, '\\', b)
			case '\b':
				dst = append(dst, '\\', 'b')
			case '\f':
				dst = append(dst, '\\', 'f')
			case '\n':
				dst = append(dst, '\\', 'n')
			case '\r':
				dst = append(dst, '\\', 'r')
			case '\t':
				dst = append(dst, '\\', 't')
			default:
				dst = append(dst, '\\', 'u', '0', '0', hexDigits[b>>4], hexDigits[b&0xF])
			}
			i++
			start = i
			continue
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError && size == 1 {
			dst = append(dst, s[start:i]...)
			dst = append(dst, '\\', 'u', 'f', 'f', 'f', 'd')
			i += size
			start = i
			continue
		}
		if r == ' ' || r == ' ' {
			dst = append(dst, s[start:i]...)
			dst = append(dst, '\\', 'u', '2', '0', '2', hexDigits[r&0xF])
			i += size
			start = i
			continue
		}
		i += size
	}
	dst = append(dst, s[start:]...)
	return append(dst, '"')
}

func appendValue(dst []byte, v any) ([]byte, error) {
	switch x := v.(type) {
	case nil:
		return append(dst, "null"...), nil
	case *Doc:
		if x == nil {
			return append(dst, "null"...), nil
		}
		dst = append(dst, '{')
		for i, k := range x.keys {
			if i > 0 {
				dst = append(dst, ',')
			}
			dst = appendString(dst, k)
			dst = append(dst, ':')
			var err error
			if dst, err = appendValue(dst, x.vals[k]); err != nil {
				return nil, err
			}
		}
		return append(dst, '}'), nil
	case []any:
		if x == nil {
			return append(dst, "null"...), nil
		}
		dst = append(dst, '[')
		for i, e := range x {
			if i > 0 {
				dst = append(dst, ',')
			}
			var err error
			if dst, err = appendValue(dst, e); err != nil {
				return nil, err
			}
		}
		return append(dst, ']'), nil
	case string:
		return appendString(dst, x), nil
	case bool:
		return strconv.AppendBool(dst, x), nil
	case int:
		return strconv.AppendInt(dst, int64(x), 10), nil
	case int64:
		return strconv.AppendInt(dst, x, 10), nil
	}
	// float64 (formato do encoding/json), structs e o resto
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return append(dst, bytes.TrimSuffix(b.Bytes(), []byte("\n"))...), nil
}
