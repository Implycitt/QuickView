import type { ThumbnailDependencies, ThumbnailLayout } from "./types.js";

import { DOM } from "../../../ui/core/dom.js";

const THUMB_GAP = 16;
const THUMB_INSET = 16;

export function createThumbnailLayout(deps: ThumbnailDependencies): ThumbnailLayout {
    const aspects = new Map<number, number>();
    const tops: number[] = [];
    const elements: HTMLCanvasElement[] = [];
    let width = 280;
    let dirty = true;

    function height(page: number, targetWidth = deps.getSidebarTargetWidth()): number {
        const points = deps.getPagePointSize(page);
        const aspect = aspects.get(page) ?? points.height / points.width;
        return Math.round(Math.max(120, targetWidth - THUMB_INSET * 2) * aspect);
    }

    function invalidate() {
        dirty = true;
    }

    function rebuild(force = false) {
        const doc = deps.getDocument();
        const pane = DOM.sidebarPreviews;
        if (!doc || !pane) return;
        const total = doc.numPages;
        const targetWidth = deps.getSidebarTargetWidth();
        if (!force && !dirty && tops.length === total && Math.abs(targetWidth - width) < 0.5) return;
        dirty = false;
        width = targetWidth;
        tops.length = 0;
        let y = THUMB_INSET;
        for (let index = 0; index < total; index++) {
            tops.push(y);
            y += height(index + 1, targetWidth) + THUMB_GAP;
        }
        pane.style.height = `${y + THUMB_INSET - THUMB_GAP}px`;
        for (const canvas of elements) {
            const page = Number(canvas.dataset.pageNum || 0);
            canvas.style.top = `${tops[page - 1] ?? 0}px`;
        }
    }

    function ensureMounted(page: number, onClick: () => void): HTMLCanvasElement | null {
        const pane = DOM.sidebarPreviews;
        const doc = deps.getDocument();
        if (!pane || !doc || page < 1 || page > doc.numPages) return null;
        const existing = pane.querySelector<HTMLCanvasElement>(`[data-page-num="${page}"]`);
        if (existing) return existing;
        if (tops.length !== doc.numPages || dirty || Math.abs(deps.getSidebarTargetWidth() - width) >= 0.5) rebuild();
        const canvas = document.createElement("canvas");
        canvas.className =
            "cursor-pointer border-2 border-transparent hover:border-lavender-400 transition-colors shadow-sm rounded bg-white";
        canvas.dataset.pageNum = String(page);
        canvas.style.position = "absolute";
        canvas.style.left = `${THUMB_INSET}px`;
        canvas.style.width = `calc(100% - ${THUMB_INSET * 2}px)`;
        canvas.style.top = `${tops[page - 1]}px`;
        canvas.style.height = `${height(page)}px`;
        canvas.onclick = onClick;
        pane.appendChild(canvas);
        elements.push(canvas);
        return canvas;
    }

    function updateAspect(page: number, aspect: number): boolean {
        if (aspects.get(page) === aspect) return false;
        aspects.set(page, aspect);
        dirty = true;
        return true;
    }

    function reset() {
        tops.length = 0;
        elements.length = 0;
        aspects.clear();
        dirty = true;
        width = 280;
    }

    return {
        height,
        invalidate,
        rebuild,
        tops,
        elements,
        ensureMounted,
        updateAspect,
        reset
    };
}
