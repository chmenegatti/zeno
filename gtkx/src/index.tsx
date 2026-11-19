import { createRoot, quit } from "@gtkx/react";
import { App } from "./app.js";
import { runBench } from "./bench.js";

createRoot().render(<App />);

if (process.env.ZENO_BENCH) {
    runBench()
        .catch((e) => console.log("ERRO", e))
        .finally(() => quit());
}

// captura de tela: envia o request ativo depois de abrir
if (process.env.ZENO_DEMO_SEND) setTimeout(() => void import("./bench.js").then((b) => b.sendNow()), 1500);
