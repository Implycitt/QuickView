import { DOM } from '../../ui/core/dom.js';
import { loadPdfjs } from './pdfjs.js';
import type { PdfDocumentLike, PdfJsLoadingTask, PdfJsModule } from './types.js';
import { PdfState } from './state.js';
import {
    renderAllMainPages,
    renderThumbnails,
    renderOutline,
    resetPdfState,
    setCurrentFileName,
    setPdfZoom,
    applyPdfViewerSettings,
    restorePdfPosition,
} from './renderer.js';
import { startBackgroundIndex } from '../search/pdf/backgroundIndexer.js';
import type { FileResponse } from '../../types/types.d.ts';
import type { StoredViewerState } from '../../viewer/state.js';

let activeLoad: PdfJsLoadingTask | null = null;

function setPdfLayout() {
    DOM.mainContentNode.classList.remove('pt-8', 'px-8', 'pb-20', 'qv-html-viewer');
}

function createRangeTransport(pdfjsLib: PdfJsModule, filePath: string, length: number) {
    const transport = new pdfjsLib.PDFDataRangeTransport(length, null);
    transport.requestDataRange = (begin: number, end: number) => {
        window.electronAPI
            .readFileRange(filePath, begin, end)
            .then((chunk) => transport.onDataRange(begin, chunk))
            .catch((error: unknown) => console.error('PDF range read failed:', error));
    };
    return transport;
}

export async function renderPdfDocument(
    content: FileResponse,
    viewerState: StoredViewerState | null,
    reopening: boolean,
    isStale: () => boolean,
): Promise<boolean> {
    if (isStale()) return false;
    if (!content.data && content.length === undefined) {
        resetPdfState();
        DOM.mainContentNode.innerHTML =
            '<div class="p-8 text-red-500 flex justify-center">Failed to load PDF document.</div>';
        return false;
    }
    setPdfLayout();
    const superseded = activeLoad;
    activeLoad = null;
    if (superseded) void superseded.destroy().catch(() => {});
    resetPdfState(reopening);
    DOM.pdfTools?.classList.remove('hidden');
    DOM.sidebarTabs?.classList.remove('hidden');

    let loadingTask: PdfJsLoadingTask | null = null;
    let openedDoc: PdfDocumentLike | null = null;
    const abandonIfStale = () => {
        if (!isStale()) return false;
        const doc = openedDoc;
        openedDoc = null;
        if (doc && PdfState.currentPdfDoc === doc) {
            PdfState.currentPdfDoc = null;
            void doc.destroy().catch(() => {});
        }
        return true;
    };

    try {
        const pdfjsLib = await loadPdfjs();
        if (isStale()) return false;
        loadingTask = content.data
            ? pdfjsLib.getDocument({ data: new Uint8Array(content.data) })
            : pdfjsLib.getDocument({
                  range: createRangeTransport(pdfjsLib, content.path, content.length),
                  length: content.length,
                  rangeChunkSize: 64 * 1024,
                  disableAutoFetch: true,
                  disableStream: true,
              } as never);
        activeLoad = loadingTask;
        const doc = await loadingTask.promise;
        if (isStale()) {
            if (activeLoad === loadingTask) activeLoad = null;
            void loadingTask.destroy().catch(() => {});
            return false;
        }

        PdfState.currentPdfDoc = doc;
        openedDoc = doc;
        activeLoad = null;
        loadingTask = null;
        setCurrentFileName(content.name);

        const pdfState = viewerState?.documentType === 'pdf' ? viewerState : null;
        if (pdfState) {
            setPdfZoom(pdfState.location?.scale ?? 1, pdfState.zoomMode);
            applyPdfViewerSettings({
                isSnapMode: pdfState.isSnapMode,
                snapSuspended: pdfState.snapSuspended,
                sidebarFollow: pdfState.sidebarFollow,
                isSpreadMode: pdfState.isSpreadMode ?? false,
            });
        } else if (!reopening) {
            setPdfZoom(1, 'auto');
            applyPdfViewerSettings({
                isSnapMode: false,
                snapSuspended: false,
                sidebarFollow: true,
                isSpreadMode: false,
            });
        }

        await renderAllMainPages();
        if (abandonIfStale()) return false;
        if (pdfState?.location) restorePdfPosition(pdfState.location);
        openedDoc = null;
        void renderThumbnails().catch((error: unknown) => console.error('Error rendering PDF thumbnails:', error));
        void renderOutline().catch((error: unknown) => console.error('Error rendering PDF outline:', error));
        startBackgroundIndex();
        return true;
    } catch (error) {
        if (activeLoad === loadingTask) activeLoad = null;
        if (loadingTask) void loadingTask.destroy().catch(() => {});
        if (abandonIfStale()) return false;
        console.error('Error rendering PDF:', error);
        resetPdfState();
        DOM.mainContentNode.innerHTML =
            '<div class="p-8 text-red-500 flex justify-center">Failed to load PDF document.</div>';
        return false;
    }
}
