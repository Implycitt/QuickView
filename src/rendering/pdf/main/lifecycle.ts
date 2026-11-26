import type { createPdfViewerServices, PdfViewerState } from "./factory.js";

import type { PdfLocation } from "../../../viewer/state.js";
import { resetSearchState } from "../../search/controller.js";
import { PdfState } from "../state.js";

export function createPdfLifecycle(state: PdfViewerState, services: ReturnType<typeof createPdfViewerServices>) {
    function resetAll(keepPosition = false) {
        const outgoing = PdfState.currentPdfDoc;
        const kept = keepPosition ? services.viewport.captureScrollPos() : null;
        services.navigation.reset();
        state.pendingRestoreLocation = null;
        if (!keepPosition) {
            PdfState.currentScale = 1;
            PdfState.isSnapMode = false;
            PdfState.isSpreadMode = false;
            PdfState.sidebarFollow = true;
        }
        resetSearchState();
        services.thumbnails.reset();
        services.outline.reset();
        services.layout.clearPageSizes();
        state.savedScrollPos = kept;
        state.lastKnownPage = kept?.page ?? 1;
        PdfState.currentPdfDoc = null;
        PdfState.zoomMode = "auto";
        services.session.resetViewer();
        if (outgoing) void outgoing.destroy().catch(() => {});
    }

    function restorePosition(location: PdfLocation | null) {
        if (!location) return;
        state.savedScrollPos = location;
        state.pendingRestoreLocation = location;
        state.lastKnownPage = Math.max(1, Math.min(services.layout.getPageCount() || location.page, location.page));
        services.navigation.restorePosition(location);
    }

    return { resetAll, restorePosition };
}
