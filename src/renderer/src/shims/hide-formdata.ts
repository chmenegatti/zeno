// O httpsnippet escolhe o FormData ao carregar: o nativo se window.FormData existir, senão o form-data
// do Node (aqui shims/form-data.ts, com a mesma saída do Electron). Este módulo é importado antes dele
// e esconde o nativo; codegen.ts devolve logo depois (restoreFormData).
const native = globalThis.FormData
;(globalThis as { FormData?: unknown }).FormData = undefined

export function restoreFormData(): void {
  globalThis.FormData = native
}
