import { ensureIndexed, indexVersion, pageIndexes } from "./pageIndexStore.js";

import { PdfState, isPdfViewerBusy } from "../../pdf/state.js";

const INDEX_BATCH = 4;
const INDEX_IDLE_TIMEOUT = 400;
const INDEX_BUSY_RETRY = 120;

export function startBackgroundIndex() {
    const doc = PdfState.currentPdfDoc;
    if (!doc) return;
    const version = indexVersion;
    const total = doc.numPages;
    let page = 1;

    const schedule = (fn: () => void, delay: number) => {
        if (delay > 0) setTimeout(fn, delay);
        else if (typeof requestIdleCallback === "function") {
            requestIdleCallback(fn, { timeout: INDEX_IDLE_TIMEOUT });
        } else setTimeout(fn, 0);
    };
    const tick = () => {
        if (indexVersion !== version || PdfState.currentPdfDoc !== doc || page > total) return;
        if (isPdfViewerBusy()) {
            schedule(tick, INDEX_BUSY_RETRY);
            return;
        }
        const end = Math.min(page + INDEX_BATCH, total + 1);
        for (let current = page; current < end; current++) {
            if (!pageIndexes.has(current)) void ensureIndexed(current);
        }
        page = end;
        schedule(tick, 0);
    };
    schedule(tick, 0);
}
