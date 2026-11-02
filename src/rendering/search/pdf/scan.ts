import { PdfState, isPdfViewerBusy } from '../../pdf/state.js';
import { loadPdfjs } from '../../pdf/pdfjs.js';
import { openPdfDocumentSource } from '../../pdf/document.js';
import type { PdfDocumentLike, PdfPageLike } from '../../pdf/types.js';
import type { PageMatch, PageIndex, SearchResult } from '../core/types.js';
import { buildPageIndex, ensureIndexed, pageIndexes, setPageIndex } from './pageIndexStore.js';
import { sortResults, tokenMatch } from '../core/query.js';

const SCAN_CHUNK = 10;
// Each extra pdf.js document has its own worker, so pages index in parallel across them.
const SCAN_WORKERS = 4;
// Stop once this many matching pages are found; the user can refine the query instead of waiting on the whole book.
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

let workerPool: { owner: PdfDocumentLike; docs: PdfDocumentLike[] } | null = null;

async function getWorkerDocs(owner: PdfDocumentLike): Promise<PdfDocumentLike[] | null> {
    if (workerPool?.owner === owner) return workerPool.docs;
    const source = PdfState.currentSource;
    if (!source) return null;
    const previous = workerPool;
    workerPool = null;
    if (previous) for (const doc of previous.docs) void doc.destroy().catch(() => {});
    const pdfjsLib = await loadPdfjs();
    const docs = await Promise.all(
        Array.from({ length: SCAN_WORKERS }, () => openPdfDocumentSource(pdfjsLib, source).promise),
    );
    if (PdfState.currentPdfDoc !== owner) {
        for (const doc of docs) void doc.destroy().catch(() => {});
        return null;
    }
    workerPool = { owner, docs };
    return docs;
}

async function indexWithDoc(doc: PdfDocumentLike, pageNum: number): Promise<PageIndex | null> {
    const existing = pageIndexes.get(pageNum);
    if (existing) return existing;
    const page: PdfPageLike = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const index = buildPageIndex(textContent);
    setPageIndex(pageNum, index);
    return index;
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

    // Each page is counted once, even if it was indexed before the scan started.
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

    const docs = await getWorkerDocs(doc);
    if (!isCurrent() || PdfState.currentPdfDoc !== doc) return;

    // Pages are visited starting at the reader's page and wrapping around, so nearby matches show first.
    const order: number[] = [];
    const first = Math.min(Math.max(1, startPage), total);
    for (let page = first; page <= total; page++) order.push(page);
    for (let page = 1; page < first; page++) order.push(page);

    let next = 0;
    let checked = 0;
    const workers = (docs ?? [null]).map(async (workerDoc) => {
        while (next < order.length) {
            if (!isCurrent() || PdfState.currentPdfDoc !== doc) return;
            if (results.length >= SCAN_RESULT_CAP) return;
            const page = order[next++];
            if (!counted.has(page)) {
                const index = await withTimeout(
                    workerDoc ? indexWithDoc(workerDoc, page) : ensureIndexed(page),
                    PAGE_INDEX_TIMEOUT,
                );
                if (index?.text && isCurrent()) addMatch(page, index.text);
            }
            checked++;
            if (checked % SCAN_CHUNK === 0) {
                sortResults(results);
                onUpdate(results, matches, checked, total);
                await new Promise<void>((resolve) => setTimeout(resolve, isPdfViewerBusy() ? BUSY_DELAY : 0));
            }
        }
    });
    await Promise.all(workers);
    if (!isCurrent() || PdfState.currentPdfDoc !== doc) return;
    sortResults(results);
    onUpdate(results, matches, total, total);
}
