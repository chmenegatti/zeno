// Roteiro de medição (ZENO_BENCH=1): o mesmo do Electron e do Wails, dirigido pelo estado do React.
// "Pronto" = React aplicou a mudança nos widgets e o loop do GTK rodou uma volta (setImmediate).

type Controls = {
    setFilter: (q: string) => void;
    select: (name: string) => void;
    send: () => Promise<void>;
    sending: boolean;
    lastStatus?: number | undefined;
};

let current: Controls | null = null;
let waiters: (() => void)[] = [];

export function registerBench(c: Controls): void {
    current = c;
    const w = waiters;
    waiters = [];
    // depois do commit (widgets já atualizados)
    setImmediate(() => w.forEach((f) => f()));
}

const committed = (): Promise<void> => new Promise((r) => waiters.push(r));
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const mark = (name: string, v = ""): void => console.log(`[renderer] MARK ${name} ${Date.now()} ${v}`);

export async function runBench(): Promise<void> {
    while (!current) await wait(5);
    await new Promise((r) => setImmediate(r));
    mark("ui", String(Math.round(performance.now())));
    await wait(7000);
    mark("idle");
    for (const q of ["item 7", "recurso 2 item", "x"]) {
        const t = performance.now();
        const done = committed();
        current.setFilter(q);
        await done;
        mark("filtro", `${(performance.now() - t).toFixed(1)}ms ${q}`);
        await wait(300);
    }
    current.setFilter("");
    await wait(500);
    const send = async (name: string): Promise<number> => {
        current!.select(name);
        await wait(400);
        const t = performance.now();
        await current!.send();
        // espera o commit da resposta
        await committed();
        return performance.now() - t;
    };
    const ds: number[] = [];
    for (let i = 0; i < 20; i++) ds.push(await send("Perf small"));
    ds.sort((a, b) => a - b);
    mark("small", `mediana ${ds[10]!.toFixed(0)}ms min ${ds[0]!.toFixed(0)} max ${ds[19]!.toFixed(0)}`);
    await wait(5000);
    mark("apos20");
    mark("json1", `${(await send("Perf json1")).toFixed(0)}ms`);
    await wait(5000);
    mark("json1mem");
    mark("json5", `${(await send("Perf json5")).toFixed(0)}ms`);
    await wait(5000);
    mark("json5mem");
    mark("text50", `${(await send("Perf text50")).toFixed(0)}ms`);
    await wait(6000);
    mark("text50mem");
    current.select("Perf small");
    await wait(8000);
    mark("voltou");
}

export const sendNow = (): Promise<void> | undefined => current?.send();
