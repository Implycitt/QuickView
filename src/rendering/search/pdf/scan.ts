import { PdfState, isPdfViewerBusy } from '../../pdf/state.js';
import type { PageMatch, SearchResult } from '../core/types.js';
import { ensureIndexed, pageIndexes } from './pageIndexStore.js';
import { sortResults, tokenMatch } from '../core/query.js';

const SCAN_CHUNK = 10;
const SCAN_RESULT_CAP = 40;
const PAGE_INDEX_TIMEOUT = 10000;
const BUSY_DELAY = 120;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
    });
    return Promise.race([promise.catch(() => null), timeout]).finally(() => clearTimeout(timer));
}

export async function scanPdf(
    tokens: string[],
    isCurrent: () => boolean,
    onUpdate: (results: SearchResult[], matches: Map<number, PageMatch>, done: number, total: number) => void,
    startPage = 1,
) {
    const doc = PdfState.currentPdfDoc;
    if (!doc) return;
    const total = doc.numPages;
    const results: SearchResult[] = [];
    const matches = new Map<number, PageMatch>();

    const counted = new Set<number>();
    const addMatch = (page: number, text: string) => {
        if (counted.has(page)) return;
        counted.add(page);
        const match = tokenMatch(text, tokens);
        if (!match) return;
        results.push({ page, score: match.score, start: match.start, end: match.end });
        matches.set(page, { start: match.start, end: match.end });
    };

    for (let page = 1; page <= total; page++) {
        const index = pageIndexes.get(page);
        if (index?.text) addMatch(page, index.text);
    }
    sortResults(results);
    if (!isCurrent() || PdfState.currentPdfDoc !== doc) return;
    onUpdate(results, matches, 0, total);


    const order: number[] = [];
    const first = Math.min(Math.max(1, startPage), total);
    for (let page = first; page <= total; page++) order.push(page);
    for (let page = 1; page < first; page++) order.push(page);

    let next = 0;
    let checked = 0;
    const run = async () => {
        while (next < order.length) {
            if (!isCurrent() || PdfState.currentPdfDoc !== doc) return;
            if (results.length >= SCAN_RESULT_CAP) return;
            const page = order[next++];
            if (!counted.has(page)) {
                const index = await withTimeout(ensureIndexed(page), PAGE_INDEX_TIMEOUT);
                if (index?.text && isCurrent()) addMatch(page, index.text);
            }
            checked++;
            if (checked % SCAN_CHUNK === 0) {
                sortResults(results);
                onUpdate(results, matches, checked, total);
                await new Promise<void>((resolve) => setTimeout(resolve, isPdfViewerBusy() ? BUSY_DELAY : 0));
            }
        }
    };
    await run();
    if (!isCurrent() || PdfState.currentPdfDoc !== doc) return;
    sortResults(results);
    onUpdate(results, matches, total, total);
}
