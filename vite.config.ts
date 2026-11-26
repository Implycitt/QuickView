import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import electron from "vite-plugin-electron/simple";

export default defineConfig({
    server: {
        watch: { ignored: [/\.md$/i] }
    },
    optimizeDeps: {
        include: ["pdfjs-dist"]
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
        rollupOptions: {
            input: "src/ui/index.html"
        }
    },
    plugins: [
        tailwindcss(),
        electron({
            main: {
                entry: "src/main.ts"
            },
            preload: {
                input: "src/preload.cts"
            },
            renderer: {}
        })
    ]
});
