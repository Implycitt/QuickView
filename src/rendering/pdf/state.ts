import type { ZoomMode } from '../../viewer/state.js';
import type { PdfDocumentLike } from './types.js';
import type { FileResponse } from '../../types/types.d.ts';

export const PdfState = {
    currentPdfDoc: null as PdfDocumentLike | null,
    currentSource: null as FileResponse | null,
    currentScale: 1.0,
    isSnapMode: false,
    isSpreadMode: false,
    zoomMode: 'auto' as ZoomMode,
    sidebarFollow: true,
};

let jumpToPageHandler: ((page: number, yCss?: number | null, center?: boolean) => void) | null = null;
let isViewerBusyHandler: (() => boolean) | null = null;
export function registerPdfNavigation(handlers: {
    jumpToPage: (page: number, yCss?: number | null, center?: boolean) => void;
    isViewerBusy: () => boolean;
}) {
    jumpToPageHandler = handlers.jumpToPage;
    isViewerBusyHandler = handlers.isViewerBusy;
}

export function jumpToPdfPage(page: number, yCss: number | null = null, center = false) {
    jumpToPageHandler?.(page, yCss, center);
}

export function isPdfViewerBusy(): boolean {
    return isViewerBusyHandler?.() ?? false;
}
