package httpc

// Server-Sent Events (#6): a resposta text/event-stream é lida em fluxo e cada evento sai na hora
// (o body completo continua indo pro histórico no fim).

import (
	"bufio"
	"io"
	"strings"
	"time"
)

// SSEEvent: um evento do stream (campos do padrão EventSource)
type SSEEvent struct {
	Event string `json:"event"`
	Data  string `json:"data"`
	ID    string `json:"id,omitempty"`
	// ms desde o início do envio
	AtMs int64 `json:"atMs"`
}

// teto do body guardado no histórico; os eventos continuam saindo depois disso
const sseMaxBody = 20 << 20

// IsSSE: content-type de event stream
func IsSSE(contentType string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(contentType)), "text/event-stream")
}

// readSSE lê até o servidor fechar (ou o envio ser cancelado), emitindo cada evento completo
func readSSE(r io.Reader, start time.Time, emit func(SSEEvent)) ([]byte, error) {
	br := bufio.NewReader(r)
	var body []byte
	var ev SSEEvent
	var data []string
	has := false
	dispatch := func() {
		if has {
			ev.Data = strings.Join(data, "\n")
			if ev.Event == "" {
				ev.Event = "message"
			}
			ev.AtMs = round(ms(time.Since(start)))
			emit(ev)
		}
		ev, data, has = SSEEvent{ID: ev.ID}, nil, false
	}
	for {
		line, err := br.ReadString('\n')
		if len(body)+len(line) <= sseMaxBody {
			body = append(body, line...)
		}
		if line != "" {
			l := strings.TrimRight(line, "\r\n")
			switch {
			case l == "":
				dispatch()
			case strings.HasPrefix(l, ":"):
				// comentário (keep-alive)
			default:
				field, value, _ := strings.Cut(l, ":")
				value = strings.TrimPrefix(value, " ")
				switch field {
				case "event":
					ev.Event, has = value, true
				case "data":
					data, has = append(data, value), true
				case "id":
					ev.ID, has = value, true
				}
			}
		}
		if err != nil {
			dispatch()
			if err == io.EOF {
				return body, nil
			}
			return body, err
		}
	}
}
