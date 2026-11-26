import { PdfState } from "../../pdf/state.js";
import type { PdfTextContent } from "../../pdf/types.js";
import { isWhitespace } from "../core/query.js";
import type { PageIndex } from "../core/types.js";

export const pageIndexes = new Map<number, PageIndex>();
const inflightIndex = new Map<number, Promise<PageIndex | null>>();
export let indexVersion = 0;

export function clearPageIndexStore() {
    indexVersion++;
    pageIndexes.clear();
    inflightIndex.clear();
}

export function buildPageIndex(textContent: PdfTextContent): PageIndex {
    let text = "";
    const ranges: { start: number; end: number }[] = [];
    for (const item of textContent.items) {
        if (typeof item.str !== "string" || item.str.length === 0) {
            ranges.push({ start: text.length, end: text.length });
            continue;
        }
        const lower = item.str.toLowerCase();
        const previous = text.length > 0 ? text.charCodeAt(text.length - 1) : -1;
        const first = lower.charCodeAt(0);
        if (text.length > 0 && !isWhitespace(previous) && !isWhitespace(first)) text += " ";
        const start = text.length;
        text += lower;
        ranges.push({ start, end: text.length });
    }
    return { text, ranges, spans: [] };
}

export function setPageIndex(pageNum: number, index: PageIndex) {
    const existing = pageIndexes.get(pageNum);
    if (existing) {
        if (existing.text.length === 0) {
            existing.text = index.text;
            existing.ranges = index.ranges;
        }
        return;
    }
    pageIndexes.set(pageNum, index);
}

export async function ensureIndexed(pageNum: number): Promise<PageIndex | null> {
    const existing = pageIndexes.get(pageNum);
    if (existing) return existing;
    let pending = inflightIndex.get(pageNum);
    if (!pending) {
        pending = (async () => {
            const doc = PdfState.currentPdfDoc;
            if (!doc) return null;
            try {
                const page = await doc.getPage(pageNum);
                const textContent = await page.getTextContent();
                if (PdfState.currentPdfDoc !== doc) return null;
                const index = buildPageIndex(textContent);
                setPageIndex(pageNum, index);
                return index;
            } catch {
                return null;
            }
        })();
        inflightIndex.set(pageNum, pending);
        void pending.finally(() => {
            if (inflightIndex.get(pageNum) === pending) inflightIndex.delete(pageNum);
        });
    }
    return pending;
}
