# Flatpak / Flathub

Pacote do Zeno para o [Flathub](https://flathub.org), app id `com.cesarmenegatti.Zeno`.

| Arquivo | O quê |
|---|---|
| `com.cesarmenegatti.Zeno.yml` | manifesto do flatpak-builder: runtime GNOME 51 (GTK 3 + WebKitGTK 4.1), Go e Node 24 das extensões do SDK |
| `com.cesarmenegatti.Zeno.metainfo.xml` | AppStream: descrição, screenshots, releases |
| `com.cesarmenegatti.Zeno.desktop` | atalho do menu (`Icon` = app id) |
| `go-sources.json`, `go-modules.txt` | módulos Go (zips do proxy.golang.org, extraídos em `wails/vendor`) — **gerados** |
| `node-sources.json` | pacotes npm do `package-lock.json` (cache offline do npm) — **gerado** |
| `update-sources.sh`, `go-sources.py` | regeneram os arquivos acima |
| `screenshots/` | PNGs referenciados no metainfo (pelo `main`) |
| `lint-exceptions.json` | exceção do linter que o CI assume concedida (ver Permissões) |

O Flathub compila sem rede: o app vem do git na tag do release e todas as dependências são fontes declaradas
no manifesto. O build roda `npm ci --offline` e depois `make -C wails build` (Vite + `go build -mod=vendor`
com a tag `webkit2_41`). O workflow `.github/workflows/flatpak.yml` monta o pacote do mesmo jeito em todo PR
que mexe aqui, roda o `flatpak-builder-lint` e deixa o `zeno.flatpak` como artefato
(`flatpak install --user zeno.flatpak`).

## Permissões

- `--socket=wayland`, `--socket=fallback-x11`, `--share=ipc`, `--device=dri`: janela GTK/WebKit.
- `--share=network`: é um cliente de API (inclui o mock server em `127.0.0.1` e o login OAuth).
- `--talk-name=org.freedesktop.secrets`: a chave do cofre fica no chaveiro do sistema (Secret Service).
- `--socket=ssh-auth`: push/pull por SSH na integração git usa as chaves do ssh-agent. O `git` vai no pacote
  (módulo próprio no manifesto: o runtime GNOME não tem git; o `ssh` vem do runtime).
- `--filesystem=home`: o seletor de pastas/arquivos do Wails v2 é o `GtkFileChooserDialog`, que não passa
  pelo portal; sem acesso à pasta pessoal não dá pra ligar workspaces a pastas do usuário, importar/exportar,
  escolher certificados, `.proto` ou usar `{% file %}`. O linter do Flathub trata isso como erro
  (`finish-args-home-filesystem-access`): a exceção precisa ser pedida e justificada no PR de envio (o CI
  usa `lint-exceptions.json` pra simular a exceção concedida).

Abrir links usa o portal (xdg-open do runtime). Os dados ficam em `~/.var/app/com.cesarmenegatti.Zeno/data/zeno`
(não em `~/.local/share/zeno`); pra usar os dados de uma instalação .deb/.rpm/AppImage:
`flatpak override --user --env=ZENO_DATA_DIR=$HOME/.local/share/zeno com.cesarmenegatti.Zeno`.

## A cada release

1. Na tag nova (`git checkout vX.Y.Z`), regenerar as fontes:
   ```sh
   pip install --user "git+https://github.com/flatpak/flatpak-builder-tools.git#subdirectory=node"
   packaging/flatpak/update-sources.sh
   ```
2. No manifesto, trocar `tag` e `commit` do source `git` do módulo `zeno` (`git rev-parse vX.Y.Z^{commit}`).
3. No metainfo, adicionar o `<release version="X.Y.Z" date="AAAA-MM-DD">` no topo da lista.
4. Copiar os arquivos (menos `screenshots/`, scripts e `lint-exceptions.json`) pro repositório `flathub/com.cesarmenegatti.Zeno`
   e abrir PR lá; o buildbot do Flathub compila e publica depois do merge.

## Enviar pro Flathub (primeira vez)

Antes: este PR no `main` (as URLs das screenshots apontam pro `main`) e, de preferência, screenshots com a
interface em inglês. Conferir com rede: `flatpak run --command=flatpak-builder-lint org.flatpak.Builder appstream
packaging/flatpak/com.cesarmenegatti.Zeno.metainfo.xml`.

1. Fork de <https://github.com/flathub/flathub> **desmarcando** "Copy the master branch only".
2. ```sh
   git clone --branch=new-pr git@github.com:chmenegatti/flathub.git && cd flathub
   git checkout -b com.cesarmenegatti.Zeno new-pr
   cp <zeno>/packaging/flatpak/{com.cesarmenegatti.Zeno.yml,com.cesarmenegatti.Zeno.metainfo.xml,com.cesarmenegatti.Zeno.desktop,go-sources.json,go-modules.txt,node-sources.json} .
   git add . && git commit -m "Add com.cesarmenegatti.Zeno" && git push -u origin com.cesarmenegatti.Zeno
   ```
3. PR pra `flathub/flathub` com base **`new-pr`** (não `master`), título `Add com.cesarmenegatti.Zeno`, e
   preencher o checklist do template.
4. Comentar `bot, build` no PR pra um build de teste; responder a revisão.
   No texto do PR, pedir a exceção `finish-args-home-filesystem-access` com a justificativa (seletor de
   arquivos sem portal no Wails v2; workspaces são pastas/repos git em qualquer lugar da pasta pessoal).
5. App id em domínio próprio: o Flathub confere que `cesarmenegatti.com` é do autor. Depois de publicado,
   em flathub.org › Developer settings, verificar o app: servir o token em
   `https://cesarmenegatti.com/.well-known/org.flathub.VerifiedApps.txt`.

## Limitações conhecidas

- O git do pacote não enxerga a configuração de credenciais que dependa de programas do sistema
  (credential helpers como `gh`, `git-credential-libsecret` do host). O login por `gh auth token` também não
  funciona (o `gh` não está no sandbox): cole um token do GitHub.
- O import automático do Insomnia procura em `$XDG_CONFIG_HOME/Insomnia`, que no Flatpak é a pasta do sandbox;
  importe pelo arquivo exportado (`.json`/`.yaml`).
