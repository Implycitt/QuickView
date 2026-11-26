import { jumpToPdfPage } from "../../pdf/state.js";
import type { SearchResult } from "../core/types.js";
import { markdownBlocks } from "../markdown/index.js";
import { pageIndexes } from "../pdf/pageIndexStore.js";

let pendingScroll: { page: number; start: number; end: number } | null = null;

export function clearPendingSearchScroll() {
    pendingScroll = null;
}

export function jumpToSearchResult(result: SearchResult, mode: "pdf" | "md") {
    if (mode === "md") {
        markdownBlocks[result.page]?.element.scrollIntoView({ block: "center" });
        return;
    }

    const container = document.getElementById(`page-container-${result.page}`);
    const index = pageIndexes.get(result.page);
    let y: number | null = null;
    if (container && index) y = textSpanY(container, index.spans, index.ranges, result.start, result.end);
    if (y === null) pendingScroll = { page: result.page, start: result.start, end: result.end };
    jumpToPdfPage(result.page, y, true);
}

function textSpanY(
    container: HTMLElement,
    spans: (HTMLElement | null)[],
    ranges: { start: number; end: number }[],
    start: number,
    end: number
): number | null {
    for (let index = 0; index < ranges.length; index++) {
        if (ranges[index].end <= start || ranges[index].start >= end) continue;
        const span = spans[index];
        if (!span) break;
        const spanRect = span.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        return spanRect.top - containerRect.top + span.offsetHeight / 2;
    }
    return null;
}

export function resolvePendingSearchScroll(pageNum: number, spans: (HTMLElement | null)[]) {
    if (!pendingScroll || pendingScroll.page !== pageNum) return;
    const { start, end } = pendingScroll;
    pendingScroll = null;
    const container = document.getElementById(`page-container-${pageNum}`);
    const index = pageIndexes.get(pageNum);
    if (!container || !index) return;
    const y = textSpanY(container, spans, index.ranges, start, end);
    if (y !== null) jumpToPdfPage(pageNum, y, true);
}
