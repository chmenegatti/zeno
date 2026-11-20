// httpsnippet usa event-stream só pra ler o corpo do form-data (shims/form-data.ts)
export const map = (fn: (data: string) => void): { write(data: string): void } => ({ write: fn })
