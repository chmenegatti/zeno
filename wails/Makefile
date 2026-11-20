# Zeno (Go + Wails). Precisa de Go, Node e, no Linux, libgtk-3-dev e libwebkit2gtk-4.1-dev.
.PHONY: frontend build cli deb rpm appimage run test vet e2e

TAGS = desktop,production,webkit2_41

# a interface (src/renderer, React) é compilada com o Vite e embutida no binário
frontend:
	cd .. && npx vite build
	rm -rf frontend/dist && mkdir -p frontend && cp -r ../out/renderer frontend/dist
	cp ../build/icons/512x512.png frontend/icon.png

build: frontend
	CGO_ENABLED=1 go build -tags $(TAGS) -trimpath -ldflags "-s -w" -o build/zeno .

# só a linha de comando: binário estático, sem WebKit (CI)
cli:
	CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o build/zeno-cli ./cmd/zeno-cli

# pacotes Linux (packaging/linux): mesma versão do package.json
VERSION ?= $(shell node -p "require('../package.json').version")
deb: build
	sh packaging/linux/deb.sh build/zeno $(VERSION) build/zeno_$(VERSION)_amd64.deb

rpm: build
	sh packaging/linux/rpm.sh build/zeno $(VERSION) build/zeno-$(VERSION).x86_64.rpm

appimage: build
	sh packaging/linux/appimage.sh build/zeno $(VERSION) build/Zeno-$(VERSION)-x86_64.AppImage

run: build
	./build/zeno

# pacotes sem interface: não precisam de GTK nem da interface compilada
test:
	go test ./internal/...

# ponta a ponta no app de verdade (precisa de tela; no CI: xvfb-run -a make e2e)
e2e: build
	bash e2e/run.sh

vet: frontend
	go vet -tags $(TAGS) ./...
