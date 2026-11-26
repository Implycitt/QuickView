import type { MainPageRenderer } from "./renderQueue.js";

import { DOM } from "../../../ui/core/dom.js";
import type { PdfLocation } from "../../../viewer/state.js";
import type { PdfPageLayout } from "../layout.js";
import type { createPdfNavigation } from "../navigation.js";
import type { createPdfOutline } from "../outline/controller.js";
import type { createThumbnailRenderer } from "../thumbnails/renderer.js";
import type { PdfDocumentLike } from "../types.js";

interface PdfViewportDependencies {
    layout: PdfPageLayout;
    navigation: ReturnType<typeof createPdfNavigation>;
    thumbnails: ReturnType<typeof createThumbnailRenderer>;
    outline: ReturnType<typeof createPdfOutline>;
    mainPages: MainPageRenderer;
    getDocument: () => PdfDocumentLike | null;
    getSavedPosition: () => PdfLocation | null;
    setSavedPosition: (location: PdfLocation | null) => void;
    getPendingRestore: () => PdfLocation | null;
    setPendingRestore: (location: PdfLocation | null) => void;
    getLastKnownPage: () => number;
}

export function createPdfViewport(deps: PdfViewportDependencies) {
    let scrollRafPending = false;
    let scrollSettleTimer: ReturnType<typeof setTimeout> | null = null;

    function captureScrollPos(): PdfLocation | null {
        const location = deps.navigation.captureLocation(deps.getSavedPosition());
        if (location) deps.setSavedPosition(location);
        return location;
    }

    function currentViewPosition(): { page: number; y: number } {
        const location = deps.navigation.captureLocation(deps.getSavedPosition());
        if (!location) return { page: deps.getLastKnownPage(), y: 0 };
        const scroll = deps.layout.getScrollContainer();
        if (!scroll) return { page: location.page, y: 0 };
        const middle = scroll.scrollTop + (scroll.clientHeight || 1) / 2;
        return { page: location.page, y: Math.max(0, middle - deps.layout.getPageTop(location.page)) };
    }

    function updatePageCounter() {
        const scroll = deps.layout.getScrollContainer();
        const counter = DOM.pageCounter;
        if (!scroll || !deps.getDocument() || !counter || document.activeElement === counter) return;
        const page = deps.navigation.captureLocation(deps.getSavedPosition())?.page ?? deps.getLastKnownPage();
        if (counter.value !== String(page)) {
            counter.value = String(page);
            counter.dataset.current = String(page);
        }
    }

    function renderVisibleWindow() {
        const scroll = deps.layout.getScrollContainer();
        if (!scroll || !deps.getDocument() || deps.layout.getPageCount() === 0) return;
        const position = captureScrollPos();
        const pendingRestore = deps.getPendingRestore();
        if (position && pendingRestore) {
            const tolerance = Math.max(4, scroll.clientHeight * 0.05);
            if (Math.abs(scroll.scrollTop - deps.navigation.scrollTopForLocation(pendingRestore)) > tolerance) {
                deps.setPendingRestore(null);
            }
        }
        if (position && !deps.getPendingRestore()) deps.setSavedPosition(position);
        updatePageCounter();
        deps.thumbnails.refresh();
        deps.outline.sync(currentViewPosition());

        const pageCount = deps.layout.getPageCount();
        const margins = deps.layout.getMountMargins();
        const visibleFirst = deps.layout.pageAtOffset(scroll.scrollTop);
        const visibleLast = deps.layout.pageAtOffset(scroll.scrollTop + (scroll.clientHeight || 1));
        const first = Math.max(1, visibleFirst - margins.behind);
        const last = Math.min(pageCount, visibleLast + margins.ahead);
        deps.layout.syncMountedPages(first, last);
        deps.mainPages.retainQueuedPages(first, last);

        const firstPaint = deps.mainPages.needsFirstPaint();
        const centerPage = deps.layout.pageAtOffset(scroll.scrollTop + (scroll.clientHeight || 1) / 2);
        for (let page = visibleFirst; page <= visibleLast; page++) {
            deps.mainPages.queuePage(page, { critical: firstPaint && page === centerPage });
        }
        for (let delta = 1; delta <= Math.max(margins.behind, margins.ahead); delta++) {
            const before = visibleFirst - delta;
            const after = visibleLast + delta;
            if (before >= first) deps.mainPages.queuePage(before);
            if (after <= last) deps.mainPages.queuePage(after);
        }
        deps.navigation.refreshSnapAnchor();
    }

    function scheduleMainWindowRender() {
        if (scrollRafPending) return;
        scrollRafPending = true;
        requestAnimationFrame(() => {
            scrollRafPending = false;
            renderVisibleWindow();
        });
    }

    function onMainScroll() {
        if (scrollRafPending) return;
        scrollRafPending = true;
        requestAnimationFrame(() => {
            scrollRafPending = false;
            renderVisibleWindow();
        });
        if (scrollSettleTimer) clearTimeout(scrollSettleTimer);
        scrollSettleTimer = setTimeout(() => {
            scrollSettleTimer = null;
            renderVisibleWindow();
            deps.navigation.alignToSpread();
        }, 200);
    }

    function refreshSidebarSync(scrollToActive = false) {
        if (!deps.getDocument()) return;
        if (scrollToActive) deps.outline.invalidateViewport();
        deps.outline.sync(currentViewPosition(), scrollToActive);
        deps.thumbnails.refresh(scrollToActive);
    }

    function isViewerBusy(): boolean {
        const activity = deps.mainPages.getActivity();
        return (
            scrollRafPending ||
            deps.thumbnails.isBusy() ||
            scrollSettleTimer !== null ||
            activity.activeCount > 0 ||
            activity.pendingCount > 0 ||
            activity.queueLength > 0
        );
    }

    function clearSettleTimer() {
        if (!scrollSettleTimer) return;
        clearTimeout(scrollSettleTimer);
        scrollSettleTimer = null;
    }

    return {
        captureScrollPos,
        clearSettleTimer,
        currentViewPosition,
        isViewerBusy,
        onMainScroll,
        refreshSidebarSync,
        scheduleMainWindowRender
    };
}

export type PdfViewport = ReturnType<typeof createPdfViewport>;
