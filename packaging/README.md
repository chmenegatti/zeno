# Gerenciadores de pacote

Manifestos prontos pra publicar o Zeno fora do GitHub Releases. A cada release: trocar a versão e os
sha256 (o GitHub mostra o `digest` de cada asset: `gh api repos/chmenegatti/zeno/releases/tags/vX -q '.assets[]|.name+" "+.digest'`).

| Onde | Arquivo | Como publicar |
|---|---|---|
| **AUR** (Arch/Manjaro) | `aur/PKGBUILD`, `aur/.SRCINFO` | Conta no aur.archlinux.org com chave SSH; `git clone ssh://aur@aur.archlinux.org/zeno-api-client-bin.git`, copiar os dois arquivos, `makepkg -si` pra testar, commit e push. O nome `zeno` já é de outro projeto no AUR. |
| **Homebrew** (macOS) | `homebrew/zeno.rb` | Publicado em [chmenegatti/homebrew-tap](https://github.com/chmenegatti/homebrew-tap) (`Casks/zeno.rb`): atualizar lá a cada release. Instalação: `brew install --cask chmenegatti/tap/zeno`. O cask oficial exige app assinado/notarizado. |
| **Scoop** (Windows) | `scoop/zeno.json` | Publicado em [chmenegatti/scoop-bucket](https://github.com/chmenegatti/scoop-bucket) (`bucket/zeno.json`; `checkver`/`autoupdate` prontos): `scoop bucket add zeno https://github.com/chmenegatti/scoop-bucket && scoop install zeno`. Depois de popular, dá pra propor no bucket *extras*. |
| **winget** (Windows) | `winget/1.1.0/*.yaml` | PR no `microsoft/winget-pkgs` em `manifests/c/ChMenegatti/Zeno/1.1.0/` (ou `wingetcreate submit`). Instalação: `winget install ChMenegatti.Zeno`. |
| **Flathub** | — | Pede manifesto que compila do código-fonte (Go + Node offline); fica pra depois. |
| **AlternativeTo** | — | Cadastro manual em alternativeto.net como alternativa ao Insomnia, Postman e Bruno. |
