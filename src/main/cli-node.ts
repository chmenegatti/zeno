// `node out/main/cli.js run …`: CLI sem Electron (CI). Sem chaveiro: valores cifrados não abrem, use --var.
import { noKeyring, runCli } from './cli'

process.on('unhandledRejection', (e) => console.error('promise rejeitada sem tratamento:', e))
runCli(process.argv.slice(2), noKeyring).then((code) => process.exit(code))
