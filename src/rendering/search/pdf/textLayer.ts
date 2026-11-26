import { buildPageIndex, pageIndexes, setPageIndex } from "./pageIndexStore.js";

import { loadPdfjs } from "../../pdf/pdfjs.js";
import { PdfState } from "../../pdf/state.js";
import type { PdfPageLike, PdfViewport } from "../../pdf/types.js";
import { applyPdfHighlights } from "../ui/highlights.js";
import { resolvePendingSearchScroll } from "../ui/navigation.js";

export function setPageSpans(pageNum: number, spans: (HTMLElement | null)[]) {
    const index = pageIndexes.get(pageNum);
    if (index) {
        index.spans = spans;
        applyPdfHighlights(index, pageNum);
    }
    resolvePendingSearchScroll(pageNum, spans);
}

export function clearPageSpans(pageNum: number) {
    const index = pageIndexes.get(pageNum);
    if (index) index.spans = [];
}

export async function renderPageTextLayer(
    page: PdfPageLike,
    container: HTMLElement,
    viewport: PdfViewport,
    pageNum: number
): Promise<void> {
    const layer = document.createElement("div");
    layer.className = "text-layer";
    layer.style.setProperty("--scale-factor", String(viewport.scale || PdfState.currentScale || 1));
    try {
        const pdfjsLib = await loadPdfjs();
        const textContent = await page.getTextContent();
        if (!container.isConnected) return;
        const index = buildPageIndex(textContent);
        if (!container.isConnected) return;
        setPageIndex(pageNum, index);
        if (index.text.length === 0) return;
        container.appendChild(layer);
        const textLayer = new pdfjsLib.TextLayer({ textContentSource: textContent, container: layer, viewport });
        await textLayer.render();
        if (!layer.isConnected) {
            layer.remove();
            return;
        }
        setPageSpans(
            pageNum,
            textLayer.textDivs.map((div: HTMLElement) => (div?.isConnected ? div : null))
        );
    } catch {
        layer.remove();
    }
}
