# Zeno em Go + Wails (migração: #53). Precisa de Go, Node e, no Linux, libgtk-3-dev e libwebkit2gtk-4.1-dev.
.PHONY: frontend build run test vet

TAGS = desktop,production,webkit2_41

# a interface é a mesma do Electron (src/renderer), compilada com electron-vite e embutida no binário
frontend:
	cd .. && npx electron-vite build
	rm -rf frontend/dist && mkdir -p frontend && cp -r ../out/renderer frontend/dist
	cp ../build/icons/512x512.png frontend/icon.png

build: frontend
	CGO_ENABLED=1 go build -tags $(TAGS) -trimpath -ldflags "-s -w" -o build/zeno .

run: build
	./build/zeno

# pacotes sem interface: não precisam de GTK nem da interface compilada
test:
	go test ./internal/...

vet: frontend
	go vet -tags $(TAGS) ./...
