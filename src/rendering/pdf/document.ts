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

const RANGE_PIECE_BYTES = 4 * 1024 * 1024;
const RANGE_RETRIES = 3;

// Reads [begin, end) in pieces the main process accepts, retrying transient failures.
// A failed read that is never answered leaves pdf.js waiting forever, so retry instead.
async function readRangeWithRetry(filePath: string, begin: number, end: number): Promise<Uint8Array> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await window.electronAPI.readFileRange(filePath, begin, end);
        } catch (error) {
            if (attempt >= RANGE_RETRIES) throw error;
            await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
        }
    }
}

function createRangeTransport(pdfjsLib: PdfJsModule, filePath: string, length: number) {
    const transport = new pdfjsLib.PDFDataRangeTransport(length, null);
    transport.requestDataRange = (begin: number, end: number) => {
        void (async () => {
            try {
                for (let pieceStart = begin; pieceStart < end; pieceStart += RANGE_PIECE_BYTES) {
                    const pieceEnd = Math.min(pieceStart + RANGE_PIECE_BYTES, end);
                    const chunk = await readRangeWithRetry(filePath, pieceStart, pieceEnd);
                    transport.onDataRange(pieceStart, chunk);
                }
            } catch (error) {
                console.error('PDF range read failed:', error);
            }
        })();
    };
    return transport;
}

// Opens a pdf.js document for a loaded file. Used for the viewer and for the parallel search index.
export function openPdfDocumentSource(pdfjsLib: PdfJsModule, content: FileResponse) {
    if (content.data) return pdfjsLib.getDocument({ data: new Uint8Array(content.data) });
    const length = content.length ?? 0;
    return pdfjsLib.getDocument({
        range: createRangeTransport(pdfjsLib, content.path, length),
        length,
        rangeChunkSize: 64 * 1024,
        disableAutoFetch: true,
        disableStream: true,
    } as never);
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
        loadingTask = openPdfDocumentSource(pdfjsLib, content);
        activeLoad = loadingTask;
        const doc = await loadingTask.promise;
        if (isStale()) {
            if (activeLoad === loadingTask) activeLoad = null;
            void loadingTask.destroy().catch(() => {});
            return false;
        }

        PdfState.currentPdfDoc = doc;
        PdfState.currentSource = content;
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
