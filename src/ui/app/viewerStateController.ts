import { getPdfLocation, isSnapSuspended } from "../../rendering/pdf/renderer.js";
import { PdfState } from "../../rendering/pdf/state.js";
import { writeViewerState, StoredViewerState } from "../../viewer/state.js";
import { DOM, getSavedSidebarWidth, setSavedSidebarWidth, setSidebarTab, toggleSidebar } from "../core/dom.js";

export interface ActiveViewerDocument {
    id: string;
    type: "pdf" | "markdown" | "html";
    ready: boolean;
    state: StoredViewerState | null;
}

export function captureViewerState(active: ActiveViewerDocument): StoredViewerState | null {
    if (!active.ready) return null;
    const location = active.type === "pdf" ? getPdfLocation() : null;
    if (active.type === "pdf" && !location) return active.state;

    const state: StoredViewerState = {
        version: 1,
        documentType: active.type,
        zoomMode: active.type === "pdf" ? PdfState.zoomMode : "auto",
        isSnapMode: PdfState.isSnapMode,
        isSpreadMode: PdfState.isSpreadMode,
        snapSuspended: isSnapSuspended(),
        sidebarFollow: PdfState.sidebarFollow,
        sidebarOpen: !!DOM.sidebar && DOM.sidebar.style.width !== "0px",
        sidebarWidth: getSavedSidebarWidth(),
        sidebarTab: DOM.sidebarSections?.classList.contains("hidden") ? "previews" : "sections",
        sidebarScrollTop: DOM.sidebar?.scrollTop ?? 0,
        ...(location ? { location } : {}),
        ...(active.type === "html"
            ? {
                  markdownScrollTop:
                      DOM.mainContentNode?.querySelector<HTMLIFrameElement>(".qv-html-frame")?.contentWindow?.scrollY ??
                      DOM.mainContentNode?.scrollTop ??
                      0
              }
            : active.type === "markdown"
              ? { markdownScrollTop: DOM.mainContentNode?.scrollTop ?? 0 }
              : {})
    };
    writeViewerState(active.id, state);
    return state;
}

export function restoreCommonViewerSettings(state: StoredViewerState | null, restoreSidebarScroll = true) {
    if (!state) return;
    setSavedSidebarWidth(state.sidebarWidth);
    setSidebarTab(state.sidebarTab);
    const sidebarIsOpen = !!DOM.sidebar && DOM.sidebar.style.width !== "0px";
    if (!state.sidebarOpen && sidebarIsOpen) toggleSidebar("closed", false);
    else if (state.sidebarOpen && !sidebarIsOpen) toggleSidebar("open", false);
    if (restoreSidebarScroll && DOM.sidebar) DOM.sidebar.scrollTop = state.sidebarScrollTop;
}

export function restoreMarkdownViewerState(state: StoredViewerState) {
    restoreCommonViewerSettings(state);
    DOM.mainContentNode.scrollTop = state.markdownScrollTop ?? 0;
}

export function restoreHtmlViewerState(state: StoredViewerState) {
    restoreCommonViewerSettings(state);
    const frame = DOM.mainContentNode.querySelector<HTMLIFrameElement>(".qv-html-frame");
    if (!frame) return;
    const scrollTop = state.markdownScrollTop ?? 0;
    frame.dataset.restoreScrollTop = String(scrollTop);
    const restoreScroll = () => {
        frame.contentWindow?.scrollTo(0, scrollTop);
        frame.removeAttribute("data-restore-scroll-top");
    };
    if (frame.contentDocument?.readyState === "complete") restoreScroll();
    else frame.addEventListener("load", restoreScroll, { once: true });
}

export function attachViewerStateListeners(scheduleSave: () => void, capture: () => StoredViewerState | null) {
    DOM.mainContentNode?.addEventListener("scroll", scheduleSave, { capture: true, passive: true });
    DOM.sidebar?.addEventListener("scroll", scheduleSave, { passive: true });
    window.addEventListener("beforeunload", capture);
    window.addEventListener("pagehide", capture);
    window.addEventListener("resize", scheduleSave);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") capture();
    });
    for (const eventName of [
        "qv:html-scroll",
        "qv:sidebar-toggled",
        "qv:sidebar-tab-changed",
        "qv:sidebar-width-changed",
        "qv:sidebar-resized",
        "qv:pdf-layout-rendered",
        "qv:pdf-viewer-settings-changed"
    ]) {
        window.addEventListener(eventName, scheduleSave);
    }
    DOM.zoomLevelSpan?.addEventListener("change", scheduleSave);
    DOM.toggleScrollModeBtn?.addEventListener("click", scheduleSave);
    DOM.toggleSpreadModeBtn?.addEventListener("click", scheduleSave);
    DOM.sidebarFollowBtn?.addEventListener("click", scheduleSave);
}
