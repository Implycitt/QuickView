export type DocumentType = "pdf" | "markdown" | "html";
export type ZoomMode = "auto" | "manual";
export type SidebarTab = "previews" | "sections";

export interface PdfLocation {
    page: number;
    fraction: number;
    scrollTop: number;
    scale: number;
}

export interface StoredViewerState {
    version: 1;
    documentType: DocumentType;
    location?: PdfLocation;
    markdownScrollTop?: number;
    zoomMode: ZoomMode;
    isSnapMode: boolean;
    isSpreadMode?: boolean;
    snapSuspended: boolean;
    sidebarFollow: boolean;
    sidebarOpen: boolean;
    sidebarWidth: number;
    sidebarTab: SidebarTab;
    sidebarScrollTop: number;
}

const STORAGE_PREFIX = "quickview.document-view.v1:";
const LAST_DOCUMENT_PATH_KEY = "quickview.last-document-path.v1";

function clearPersistedViewerState(): void {
    try {
        for (let index = localStorage.length - 1; index >= 0; index--) {
            const key = localStorage.key(index);
            if (key === LAST_DOCUMENT_PATH_KEY || key?.startsWith(STORAGE_PREFIX)) {
                localStorage.removeItem(key);
            }
        }
    } catch {}
}

clearPersistedViewerState();

export function getLastDocumentPath(): string | null {
    try {
        return sessionStorage.getItem(LAST_DOCUMENT_PATH_KEY) || null;
    } catch {
        return null;
    }
}

export function setLastDocumentPath(path: string | null): void {
    try {
        if (path) sessionStorage.setItem(LAST_DOCUMENT_PATH_KEY, path);
        else sessionStorage.removeItem(LAST_DOCUMENT_PATH_KEY);
    } catch {}
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isStoredViewerState(value: unknown): value is StoredViewerState {
    if (!value || typeof value !== "object") return false;
    const state = value as Partial<StoredViewerState>;
    if (
        state.version !== 1 ||
        (state.documentType !== "pdf" && state.documentType !== "markdown" && state.documentType !== "html") ||
        (state.zoomMode !== "auto" && state.zoomMode !== "manual") ||
        typeof state.isSnapMode !== "boolean" ||
        (state.isSpreadMode !== undefined && typeof state.isSpreadMode !== "boolean") ||
        typeof state.snapSuspended !== "boolean" ||
        typeof state.sidebarFollow !== "boolean" ||
        typeof state.sidebarOpen !== "boolean" ||
        !isFiniteNumber(state.sidebarWidth) ||
        state.sidebarWidth < 150 ||
        state.sidebarWidth > 600 ||
        (state.sidebarTab !== "previews" && state.sidebarTab !== "sections") ||
        !isFiniteNumber(state.sidebarScrollTop) ||
        state.sidebarScrollTop < 0
    ) {
        return false;
    }

    if (state.documentType === "pdf") {
        return (
            !!state.location &&
            Number.isInteger(state.location.page) &&
            state.location.page >= 1 &&
            isFiniteNumber(state.location.fraction) &&
            state.location.fraction >= 0 &&
            state.location.fraction <= 1 &&
            isFiniteNumber(state.location.scrollTop) &&
            state.location.scrollTop >= 0 &&
            isFiniteNumber(state.location.scale) &&
            state.location.scale > 0 &&
            state.location.scale < 1000
        );
    }

    return state.documentType === "html" || (isFiniteNumber(state.markdownScrollTop) && state.markdownScrollTop >= 0);
}

export function readViewerState(documentId: string): StoredViewerState | null {
    try {
        const serialized = sessionStorage.getItem(`${STORAGE_PREFIX}${documentId}`);
        if (!serialized) return null;
        const parsed: unknown = JSON.parse(serialized);
        return isStoredViewerState(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export function writeViewerState(documentId: string, state: StoredViewerState): void {
    try {
        sessionStorage.setItem(`${STORAGE_PREFIX}${documentId}`, JSON.stringify(state));
    } catch {}
}
