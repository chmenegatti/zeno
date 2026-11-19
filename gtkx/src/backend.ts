// O motor do Zeno sem Electron: mesmo Store (YAML), Engine (tags, scripts, asserções, cookies) e Vault.
// Nada aqui foi reescrito: são os arquivos de src/main e src/shared importados direto.

import { Cookies } from "../../src/main/cookies.ts";
import { Engine } from "../../src/main/engine.ts";
import { defaultDataDir, Store } from "../../src/main/store.ts";
import { Vault, type KeyProtector } from "../../src/main/vault.ts";
import type { SendResult } from "../../src/shared/api.ts";
import { findNode } from "../../src/shared/tree.ts";
import type { AppState, Folder, RequestDoc, TreeNode, Workspace } from "../../src/shared/types.ts";

export type { AppState, Folder, RequestDoc, SendResult, TreeNode, Workspace };
export { findNode };

/** protótipo: sem chaveiro (segredos do cofre não abrem); o Secret Service via GObject viria depois */
const noKeyring: KeyProtector = {
    available: async () => ({ ok: false, backend: "nenhum", weak: true }),
    protect: async () => {
        throw new Error("sem chaveiro no protótipo");
    },
    unprotect: async () => {
        throw new Error("sem chaveiro no protótipo");
    },
};

export const store = new Store(defaultDataDir());
store.load();
const vault = new Vault(store.dir, noKeyring);
export const engine = new Engine(store, vault, {}, { softSecrets: true, cookies: new Cookies(store.dir) });

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
export const METHOD_COLOR: Record<string, string> = {
    GET: "#2ec27e",
    POST: "#e5a50a",
    PUT: "#3584e4",
    PATCH: "#9141ac",
    DELETE: "#e01b24",
    HEAD: "#77767b",
    OPTIONS: "#77767b",
};

export const fmtSize = (n: number): string => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** texto da resposta pra mostrar: JSON formatado até 5 MB; binário vira aviso */
export function responseText(r: SendResult["response"]): string {
    if (r.error) return r.error;
    if (r.bodyEncoding === "base64") return `(binário, ${fmtSize(r.size)})`;
    const ct = r.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
    if (/json/i.test(ct) && !r.bodyFile && r.body.length < 5 * 1024 * 1024) {
        try {
            return JSON.stringify(JSON.parse(r.body), null, 2);
        } catch {
            /* corpo inválido: mostra cru */
        }
    }
    return r.bodyFile ? `${r.body}\n\n… (prévia: resposta de ${fmtSize(r.size)})` : r.body;
}
