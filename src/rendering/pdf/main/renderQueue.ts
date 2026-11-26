import type { PdfPageLayout } from "../layout.js";
import { addPageLinkLayer } from "../links.js";
import type { PdfDocumentLike, PdfPageLike, PdfViewport } from "../types.js";

const MAX_CANVAS_PIXELS = 8_500_000;
const SEQUENTIAL_RENDER_THRESHOLD_MS = 900;
const PARALLEL_RENDER_THRESHOLD_MS = 120;

interface PendingRender {
    task: { cancel?: () => void } | null;
    canvas: HTMLCanvasElement | null;
}

interface MainPageRendererDependencies {
    getDocument: () => PdfDocumentLike | null;
    getScale: () => number;
    layout: Pick<PdfPageLayout, "getPageContainer" | "setPagePoints">;
    getOutputScale: () => number;
    renderConcurrency: number;
    renderTextLayer: (
        page: PdfPageLike,
        container: HTMLElement,
        viewport: PdfViewport,
        pageNumber: number
    ) => Promise<void>;
    clearPageSpans: (pageNumber: number) => void;
    resolveDestination: (destination: unknown) => Promise<{ page: number; y: number | null } | null>;
    isObsoleteRender: (error: unknown, doc: unknown) => boolean;
    onRenderSettled: () => void;
}

export function createMainPageRenderer(deps: MainPageRendererDependencies) {
    const renderedCanvases = new Map<number, HTMLCanvasElement>();
    const pendingRenders = new Map<number, PendingRender>();
    const pageHandles = new Map<number, PdfPageLike>();
    const criticalPages = new Set<number>();
    let activeCriticalPage: number | null = null;
    let renderQueue: number[] = [];
    let activeRenders = 0;
    let sequentialRenders = false;
    let fastRendersInARow = 0;

    function releasePage(pageNumber: number) {
        if (pendingRenders.has(pageNumber) || renderedCanvases.has(pageNumber)) return;
        const page = pageHandles.get(pageNumber);
        if (!page) return;
        pageHandles.delete(pageNumber);
        try {
            (page as PdfPageLike & { cleanup?: () => void }).cleanup?.();
        } catch {}
    }

    function onPageUnmounted(pageNumber: number) {
        criticalPages.delete(pageNumber);
        const entry = pendingRenders.get(pageNumber);
        if (entry) {
            try {
                entry.task?.cancel?.();
            } catch {}
            entry.canvas?.remove();
            pendingRenders.delete(pageNumber);
        }
        renderQueue = renderQueue.filter(queuedPage => queuedPage !== pageNumber);
        renderedCanvases.delete(pageNumber);
        deps.clearPageSpans(pageNumber);
        releasePage(pageNumber);
    }

    function queuePage(pageNumber: number, options: { critical?: boolean } = {}) {
        if (options.critical) criticalPages.add(pageNumber);
        if (renderedCanvases.has(pageNumber) || pendingRenders.has(pageNumber)) return;
        const container = deps.layout.getPageContainer(pageNumber);
        if (!container?.isConnected) return;
        pendingRenders.set(pageNumber, { task: null, canvas: null });
        renderQueue.push(pageNumber);
        pump();
    }

    function trackRenderCost(duration: number) {
        if (duration >= SEQUENTIAL_RENDER_THRESHOLD_MS) {
            sequentialRenders = true;
            fastRendersInARow = 0;
            return;
        }
        if (!sequentialRenders || duration > PARALLEL_RENDER_THRESHOLD_MS) {
            fastRendersInARow = 0;
            return;
        }
        fastRendersInARow++;
        if (fastRendersInARow >= 3) {
            sequentialRenders = false;
            fastRendersInARow = 0;
        }
    }

    function pendingCriticalPage(): number | null {
        for (const page of criticalPages) {
            if (pendingRenders.has(page)) return page;
        }
        return null;
    }

    function hasCriticalWork(): boolean {
        return activeCriticalPage !== null || pendingCriticalPage() !== null;
    }

    function pump() {
        while (renderQueue.length > 0) {
            const critical = pendingCriticalPage();
            if (activeCriticalPage !== null) {
                if (critical === null || critical !== activeCriticalPage) return;
            } else if (critical !== null && activeRenders > 0) {
                return;
            }
            if (critical !== null) {
                const index = renderQueue.indexOf(critical);
                if (index > 0) {
                    renderQueue.splice(index, 1);
                    renderQueue.unshift(critical);
                }
            }
            const capacity = critical !== null || sequentialRenders ? 1 : deps.renderConcurrency;
            if (activeRenders >= capacity) return;
            const page = renderQueue.shift()!;
            if (!pendingRenders.has(page)) {
                criticalPages.delete(page);
                continue;
            }
            if (renderedCanvases.has(page)) {
                pendingRenders.delete(page);
                criticalPages.delete(page);
                continue;
            }
            const entry = pendingRenders.get(page);
            if (!entry) continue;
            const isCritical = criticalPages.delete(page);
            if (isCritical) activeCriticalPage = page;
            activeRenders++;
            const startedAt = performance.now();
            void renderPage(page, entry).finally(() => {
                activeRenders = Math.max(0, activeRenders - 1);
                if (activeCriticalPage === page) activeCriticalPage = null;
                trackRenderCost(performance.now() - startedAt);
                if (pendingRenders.get(page) === entry) pendingRenders.delete(page);
                pump();
                deps.onRenderSettled();
            });
        }
    }

    async function renderPage(pageNumber: number, entry: PendingRender) {
        const container = deps.layout.getPageContainer(pageNumber);
        const doc = deps.getDocument();
        const isCurrent = () =>
            pendingRenders.get(pageNumber) === entry &&
            container?.isConnected === true &&
            deps.layout.getPageContainer(pageNumber) === container &&
            deps.getDocument() === doc;
        if (!container?.isConnected || !doc) return;
        let canvas: HTMLCanvasElement | null = null;
        try {
            const page = await doc.getPage(pageNumber);
            if (!isCurrent()) return;
            pageHandles.set(pageNumber, page);
            const viewport = page.getViewport({ scale: deps.getScale() });
            const scale = deps.getScale() || 1;
            deps.layout.setPagePoints(pageNumber, { width: viewport.width / scale, height: viewport.height / scale });
            canvas = document.createElement("canvas");
            const context = canvas.getContext("2d");
            if (!context) return;
            const outputScale = Math.min(
                deps.getOutputScale(),
                Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, viewport.width * viewport.height))
            );
            canvas.width = Math.max(1, Math.ceil(viewport.width * outputScale));
            canvas.height = Math.max(1, Math.ceil(viewport.height * outputScale));
            canvas.style.width = `${viewport.width}px`;
            canvas.style.height = `${viewport.height}px`;
            const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
            container.appendChild(canvas);
            const task = page.render({ canvasContext: context, transform, viewport });
            entry.canvas = canvas;
            entry.task = task;
            await task.promise;
            if (!isCurrent()) {
                canvas.remove();
                return;
            }
            renderedCanvases.set(pageNumber, canvas);
            await deps.renderTextLayer(page, container, viewport, pageNumber);
            if (!isCurrent()) return;
            await addPageLinkLayer(page, container, viewport, deps.resolveDestination);
            if (!isCurrent()) return;
        } catch (error) {
            canvas?.remove();
            if (pendingRenders.get(pageNumber) === entry && !deps.isObsoleteRender(error, doc)) {
                console.error(`Error rendering page ${pageNumber}:`, error);
            }
        }
    }

    function cancel() {
        for (const { task } of pendingRenders.values()) {
            try {
                task?.cancel?.();
            } catch {}
        }
        pendingRenders.clear();
        criticalPages.clear();
        activeCriticalPage = null;
        renderQueue = [];
    }

    function clear() {
        renderedCanvases.clear();
        criticalPages.clear();
        activeCriticalPage = null;
        pageHandles.clear();
    }

    function resetRenderCost() {
        sequentialRenders = false;
        fastRendersInARow = 0;
    }

    function retainQueuedPages(first: number, last: number) {
        renderQueue = renderQueue.filter(pageNumber => pageNumber >= first && pageNumber <= last);
    }

    return {
        cancel,
        clear,
        needsFirstPaint: () => renderedCanvases.size === 0 && activeRenders === 0,
        getActivity: () => ({
            queueLength: renderQueue.length,
            pendingCount: pendingRenders.size,
            activeCount: activeRenders,
            critical: hasCriticalWork(),
            firstPaintPending: renderedCanvases.size === 0 && activeRenders === 0
        }),
        onPageUnmounted,
        pump,
        queuePage,
        releasePage,
        resetRenderCost,
        retainQueuedPages
    };
}

export type MainPageRenderer = ReturnType<typeof createMainPageRenderer>;
