# Política de segurança

## Versões com suporte

Correções de segurança saem sempre na versão mais recente. Atualize pela [página de releases](https://github.com/chmenegatti/zeno/releases/latest).

## Como relatar uma vulnerabilidade

**Não abra issue pública.** Use o [relato privado de vulnerabilidade](https://github.com/chmenegatti/zeno/security/advisories/new) do GitHub, com:

- descrição do problema e impacto;
- passos para reproduzir (ou prova de conceito);
- versão do Zeno e sistema operacional.

Você recebe uma resposta em até 7 dias. Depois da correção publicada, o relato é divulgado com crédito a quem encontrou, se você quiser.

## Modelo de segurança do cofre

O que o cofre protege:

- Valores marcados como secretos ficam nos arquivos YAML cifrados com **AES-256-GCM** (IV aleatório de 96 bits por valor, tag de autenticação de 128 bits). Adulteração é detectada.
- A chave mestra tem 256 bits aleatórios e fica em `<dados>/.vault/key` (permissão `600`), cifrada pelo chaveiro do sistema via [`safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage) do Electron: libsecret/gnome-keyring ou KWallet no Linux, Keychain no macOS, DPAPI no Windows.
- No Linux, se o único backend disponível for `basic_text` (senha fixa embutida), o Zeno recusa criar o cofre.
- Só o processo principal decifra. A interface recebe o valor cifrado e mostra `••••••`, exceto quando o usuário clica em *mostrar*.

O que o cofre **não** protege:

- Senhas escritas no meio de URLs ou bodies (o Zeno aponta esses lugares como aviso, para virarem variáveis secretas).
- O histórico de respostas em `.responses/`, que pode conter tokens devolvidos por servidores.
- Um atacante com acesso à sua sessão desbloqueada, que consegue usar o chaveiro como você.
