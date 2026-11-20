import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    // cli.js: a CLI roda com node puro, sem Electron
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts'), cli: resolve(__dirname, 'src/main/cli-node.ts') } } }
  },
  preload: { resolve: { alias: shared } },
  renderer: {
    // httpsnippet (Gerar código) roda no renderer: módulos do Node trocados pelos ports pro navegador
    resolve: {
      alias: {
        ...shared,
        url: resolve(__dirname, 'node_modules/url/url.js'),
        querystring: resolve(__dirname, 'node_modules/querystring-es3/index.js'),
        'event-stream': resolve(__dirname, 'src/renderer/src/shims/event-stream.ts'),
        'form-data/lib/form_data': resolve(__dirname, 'src/renderer/src/shims/form-data.ts')
      }
    },
    plugins: [react(), tailwindcss()],
    // minificado: menos JS pra carregar e compilar (no WebKitGTK da versão Go, ~memória parado)
    build: { minify: true }
  }
})
