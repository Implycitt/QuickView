import type { PageIndex, PageMatch } from "../core/types.js";

let activeMatches: Map<number, PageMatch[]> | null = null;

export function setActiveHighlights(matches: Map<number, PageMatch[]> | null) {
    activeMatches = matches;
}

function setSpanHighlight(span: HTMLElement, range: PageMatch, matches: PageMatch[]) {
    const key = matches.map(match => `${match.start}-${match.end}`).join(",");
    if (span.dataset.hl === key) return;

    const text = span.textContent ?? "";
    const nodes: Node[] = [];
    let cursor = 0;

    for (const match of matches) {
        const start = match.start - range.start;
        const end = match.end - range.start;
        if (start > cursor) nodes.push(document.createTextNode(text.slice(cursor, start)));
        const mark = document.createElement("span");
        mark.className = "pdf-hl";
        mark.textContent = text.slice(start, end);
        nodes.push(mark);
        cursor = end;
    }

    if (cursor < text.length) nodes.push(document.createTextNode(text.slice(cursor)));
    span.dataset.hl = key;
    span.replaceChildren(...nodes);
}

export function applyPdfHighlights(index: PageIndex, pageNum: number) {
    if (index.spans.length === 0) return;
    const matches = activeMatches?.get(pageNum) ?? [];
    let cursor = 0;

    for (let i = 0; i < index.ranges.length && i < index.spans.length; i++) {
        const spanRange = index.ranges[i];
        while (cursor < matches.length && matches[cursor].end <= spanRange.start) cursor++;
        const visible: PageMatch[] = [];

        for (let j = cursor; j < matches.length && matches[j].start < spanRange.end; j++) {
            const start = Math.max(spanRange.start, matches[j].start);
            const end = Math.min(spanRange.end, matches[j].end);
            if (end > start) visible.push({ start, end });
        }

        const span = index.spans[i];
        if (span) setSpanHighlight(span, spanRange, visible);
    }
}

export function applyMarkdownHighlights(
    blocks: readonly { element: HTMLElement }[],
    matches: Map<number, PageMatch[]> | null
) {
    for (let index = 0; index < blocks.length; index++) {
        blocks[index].element.classList.toggle("md-search-hl", matches?.has(index) ?? false);
    }
}
