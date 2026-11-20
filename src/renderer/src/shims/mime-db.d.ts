declare module 'mime-db' {
  const db: Record<string, { source?: string; extensions?: string[] }>
  export default db
}
