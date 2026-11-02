import type { PdfPageLayout } from '../layout.js';
import type { PdfDocumentLike } from '../types.js';

const MEASURE_CHUNK = 12;
const MEASURE_WINDOW_RADIUS = 14;
const PRIORITY_RADIUS = 24;
const MEASURE_IDLE_TIMEOUT = 220;
const MEASURE_BUSY_RETRY = 120;
const MEASURE_MAX_BUSY_WAIT = 5000;

interface PdfMeasurementDependencies {
    getDocument: () => PdfDocumentLike | null;
    layout: Pick<PdfPageLayout, 'isPageMeasured' | 'setPagePoints'>;
    getViewerVersion: () => number;
    scheduleThumbnails: () => void;
    getCurrentPage: () => number;
    isViewerBusy: () => boolean;
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function scheduleIdle(run: () => void) {
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(run, { timeout: MEASURE_IDLE_TIMEOUT });
        return;
    }
    setTimeout(run, 0);
}

export function createPdfMeasurement(deps: PdfMeasurementDependencies) {
    let measureChain: Promise<void> = Promise.resolve();

    function orderedWindow(center: number, from: number, to: number): number[] {
        const pages: number[] = [];
        for (let delta = 0; delta <= Math.max(center - from, to - center); delta++) {
            const ahead = center + delta;
            const behind = center - delta;
            if (delta === 0) {
                if (center >= from && center <= to) pages.push(center);
                continue;
            }
            if (ahead <= to) pages.push(ahead);
            if (behind >= from) pages.push(behind);
        }
        return pages;
    }

    async function measureChunk(pages: number[], version: number) {
        const doc = deps.getDocument();
        if (!doc || pages.length === 0) return;
        const targets = pages.filter((page) => !deps.layout.isPageMeasured(page));
        if (targets.length === 0) return;
        const handles = await Promise.all(targets.map((page) => doc.getPage(page).catch(() => null)));
        if (version !== deps.getViewerVersion() || deps.getDocument() !== doc) return;
        let changed = false;
        for (let index = 0; index < handles.length; index++) {
            const page = handles[index];
            const pageNumber = targets[index];
            if (!page || deps.layout.isPageMeasured(pageNumber)) continue;
            const viewport = page.getViewport({ scale: 1 });
            if (deps.layout.setPagePoints(pageNumber, { width: viewport.width, height: viewport.height }))
                changed = true;
        }
        if (changed) deps.scheduleThumbnails();
    }

    async function waitWhileBusy(version: number, budget: { remaining: number }) {
        while (budget.remaining > 0 && deps.isViewerBusy()) {
            await wait(MEASURE_BUSY_RETRY);
            budget.remaining -= MEASURE_BUSY_RETRY;
            if (version !== deps.getViewerVersion()) return false;
        }
        return version === deps.getViewerVersion();
    }

    async function measureWindow(pageNumber: number, radius = MEASURE_WINDOW_RADIUS): Promise<void> {
        const doc = deps.getDocument();
        if (!doc) return;
        const version = deps.getViewerVersion();
        const total = doc.numPages;
        const center = Math.min(total, Math.max(1, Math.round(pageNumber)));
        const window = orderedWindow(center, Math.max(1, center - radius), Math.min(total, center + radius));
        for (let start = 0; start < window.length; start += MEASURE_CHUNK) {
            if (version !== deps.getViewerVersion()) return;
            await measureChunk(window.slice(start, start + MEASURE_CHUNK), version);
        }
    }

    return { measureWindow };
}
