#!/usr/bin/env python3
"""Fontes dos módulos Go para o flatpak-builder (build offline, sem rede).

Uso: go-sources.py <vendor/modules.txt> > go-sources.json

Lê o modules.txt gerado por `go mod vendor` e, para cada módulo com pacotes usados, gera uma fonte
`archive` com o .zip do proxy.golang.org extraído em wails/vendor/<módulo> (o mesmo layout do
`go mod vendor`). O sha256 vem do .zip baixado por `go mod download`, que é idêntico ao do proxy.
"""
import hashlib
import json
import re
import subprocess
import sys


def escape(path):
    # proxy do Go: maiúscula vira "!" + minúscula (github.com/BurntSushi -> github.com/!burnt!sushi)
    return re.sub(r"[A-Z]", lambda m: "!" + m.group(0).lower(), path)


def main(modules_txt):
    mods, cur = [], None
    for line in open(modules_txt, encoding="utf-8"):
        if line.startswith("# "):
            parts = line[2:].split()
            # "# mod ver" (sem replace); "# mod ver => outro ver" usa o substituto
            if "=>" in parts:
                i = parts.index("=>")
                path, ver = parts[i + 1], parts[i + 2] if len(parts) > i + 2 else None
                cur = (parts[0], path, ver) if ver else None
            else:
                cur = (parts[0], parts[0], parts[1]) if len(parts) >= 2 else None
        elif line.strip() and not line.startswith("#") and cur:
            mods.append(cur)
            cur = None

    sources = []
    for vendor_path, path, ver in sorted(set(mods)):
        info = json.loads(subprocess.check_output(["go", "mod", "download", "-json", f"{path}@{ver}"]))
        with open(info["Zip"], "rb") as f:
            sha = hashlib.sha256(f.read()).hexdigest()
        sources.append({
            "type": "archive",
            "archive-type": "zip",
            "url": f"https://proxy.golang.org/{escape(path)}/@v/{escape(ver)}.zip",
            "sha256": sha,
            # o zip tem tudo dentro de "<módulo>@<versão>/"
            "strip-components": path.count("/") + 1,
            "dest": f"wails/vendor/{vendor_path}",
        })
    sources.append({"type": "file", "path": "go-modules.txt", "dest": "wails/vendor", "dest-filename": "modules.txt"})
    json.dump(sources, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main(sys.argv[1])
