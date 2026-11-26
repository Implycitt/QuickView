import { createThumbnailLayout } from "./layout.js";
import type { ThumbnailDependencies } from "./types.js";

import { DOM } from "../../../ui/core/dom.js";
import type { PdfDocumentLike } from "../types.js";

const DEFAULT_EVICT_RADIUS = 16;
const LARGE_DOCUMENT_PAGE_COUNT = 700;
const LARGE_DOCUMENT_EVICT_RADIUS = 8;
const MAX_THUMBNAIL_OUTPUT_SCALE = 1.25;
const THUMBNAIL_RENDER_CONCURRENCY = 1;
const THUMB_INSET = 16;

interface ThumbnailRendererDependencies extends ThumbnailDependencies {
    getDocument: () => (PdfDocumentLike & { numPages: number }) | null;
    getPagePointSize: (page: number) => { width: number; height: number };
    getOutputScale: () => number;
    getSidebarTargetWidth: () => number;
    renderConcurrency: number;
    getSidebarFollow: () => boolean;
    isFollowSuppressed: () => boolean;
    getCurrentPage: () => number;
    jumpToPage: (page: number) => void;
    getMainRenderActivity: () => {
        queueLength: number;
        pendingCount: number;
        activeCount: number;
        critical: boolean;
        firstPaintPending: boolean;
    };
    notifyMainQueue: () => void;
    releasePage: (page: number) => void;
    isObsoleteRender: (error: unknown, document: unknown) => boolean;
}

type RenderTask = { promise: Promise<void>; cancel?: () => void };

export function createThumbnailRenderer(deps: ThumbnailRendererDependencies) {
    const layout = createThumbnailLayout(deps);
    const rendered = new Map<number, HTMLCanvasElement>();
    const pending = new Map<number, { task: RenderTask | null }>();
    let queue: number[] = [];
    let activeRenders = 0;
    let scrollRafPending = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let activePage = 0;
    let activeThumb: HTMLCanvasElement | null = null;
    let previousDocument: PdfDocumentLike | null = null;

    function evictionRadius(): number {
        const total = deps.getDocument()?.numPages ?? 0;
        return total > LARGE_DOCUMENT_PAGE_COUNT ? LARGE_DOCUMENT_EVICT_RADIUS : DEFAULT_EVICT_RADIUS;
    }

    function paneVisible(): boolean {
        return (
            !!DOM.sidebarPreviews &&
            !DOM.sidebarPreviews.classList.contains("hidden") &&
            !!DOM.sidebar &&
            DOM.sidebar.style.width !== "0px"
        );
    }

    function paneOffsetInSidebar(): number {
        const sidebar = document.getElementById("sidebar");
        const pane = DOM.sidebarPreviews;
        if (!sidebar || !pane) return 0;
        return pane.getBoundingClientRect().top - sidebar.getBoundingClientRect().top + sidebar.scrollTop;
    }

    function indexAt(y: number): number {
        const tops = layout.tops;
        if (tops.length === 0) return 0;
        let low = 0;
        let high = tops.length - 1;
        while (low <= high) {
            const middle = (low + high) >> 1;
            if (tops[middle] <= y) low = middle + 1;
            else high = middle - 1;
        }
        return Math.max(0, high);
    }

    function captureSidebarAnchor(): { page: number; fraction: number } | null {
        const sidebar = document.getElementById("sidebar");
        const tops = layout.tops;
        if (!sidebar || tops.length === 0) return null;
        const center = sidebar.scrollTop + sidebar.clientHeight / 2 - paneOffsetInSidebar();
        const index = indexAt(Math.max(0, center));
        const itemHeight = layout.height(index + 1) + 16;
        const fraction = itemHeight > 0 ? Math.max(0, Math.min(1, (center - tops[index]) / itemHeight)) : 0;
        return { page: index + 1, fraction };
    }

    function restoreSidebarAnchor(anchor: { page: number; fraction: number } | null): number {
        const sidebar = document.getElementById("sidebar");
        const tops = layout.tops;
        if (!anchor || !sidebar) return 0;
        const target =
            tops[anchor.page - 1] +
            anchor.fraction * (layout.height(anchor.page) + 16) -
            sidebar.clientHeight / 2 +
            paneOffsetInSidebar();
        return Math.max(0, Math.min(Math.max(0, sidebar.scrollHeight - sidebar.clientHeight), target));
    }

    function scrollThumbIntoView(thumb: HTMLElement, center = false) {
        const sidebar = DOM.sidebar;
        if (!sidebar || !paneVisible()) return;
        const sidebarRect = sidebar.getBoundingClientRect();
        const thumbRect = thumb.getBoundingClientRect();
        const stickyTop = DOM.sidebarTabs?.offsetHeight ?? 0;
        const viewportTop = sidebarRect.top + stickyTop;
        const viewportHeight = Math.max(0, sidebar.clientHeight - stickyTop);
        if (!center && thumbRect.top >= viewportTop && thumbRect.bottom <= sidebarRect.top + sidebar.clientHeight) {
            return;
        }
        const target = Math.max(
            0,
            Math.min(
                sidebar.scrollHeight - sidebar.clientHeight,
                sidebar.scrollTop + thumbRect.top - viewportTop - (viewportHeight - thumbRect.height) / 2
            )
        );
        const distance = Math.abs(sidebar.scrollTop - target);
        if (distance < 1) return;
        sidebar.scrollTop = target;
    }

    function shouldFollow(): boolean {
        return !deps.isFollowSuppressed() && deps.getSidebarFollow();
    }

    function syncActiveThumb(center = false, forceFollow = false) {
        if (!DOM.sidebarPreviews || !deps.getDocument()) return;
        const page = deps.getCurrentPage();
        const changed = page !== activePage;
        activePage = page;
        if (!paneVisible()) return;
        if (!center && !changed && activeThumb?.isConnected) return;

        activeThumb?.classList.remove("thumb-active");
        activeThumb = layout.ensureMounted(page, () => deps.jumpToPage(page));
        activeThumb?.classList.add("thumb-active");
        if ((changed || center) && (forceFollow || shouldFollow()) && activeThumb) {
            scrollThumbIntoView(activeThumb, true);
        }
    }

    function queueRender(page: number, pump = true) {
        if (rendered.has(page) || pending.has(page)) return;
        pending.set(page, { task: null });
        queue.push(page);
        if (pump) pumpQueue();
    }

    function pumpQueue() {
        while (queue.length > 0) {
            const mainActivity = deps.getMainRenderActivity();
            if (mainActivity.critical || mainActivity.activeCount > 0 || mainActivity.pendingCount > 0) return;
            if (mainActivity.firstPaintPending && mainActivity.queueLength > 0) return;
            const free = deps.renderConcurrency - mainActivity.activeCount - activeRenders;
            if (free <= 0 || activeRenders >= THUMBNAIL_RENDER_CONCURRENCY) return;
            const page = queue.shift()!;
            if (!pending.has(page)) continue;
            if (rendered.has(page)) {
                pending.delete(page);
                continue;
            }
            const entry = pending.get(page);
            if (!entry) continue;
            activeRenders++;
            void renderThumb(page, entry).finally(() => {
                activeRenders = Math.max(0, activeRenders - 1);
                if (pending.get(page) === entry) pending.delete(page);
                deps.notifyMainQueue();
                pumpQueue();
            });
        }
    }

    async function renderThumb(pageNumber: number, entry: { task: RenderTask | null }) {
        const thumbnail =
            DOM.sidebarPreviews?.querySelector<HTMLCanvasElement>(`[data-page-num="${pageNumber}"]`) ?? null;
        const document = deps.getDocument();
        const isCurrent = () =>
            pending.get(pageNumber) === entry &&
            thumbnail?.isConnected === true &&
            DOM.sidebarPreviews?.querySelector(`[data-page-num="${pageNumber}"]`) === thumbnail &&
            deps.getDocument() === document;
        if (!thumbnail || !thumbnail.isConnected || !document) return;
        if (thumbnail.dataset.rendering === "1") {
            schedule();
            return;
        }
        try {
            thumbnail.dataset.rendering = "1";
            const page = await document.getPage(pageNumber);
            if (!isCurrent()) return;
            const baseViewport = page.getViewport({ scale: 1 });
            const targetWidth = Math.max(120, deps.getSidebarTargetWidth() - THUMB_INSET * 2);
            const outputScale = Math.min(deps.getOutputScale(), MAX_THUMBNAIL_OUTPUT_SCALE);
            const scale = (targetWidth / baseViewport.width) * outputScale;
            const viewport = page.getViewport({ scale });
            thumbnail.width = Math.max(1, Math.floor(viewport.width));
            thumbnail.height = Math.max(1, Math.floor(viewport.height));
            const cssHeight = Math.max(1, Math.floor(viewport.height / outputScale));
            if (layout.updateAspect(pageNumber, baseViewport.height / baseViewport.width)) layout.invalidate();
            if (thumbnail.style.height !== `${cssHeight}px`) {
                thumbnail.style.height = `${cssHeight}px`;
                schedule();
            }
            const context = thumbnail.getContext("2d");
            if (!context) return;
            const task = page.render({ canvasContext: context, viewport }) as RenderTask;
            entry.task = task;
            await task.promise;
            if (!isCurrent()) return;
            rendered.set(pageNumber, thumbnail);
            thumbnail.dataset.rendered = "1";
        } catch (error) {
            if (pending.get(pageNumber) === entry && !deps.isObsoleteRender(error, document)) {
                console.error(`Error rendering thumbnail ${pageNumber}:`, error);
            }
        } finally {
            delete thumbnail.dataset.rendering;
        }
    }

    function evict(first: number, last: number) {
        const radius = evictionRadius();
        const elements = layout.elements;
        for (let index = elements.length - 1; index >= 0; index--) {
            const canvas = elements[index];
            const page = parseInt(canvas.dataset.pageNum || "0", 10);
            if (page - 1 >= first - radius && page - 1 <= last + radius) continue;
            canvas.remove();
            elements.splice(index, 1);
            rendered.delete(page);
            if (canvas === activeThumb) activeThumb = null;
            deps.releasePage(page);
        }
        for (const [page, entry] of pending) {
            if (page - 1 < first - radius - 5 || page - 1 > last + radius + 5) {
                try {
                    entry.task?.cancel?.();
                } catch {}
                pending.delete(page);
            }
        }
    }

    function renderVisible() {
        const sidebar = globalThis.document.getElementById("sidebar");
        const pdfDocument = deps.getDocument();
        if (!sidebar || !DOM.sidebarPreviews || !pdfDocument || !paneVisible()) return;
        const anchor = captureSidebarAnchor();
        layout.rebuild();
        if (anchor) sidebar.scrollTop = restoreSidebarAnchor(anchor);
        if (pdfDocument.numPages === 0) return;
        const paneScroll = Math.max(0, sidebar.scrollTop - paneOffsetInSidebar());
        const visibleFirst = Math.min(pdfDocument.numPages - 1, indexAt(paneScroll));
        const visibleLast = Math.min(pdfDocument.numPages - 1, indexAt(paneScroll + sidebar.clientHeight));
        const first = Math.max(0, visibleFirst - 2);
        const last = Math.min(pdfDocument.numPages - 1, visibleLast + 5);
        for (let index = first; index <= last; index++) {
            layout.ensureMounted(index + 1, () => deps.jumpToPage(index + 1));
        }
        evict(first, last);
        const radius = evictionRadius();
        queue = queue.filter(page => page - 1 >= first - radius - 5 && page - 1 <= last + radius + 5);

        const visiblePages: number[] = [];
        for (let index = visibleFirst; index <= visibleLast; index++) visiblePages.push(index + 1);
        const nearbyPages: number[] = [];
        for (let index = first; index <= last; index++) {
            if (index < visibleFirst || index > visibleLast) nearbyPages.push(index + 1);
        }
        for (const page of [...visiblePages, ...nearbyPages]) queueRender(page, false);
        const priority = new Set([...visiblePages, ...nearbyPages]);
        queue = [
            ...visiblePages.filter(page => pending.has(page)),
            ...nearbyPages.filter(page => pending.has(page)),
            ...queue.filter(page => !priority.has(page))
        ];
        pumpQueue();
        syncActiveThumb();
    }

    function schedule() {
        if (scrollRafPending) return;
        scrollRafPending = true;
        requestAnimationFrame(() => {
            scrollRafPending = false;
            renderVisible();
        });
    }

    function onSidebarScroll() {
        if (scrollRafPending) return;
        scrollRafPending = true;
        requestAnimationFrame(() => {
            scrollRafPending = false;
            renderVisible();
        });
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
            settleTimer = null;
            renderVisible();
        }, 200);
    }

    function cancel() {
        for (const { task } of pending.values()) {
            try {
                task?.cancel?.();
            } catch {}
        }
        pending.clear();
        queue = [];
        rendered.clear();
    }

    async function render() {
        const pdfDocument = deps.getDocument();
        const pane = DOM.sidebarPreviews;
        if (!pdfDocument || !pane) return;
        const sidebar = globalThis.document.getElementById("sidebar");
        if (!sidebar) return;
        const anchor = paneVisible() ? captureSidebarAnchor() : null;
        cancel();
        layout.reset();
        pane.innerHTML = "";
        pane.style.position = "relative";
        sidebar.onscroll = null;
        if (settleTimer) {
            clearTimeout(settleTimer);
            settleTimer = null;
        }
        layout.rebuild();
        if (anchor) sidebar.scrollTop = restoreSidebarAnchor(anchor);
        sidebar.removeEventListener("scroll", onSidebarScroll);
        sidebar.addEventListener("scroll", onSidebarScroll, { passive: true });
        schedule();

        const freshDocument = pdfDocument !== previousDocument;
        previousDocument = pdfDocument;
        activePage = freshDocument ? 0 : activePage;
        activeThumb = null;
        syncActiveThumb(true);
    }

    function reset() {
        cancel();
        layout.reset();
        activePage = 0;
        activeThumb = null;
        previousDocument = null;
        if (settleTimer) {
            clearTimeout(settleTimer);
            settleTimer = null;
        }
        const sidebar = globalThis.document.getElementById("sidebar");
        sidebar?.removeEventListener("scroll", onSidebarScroll);
    }

    function refresh(scrollToActive = false) {
        syncActiveThumb(scrollToActive, scrollToActive);
    }

    function isBusy(): boolean {
        return scrollRafPending || settleTimer !== null || activeRenders > 0 || pending.size > 0 || queue.length > 0;
    }

    function getActivity() {
        return { activeRenders, pendingCount: pending.size, queueLength: queue.length };
    }

    return { cancel, getActivity, isBusy, refresh, render, reset, schedule };
}
