import {
    attachViewerStateListeners as attachStateListeners,
    restoreCommonViewerSettings,
    restoreMarkdownViewerState,
    restoreHtmlViewerState,
    captureViewerState as captureState
} from "./viewerStateController.js";

import { documentIdentity } from "../../rendering/documents/identity.js";
import {
    applyPdfViewerSettings,
    isSnapSuspended,
    setPdfZoom,
    whenMainRenderIdle
} from "../../rendering/pdf/renderer.js";
import { PdfState } from "../../rendering/pdf/state.js";
import type { FileResponse } from "../../types/types.d.ts";
import type { DocumentType, StoredViewerState } from "../../viewer/state.js";
import { getLastDocumentPath, setLastDocumentPath, readViewerState } from "../../viewer/state.js";
import { DOM, setSidebarTab, toggleSidebar } from "../core/dom.js";

interface ActiveDocument {
    id: string;
    type: DocumentType;
    state: StoredViewerState | null;
    ready: boolean;
}

export function createDocumentController() {
    let activeDocument: ActiveDocument | null = null;
    let displayedDocumentId: string | null = null;
    let documentLoadToken = 0;
    let stateSaveTimer: ReturnType<typeof setTimeout> | null = null;

    function captureViewerState(): StoredViewerState | null {
        if (!activeDocument) return null;
        const state = captureState(activeDocument);
        if (state) activeDocument.state = state;
        return state;
    }

    function scheduleViewerStateSave() {
        if (!activeDocument?.ready) return;
        if (stateSaveTimer) clearTimeout(stateSaveTimer);
        stateSaveTimer = setTimeout(() => {
            stateSaveTimer = null;
            captureViewerState();
        }, 100);
    }

    function attachViewerStateListeners() {
        attachStateListeners(scheduleViewerStateSave, captureViewerState);
    }

    async function openDocument(content: FileResponse) {
        const lowerName = content.name.toLowerCase();
        const type: DocumentType = lowerName.endsWith(".pdf")
            ? "pdf"
            : lowerName.endsWith(".html") || lowerName.endsWith(".htm")
              ? "html"
              : "markdown";
        const incoming: ActiveDocument = {
            id: documentIdentity(content.path, content.name, type),
            type,
            state: null,
            ready: false
        };
        const sameDocument = activeDocument?.id === incoming.id;
        const reopening = displayedDocumentId === incoming.id;
        const token = ++documentLoadToken;
        if (sameDocument && incoming.type === "pdf" && activeDocument?.ready) await whenMainRenderIdle();
        if (token !== documentLoadToken) return;

        const outgoingState = activeDocument?.ready
            ? (captureViewerState() ?? activeDocument.state)
            : activeDocument?.state;
        if (stateSaveTimer) clearTimeout(stateSaveTimer);
        stateSaveTimer = null;
        setLastDocumentPath(content.path);
        const viewerState = sameDocument
            ? (outgoingState ?? activeDocument?.state ?? null)
            : readViewerState(incoming.id);
        activeDocument = { ...incoming, state: viewerState, ready: false };
        displayedDocumentId = null;

        if (incoming.type === "pdf" && viewerState?.documentType === "pdf") {
            restoreCommonViewerSettings(viewerState, false);
        } else if (incoming.type === "pdf" && !sameDocument) {
            PdfState.isSnapMode = false;
            PdfState.isSpreadMode = false;
            PdfState.sidebarFollow = true;
            applyPdfViewerSettings({
                isSnapMode: false,
                snapSuspended: false,
                sidebarFollow: true,
                isSpreadMode: false
            });
            setPdfZoom(1, "auto");
            toggleSidebar("open");
            setSidebarTab("previews");
            DOM.sidebar.scrollTop = 0;
        }

        const settingsAtLoadStart =
            incoming.type === "pdf"
                ? {
                      isSnapMode: PdfState.isSnapMode,
                      isSpreadMode: PdfState.isSpreadMode,
                      sidebarFollow: PdfState.sidebarFollow,
                      suspended: isSnapSuspended()
                  }
                : null;

        const isStale = () => token !== documentLoadToken;
        if (incoming.type === "pdf") {
            const [{ clearMdBreadcrumb }, { renderPdfDocument }] = await Promise.all([
                import("../../rendering/markdown/breadcrumb.js"),
                import("../../rendering/pdf/document.js")
            ]);
            if (isStale()) return;
            clearMdBreadcrumb();
            const rendered = await renderPdfDocument(content, viewerState, reopening, isStale);
            if (!rendered) return;
        } else if (incoming.type === "html") {
            const { renderHtmlDocument } = await import("../../rendering/html/document.js");
            if (isStale()) return;
            const rendered = renderHtmlDocument(content, reopening, isStale, async path => {
                try {
                    await openDocument(await window.electronAPI.readFile(path));
                } catch (error) {
                    console.warn("Could not open linked HTML document:", error);
                }
            });
            if (!rendered) return;
        } else {
            const { renderMarkdownDocument } = await import("../../rendering/markdown/document.js");
            if (isStale()) return;
            const rendered = await renderMarkdownDocument(content, viewerState, reopening, isStale);
            if (!rendered) return;
        }
        if (token !== documentLoadToken || !activeDocument) return;
        displayedDocumentId = incoming.id;

        if (incoming.type === "pdf" && viewerState?.documentType === "pdf") {
            restoreCommonViewerSettings(viewerState);
        } else if (incoming.type === "pdf") {
            const untouched =
                !!settingsAtLoadStart &&
                settingsAtLoadStart.isSnapMode === PdfState.isSnapMode &&
                settingsAtLoadStart.isSpreadMode === PdfState.isSpreadMode &&
                settingsAtLoadStart.sidebarFollow === PdfState.sidebarFollow &&
                settingsAtLoadStart.suspended === isSnapSuspended();
            if (untouched) {
                applyPdfViewerSettings({
                    isSnapMode: false,
                    snapSuspended: false,
                    sidebarFollow: true,
                    isSpreadMode: false
                });
            }
        } else if (viewerState?.documentType === incoming.type) {
            if (incoming.type === "html") restoreHtmlViewerState(viewerState);
            else restoreMarkdownViewerState(viewerState);
        } else if (!sameDocument) {
            toggleSidebar("closed");
            DOM.sidebar.scrollTop = 0;
        }

        activeDocument.ready = true;
        scheduleViewerStateSave();
    }

    return {
        attachViewerStateListeners,
        captureViewerState,
        getLastDocumentPath,
        openDocument,
        scheduleViewerStateSave,
        setLastDocumentPath
    };
}
