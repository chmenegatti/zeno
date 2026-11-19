import { defineConfig } from "@gtkx/config";

export default defineConfig({
    applicationId: "dev.zeno.gtkx",
    applicationIcon: "data/icons",
    // no Ubuntu/Debian o GIR do GLib mora no diretório da arquitetura
    girPath: ["/usr/share/gir-1.0", "/usr/lib/x86_64-linux-gnu/gir-1.0"],
    libraries: ["GtkSource-5"],
    deploy: {
        name: "Zeno GTK",
        summary: "Protótipo do Zeno com interface nativa GTK4/Adwaita",
        categories: ["Development"],
        developer: { name: "Cesar Menegatti" },
        license: "MIT",
    },
    future: {
        v2ByteArrays: true,
        v2ValueReturns: true,
        v2FinishResults: true,
        v2InoutReturns: true,
        v2ResourceImports: true,
        v2DefaultLibraries: true,
        v2TreeShaking: true,
    },
});
