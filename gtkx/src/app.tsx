// Interface nativa (GTK4 + Adwaita) do protótipo: lista lateral, método/URL, body e resposta.
// Os dados e o envio são os do Zeno (src/main), sem alteração.

import { DropDown, ListView, type ListItem } from "@gtkx/components";
import * as Gtk from "@gtkx/gi/gtk";
import * as GtkSource from "@gtkx/gi/gtksource";
import * as Pango from "@gtkx/gi/pango";
import { AdwApplicationWindow, AdwHeaderBar, AdwToolbarView } from "@gtkx/jsx/adw";
import { GtkApplication, GtkBox, GtkButton, GtkEntry, GtkImage, GtkLabel, GtkPaned, GtkScrolledWindow, GtkSearchEntry, GtkSeparator, GtkSpinner, GtkToggleButton } from "@gtkx/jsx/gtk";
import { GtkSourceBuffer, GtkSourceView } from "@gtkx/jsx/gtksource";
import { quit } from "@gtkx/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { engine, findNode, fmtSize, METHOD_COLOR, METHODS, responseText, store, type RequestDoc, type SendResult, type TreeNode, type Workspace } from "./backend.js";
import { registerBench } from "./bench.js";

type Row = { kind: "folder" | "request"; name: string; method?: string };

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const methodMarkup = (m: string): string => `<span font_family="monospace" weight="bold" size="small" foreground="${METHOD_COLOR[m] ?? "#77767b"}">${esc(m.slice(0, 4))}</span>`;

function toItems(nodes: TreeNode[], filter: string): ListItem<Row>[] {
    const out: ListItem<Row>[] = [];
    for (const n of nodes) {
        if (n.kind === "folder") {
            const children = toItems(n.children, filter);
            if (!filter || children.length) out.push({ id: n.id, value: { kind: "folder", name: n.name }, children });
        } else if (!filter || n.name.toLowerCase().includes(filter) || n.url.toLowerCase().includes(filter)) {
            out.push({ id: n.id, value: { kind: "request", name: n.name, method: n.method } });
        }
    }
    return out;
}

const folderIds = (nodes: TreeNode[]): string[] => nodes.flatMap((n) => (n.kind === "folder" ? [n.id, ...folderIds(n.children)] : []));

const scheme = (): GtkSource.StyleScheme | null => GtkSource.StyleSchemeManager.getDefault().getScheme("Adwaita-dark");
const lang = (id: string): GtkSource.Language | null => GtkSource.LanguageManager.getDefault().getLanguage(id);

const MainWindow = () => {
    const [workspaces, setWorkspaces] = useState<Workspace[]>(() => store.list());
    const [app, setApp] = useState(() => store.getState());
    const ws = workspaces.find((w) => w.id === app.activeWorkspaceId) ?? workspaces[0];
    const envId = (ws && app.activeEnv[ws.id]) ?? null;
    const [filter, setFilter] = useState("");
    const [expanded, setExpanded] = useState<string[]>(() => (ws ? folderIds(ws.children) : []));
    const reqId = app.activeRequestId;
    const found = ws && reqId ? findNode(ws, reqId) : null;
    const req = found?.node.kind === "request" ? found.node : null;

    // edição local do request ativo
    const [method, setMethod] = useState(req?.method ?? "GET");
    const [url, setUrl] = useState(req?.url ?? "");
    const bodyRef = useRef(req?.body.text ?? "");
    const [bodyText, setBodyText] = useState(req?.body.text ?? "");
    const [tab, setTab] = useState<"body" | "headers">("body");
    useEffect(() => {
        setMethod(req?.method ?? "GET");
        setUrl(req?.url ?? "");
        bodyRef.current = req?.body.text ?? "";
        setBodyText(req?.body.text ?? "");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [req?.id]);

    const [results, setResults] = useState<Record<string, SendResult>>({});
    const [sending, setSending] = useState(false);
    const result = req ? results[req.id] : undefined;
    const respText = useMemo(() => (result ? responseText(result.response) : ""), [result]);
    const respView = useRef<GtkSource.View | null>(null);
    useEffect(() => {
        respView.current?.getBuffer().setText(respText, -1);
    }, [respText]);

    // o DropDown avisa a seleção inicial ao montar: só vale o que o usuário escolhe depois
    const settled = useRef(false);
    useEffect(() => {
        const t = setTimeout(() => (settled.current = true), 300);
        return () => clearTimeout(t);
    }, []);

    const patchApp = (p: Partial<typeof app>): void => {
        const next = { ...app, ...p };
        setApp(next);
        store.setState(next);
    };

    const wsItems = useMemo(() => workspaces.map((w) => ({ id: w.id, value: w.name })), [workspaces]);
    const envItems = useMemo(
        () => [{ id: "", value: "Sem ambiente" }, ...(ws?.environments.filter((e) => e.parentId !== null).map((e) => ({ id: e.id, value: e.name })) ?? [])],
        [ws?.environments],
    );
    const methodItems = useMemo(() => METHODS.map((m) => ({ id: m, value: m })), []);
    const items = useMemo(() => (ws ? toItems(ws.children, filter.trim().toLowerCase()) : []), [ws, filter]);
    // filtrando: abre tudo pra mostrar os achados
    const expandedIds = filter.trim() && ws ? folderIds(ws.children) : expanded;

    const send = async (): Promise<void> => {
        if (!ws || !req || sending) return;
        const next: RequestDoc = { ...req, method, url, body: req.body.mime ? { ...req.body, text: bodyRef.current } : req.body };
        store.saveRequest(next);
        setWorkspaces([...store.list()]);
        setSending(true);
        try {
            const r = await engine.execute(ws, next, envId);
            // como no Electron: o histórico guarda a prévia quando a resposta é grande
            const shown = { ...r, response: r.history.find((h) => h.id === r.response.id) ?? r.response };
            setResults((s) => ({ ...s, [next.id]: shown }));
        } catch (e) {
            console.error("envio falhou:", e);
        } finally {
            setSending(false);
        }
    };

    registerBench({
        setFilter,
        select: (name) => {
            const hit = ws && findReq(ws.children, name);
            if (hit) {
                setExpanded((e) => [...new Set([...e, ...folderIds(ws.children)])]);
                patchApp({ activeRequestId: hit.id });
            }
        },
        send,
        sending,
        lastStatus: result?.response.status,
    });

    const r = result?.response;
    const ok = r && !r.error && r.status < 400;

    const sidebar = (
        <GtkBox orientation={Gtk.Orientation.VERTICAL} spacing={6} marginTop={6} marginStart={6} marginEnd={6} widthRequest={260}>
            <GtkSearchEntry placeholderText="Filtrar" onSearchChanged={(e) => setFilter(e.getText())} />
            <GtkScrolledWindow vexpand hscrollbarPolicy={Gtk.PolicyType.NEVER}>
                <ListView<Row>
                    cssClasses={["navigation-sidebar"]}
                    items={items}
                    expandedIds={expandedIds}
                    onExpandedChange={(ids) => !filter.trim() && setExpanded(ids)}
                    selectedIds={reqId ? [reqId] : []}
                    onSelectionChanged={(ids) => {
                        const id = ids[0];
                        if (id && ws && findNode(ws, id)?.node.kind === "request" && id !== reqId) patchApp({ activeRequestId: id });
                    }}
                    renderItem={({ item }) => (
                        <GtkBox spacing={8}>
                            {item.kind === "request" ? (
                                <GtkLabel useMarkup label={methodMarkup(item.method ?? "GET")} widthChars={4} xalign={0} />
                            ) : (
                                <GtkImage iconName="folder-symbolic" cssClasses={["dim-label"]} />
                            )}
                            <GtkLabel label={item.name} ellipsize={Pango.EllipsizeMode.END} xalign={0} hexpand />
                        </GtkBox>
                    )}
                />
            </GtkScrolledWindow>
        </GtkBox>
    );

    const requestPane = req ? (
        <GtkBox orientation={Gtk.Orientation.VERTICAL} spacing={8} marginTop={8} marginStart={8} marginEnd={8} marginBottom={8}>
            <GtkLabel label={req.name} cssClasses={["title-4"]} xalign={0} />
            <GtkBox spacing={6}>
                <DropDown<string>
                    items={methodItems}
                    selectedId={method}
                    onSelectionChanged={setMethod}
                    renderItem={({ item }) => <GtkLabel useMarkup label={methodMarkup(item)} />}
                />
                <GtkEntry text={url} hexpand onChanged={(e) => setUrl(e.getText())} onActivate={() => void send()} />
                <GtkButton label={sending ? "Enviando…" : "Enviar"} cssClasses={["suggested-action"]} sensitive={!sending} onClicked={() => void send()} />
            </GtkBox>
            <GtkBox cssClasses={["linked"]}>
                <GtkToggleButton label="Body" active={tab === "body"} onToggled={(b) => b.getActive() && setTab("body")} />
                <GtkToggleButton label={`Headers ${req.headers.length}`} active={tab === "headers"} onToggled={(b) => b.getActive() && setTab("headers")} />
            </GtkBox>
            {tab === "body" ? (
                <GtkScrolledWindow vexpand cssClasses={["card"]}>
                    <GtkSourceView
                        monospace
                        showLineNumbers
                        tabWidth={2}
                        topMargin={6}
                        buffer={
                            <GtkSourceBuffer
                                text={bodyText}
                                language={lang(/json/.test(req.body.mime ?? "") ? "json" : "text")}
                                styleScheme={scheme()}
                                onChanged={(b) => {
                                    bodyRef.current = b.text;
                                }}
                            />
                        }
                    />
                </GtkScrolledWindow>
            ) : (
                <GtkScrolledWindow vexpand>
                    <GtkBox orientation={Gtk.Orientation.VERTICAL} spacing={4}>
                        {req.headers.map((h, i) => (
                            <GtkLabel key={i} xalign={0} selectable useMarkup label={`<b>${esc(h.name)}</b>: ${esc(h.value)}`} />
                        ))}
                    </GtkBox>
                </GtkScrolledWindow>
            )}
        </GtkBox>
    ) : (
        <GtkLabel label="Escolha um request" cssClasses={["dim-label"]} vexpand />
    );

    const responsePane = (
        <GtkBox orientation={Gtk.Orientation.VERTICAL} hexpand spacing={8} marginTop={8} marginStart={8} marginEnd={8} marginBottom={8}>
            <GtkBox spacing={10}>
                {sending && <GtkSpinner spinning />}
                {r && (
                    <GtkLabel
                        useMarkup
                        label={r.error ? `<span foreground="#e01b24" weight="bold">erro</span>` : `<span foreground="${ok ? "#2ec27e" : "#e01b24"}" weight="bold">${r.status} ${esc(r.statusText)}</span>`}
                    />
                )}
                {r && <GtkLabel label={`${Math.round(r.timing.totalMs)} ms`} cssClasses={["dim-label"]} />}
                {r && <GtkLabel label={fmtSize(r.size)} cssClasses={["dim-label"]} />}
            </GtkBox>
            <GtkScrolledWindow vexpand cssClasses={["card"]}>
                <GtkSourceView
                    ref={(v: GtkSource.View | null) => {
                        respView.current = v;
                    }}
                    editable={false}
                    monospace
                    showLineNumbers
                    tabWidth={2}
                    topMargin={6}
                    buffer={<GtkSourceBuffer language={lang("json")} styleScheme={scheme()} />}
                />
            </GtkScrolledWindow>
        </GtkBox>
    );

    return (
        <AdwApplicationWindow title="Zeno (GTK)" defaultWidth={1400} defaultHeight={843} onCloseRequest={quit}>
            <AdwToolbarView
                topBar={
                    <AdwHeaderBar
                        start={
                            <GtkBox spacing={6}>
                                <DropDown<string>
                                    items={wsItems}
                                    selectedId={ws?.id ?? null}
                                    onSelectionChanged={(id) => settled.current && id !== ws?.id && patchApp({ activeWorkspaceId: id, activeRequestId: undefined })}
                                    renderItem={({ item }) => <GtkLabel label={item} />}
                                />
                                <DropDown<string>
                                    items={envItems}
                                    selectedId={envId ?? ""}
                                    onSelectionChanged={(id) => settled.current && ws && (id || null) !== envId && patchApp({ activeEnv: { ...app.activeEnv, [ws.id]: id || null } })}
                                    renderItem={({ item }) => <GtkLabel label={item} />}
                                />
                            </GtkBox>
                        }
                    />
                }
            >
                <GtkPaned
                    position={270}
                    shrinkStartChild={false}
                    startChild={sidebar}
                    endChild={<GtkPaned position={560} startChild={requestPane} endChild={<GtkBox>{<GtkSeparator orientation={Gtk.Orientation.VERTICAL} />}{responsePane}</GtkBox>} />}
                />
            </AdwToolbarView>
        </AdwApplicationWindow>
    );
};

function findReq(nodes: TreeNode[], name: string): RequestDoc | undefined {
    for (const n of nodes) {
        if (n.kind === "request" && n.name === name) return n;
        if (n.kind === "folder") {
            const r = findReq(n.children, name);
            if (r) return r;
        }
    }
    return undefined;
}

export const App = () => (
    <GtkApplication>
        <MainWindow />
    </GtkApplication>
);

export default App;
