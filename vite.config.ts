// Interface do Zeno (React). O app é a versão Go + Wails em wails/: `make build` lá compila isto e embute
// out/renderer no binário.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react(), tailwindcss()],
  define: {
    __ZENO_VERSION__: JSON.stringify(JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version)
  },
  resolve: {
    // httpsnippet (Gerar código) roda na interface: módulos do Node trocados pelos ports pro navegador
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      url: resolve(__dirname, 'node_modules/url/url.js'),
      querystring: resolve(__dirname, 'node_modules/querystring-es3/index.js'),
      'event-stream': resolve(__dirname, 'src/renderer/src/shims/event-stream.ts'),
      'form-data/lib/form_data': resolve(__dirname, 'src/renderer/src/shims/form-data.ts')
    }
  },
  build: {
    outDir: resolve(__dirname, 'out/renderer'),
    emptyOutDir: true,
    // minificado: menos JS pra carregar e compilar (memória parado)
    minify: true,
    chunkSizeWarningLimit: 1200
  }
})
