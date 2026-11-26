import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import type { PdfJsModule } from "./types.js";

let loading: Promise<PdfJsModule> | null = null;

export function loadPdfjs(): Promise<PdfJsModule> {
    if (!loading) {
        loading = import("pdfjs-dist")
            .then(module => {
                const pdfjsLib = module as unknown as PdfJsModule;
                pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
                return pdfjsLib;
            })
            .catch((error: unknown) => {
                loading = null;
                throw error;
            });
    }
    return loading;
}
