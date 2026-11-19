# Protótipo Go/Wails. Precisa de: libgtk-3-dev libwebkit2gtk-4.1-dev
.PHONY: frontend build run
TAGS = desktop,production,webkit2_41

frontend:
	cd .. && npx electron-vite build
	rm -rf frontend/dist && mkdir -p frontend && cp -r ../out/renderer frontend/dist

build: frontend
	CGO_ENABLED=1 go build -tags $(TAGS) -trimpath -ldflags "-s -w" -o build/zeno-go .

run: build
	./build/zeno-go
