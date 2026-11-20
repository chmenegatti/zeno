package i18n

// pt → en (net)
func init() {
	add(map[string]string{
		// httpc
		"\n… (%d caracteres a mais)":      "\n… (%d more characters)",
		"arquivo %s":                      "file %s",
		"timeout de %s ms":                "timeout of %s ms",
		"cancelado":                       "canceled",
		"servidor não mandou certificado": "server sent no certificate",
		"arquivo do multipart: %w":        "multipart file: %w",
		"erro: %s":                        "error: %s",
		"proxy personalizado sem endereço (configurações do workspace)": "custom proxy has no address (workspace settings)",
		"endereço do proxy inválido: %q":                                "invalid proxy address: %q",
		"proxy %q: use http://, https:// ou socks5://":                  "proxy %q: use http://, https:// or socks5://",
		"CA própria: %w": "custom CA: %w",
		"CA própria: nenhum certificado PEM em %s": "custom CA: no PEM certificate in %s",
		"PFX: %w (senha certa?)":                   "PFX: %w (wrong password?)",
		"sem arquivo de certificado":               "no certificate file",
		"certificado do cliente pra %s: %w":        "client certificate for %s: %w",
		"proxy %s recusou o túnel: %s":             "proxy %s refused the tunnel: %s",
		// grpcc
		"endereço gRPC inválido (grpc://host:porta ou grpcs://host): %s": "invalid gRPC address (grpc://host:port or grpcs://host): %s",
		"sem conexão": "not connected",
		"server reflection: %s (sem reflection? escolha um arquivo .proto)": "server reflection: %s (no reflection? choose a .proto file)",
		"escolha o serviço e o método":                                      "choose the service and method",
		"método %s/%s não encontrado":                                       "method %s/%s not found",
		"mensagem não confere com %s: %w":                                   "message doesn't match %s: %w",
		"envio já finalizado":                                               "sending already finished",
		"nenhuma chamada gRPC em andamento":                                 "no gRPC call in progress",
		// ws
		"WebSocket não está conectado": "WebSocket is not connected",
		// mock
		"workspace não existe mais":      "workspace no longer exists",
		"sem exemplo para %s %s":         "no example for %s %s",
		"porta %d em uso: escolha outra": "port %d in use: choose another",
	})
}
