import type { PdfDocumentLike } from "../types.js";

export interface OutlineTarget {
    page: number;
    y: number | null;
}

export interface OutlinePosition {
    page: number;
    y: number;
}

export interface OutlineDependencies {
    getDocument: () => PdfDocumentLike | null;
    getScale: () => number;
    getCurrentPosition: () => OutlinePosition;
    getCurrentPage: () => number;
    hasScrollContainer: () => boolean;
    getSidebarFollow: () => boolean;
    isFollowSuppressed: () => boolean;
    getPageHeightPoints: (page: number) => number | undefined;
    jumpToPage: (page: number, y: number | null, center?: boolean) => void;
}
