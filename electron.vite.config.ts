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
    resolve: { alias: shared },
    plugins: [react(), tailwindcss()]
  }
})
