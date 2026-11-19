// arquivos do próprio plugin podem ser importados com require('./…')
exports.saudacao = (nome, maiusculas) => {
  const s = `Olá, ${nome}!`
  return maiusculas ? s.toUpperCase() : s
}
