import {
    getPdfFitWidth,
    refreshSidebarSync,
    renderAllMainPages,
    renderThumbnails,
    setSidebarFollowSuppressed,
    whenMainRenderIdle
} from "../../rendering/pdf/renderer.js";
import { PdfState } from "../../rendering/pdf/state.js";
import { DOM } from "../core/dom.js";

const CONTENT_REFIT_DELAY_MS = 300;
const CONTENT_WIDTH_TOLERANCE = 4;

interface ResizeDependencies {
    scheduleViewerStateSave: () => void;
}

export function installViewerResizeHandlers({ scheduleViewerStateSave }: ResizeDependencies) {
    let windowTimer: ReturnType<typeof setTimeout> | null = null;
    window.addEventListener("resize", () => {
        if (!PdfState.currentPdfDoc) return;
        if (windowTimer) clearTimeout(windowTimer);
        windowTimer = setTimeout(async () => {
            windowTimer = null;
            setSidebarFollowSuppressed(true);
            await renderAllMainPages();
            renderThumbnails();
            setTimeout(() => {
                setSidebarFollowSuppressed(false);
                refreshSidebarSync();
                scheduleViewerStateSave();
            }, 350);
        }, 150);
    });

    const dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprQuery.addEventListener("change", () => {
        if (!PdfState.currentPdfDoc) return;
        setSidebarFollowSuppressed(true);
        void renderAllMainPages().then(() => {
            renderThumbnails();
            setSidebarFollowSuppressed(false);
            refreshSidebarSync();
            scheduleViewerStateSave();
        });
    });

    let contentTimer: ReturnType<typeof setTimeout> | null = null;
    const refitToContentWidth = () => {
        if (!PdfState.currentPdfDoc || PdfState.zoomMode !== "auto") return;
        if (Math.abs(DOM.mainContentNode.clientWidth - getPdfFitWidth()) < CONTENT_WIDTH_TOLERANCE) return;
        if (contentTimer) clearTimeout(contentTimer);
        contentTimer = setTimeout(async () => {
            contentTimer = null;
            setSidebarFollowSuppressed(true);
            await renderAllMainPages();
            renderThumbnails();
            setSidebarFollowSuppressed(false);
            refreshSidebarSync();
            scheduleViewerStateSave();
        }, CONTENT_REFIT_DELAY_MS);
    };
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(refitToContentWidth).observe(DOM.mainContentNode);

    let sidebarTimer: ReturnType<typeof setTimeout> | null = null;
    window.addEventListener("qv:sidebar-resized", () => {
        if (!PdfState.currentPdfDoc) return;
        if (sidebarTimer) clearTimeout(sidebarTimer);
        sidebarTimer = setTimeout(() => {
            sidebarTimer = null;
            setSidebarFollowSuppressed(true);
            void whenMainRenderIdle().then(() => {
                refreshSidebarSync();
                renderThumbnails();
                setSidebarFollowSuppressed(false);
            });
        }, 250);
    });
}
