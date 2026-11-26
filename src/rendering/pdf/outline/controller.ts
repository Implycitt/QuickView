import { buildOutlineItem } from "./tree.js";
import type { OutlineDependencies, OutlinePosition, OutlineTarget } from "./types.js";

import { BREADCRUMB_SEPARATOR, setBreadcrumbPath } from "../../../ui/core/breadcrumb.js";
import { DOM } from "../../../ui/core/dom.js";

const OUTLINE_LINK_CONCURRENCY = 8;

export function createPdfOutline(deps: OutlineDependencies) {
    const destinations = new Map<HTMLElement, unknown>();
    const positions = new Map<HTMLElement, OutlinePosition>();
    const parents = new Map<HTMLElement, HTMLElement | null>();
    let positionedRows: Array<{ row: HTMLElement; page: number; y: number }> = [];
    const rowBoxes = new Map<HTMLElement, { top: number; height: number }>();
    let rows: HTMLElement[] = [];
    let activeRow: HTMLElement | null = null;
    let fileName: string | null = null;
    let breadcrumbRow: HTMLElement | null = null;
    let breadcrumbFileName: string | null | undefined;
    let layoutValid = false;
    let viewportValid = false;
    let sidebarScrollTop = 0;
    let sidebarViewportHeight = 0;
    let paneTop = 0;
    let observersInstalled = false;

    function invalidateLayout() {
        layoutValid = false;
        rowBoxes.clear();
    }

    function invalidateViewport() {
        viewportValid = false;
    }

    function sectionsVisible(): boolean {
        return (
            !!DOM.sidebarSections &&
            !DOM.sidebarSections.classList.contains("hidden") &&
            !!DOM.sidebar &&
            DOM.sidebar.style.width !== "0px"
        );
    }

    function installObservers() {
        const sidebar = document.getElementById("sidebar");
        if (!sidebar || observersInstalled) return;
        observersInstalled = true;
        sidebar.addEventListener("scroll", invalidateViewport, { passive: true });
        if (typeof ResizeObserver !== "undefined") {
            new ResizeObserver(invalidateViewport).observe(sidebar);
            if (DOM.sidebarSections) new ResizeObserver(invalidateLayout).observe(DOM.sidebarSections);
        }
    }

    function ensureViewport() {
        if (viewportValid) return;
        const sidebar = document.getElementById("sidebar");
        if (!sidebar) return;
        viewportValid = true;
        sidebarScrollTop = sidebar.scrollTop;
        sidebarViewportHeight = sidebar.clientHeight;
    }

    function ensureLayout() {
        if (layoutValid) return;
        layoutValid = true;
        rowBoxes.clear();
        const sidebar = document.getElementById("sidebar");
        const pane = DOM.sidebarSections;
        if (!sidebar || !pane || !sectionsVisible() || rows.length === 0) return;
        const paneRectTop = pane.getBoundingClientRect().top;
        paneTop = paneRectTop - sidebar.getBoundingClientRect().top + sidebarScrollTop;
        for (const row of rows) {
            const rect = row.getBoundingClientRect();
            rowBoxes.set(row, { top: rect.top - paneRectTop, height: rect.height });
        }
    }

    function scrollRowIntoView(row: HTMLElement, center = false) {
        const sidebar = document.getElementById("sidebar");
        if (!sidebar || !sectionsVisible()) return;
        ensureViewport();
        ensureLayout();
        const box = rowBoxes.get(row);
        if (!box || box.height <= 0) return;
        const stickyTop = DOM.sidebarTabs?.offsetHeight ?? 0;
        const viewportHeight = Math.max(0, sidebarViewportHeight - stickyTop);
        const viewTop = sidebarScrollTop + stickyTop - paneTop;
        const viewBottom = sidebarScrollTop + sidebarViewportHeight - paneTop;
        if (!center && box.top >= viewTop && box.top + box.height <= viewBottom) return;
        const target = Math.max(0, box.top + paneTop - stickyTop - (viewportHeight - box.height) / 2);
        const distance = Math.abs(sidebarScrollTop - target);
        if (distance < 1) return;
        sidebar.scrollTop = target;
        sidebarScrollTop = target;
    }

    function bestRow(position: OutlinePosition): HTMLElement | null {
        const positionY = position.y;
        let low = 0;
        let high = positionedRows.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            const candidate = positionedRows[middle];
            if (candidate.page < position.page || (candidate.page === position.page && candidate.y <= positionY)) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        return positionedRows[low - 1]?.row ?? null;
    }

    function syncBreadcrumb(row?: HTMLElement | null) {
        const current = row !== undefined ? row : activeRow;
        if (current === breadcrumbRow && fileName === breadcrumbFileName) return;
        breadcrumbRow = current;
        breadcrumbFileName = fileName;
        if (!fileName) {
            setBreadcrumbPath(null);
            return;
        }
        let path = fileName;
        if (current) {
            const parts: string[] = [];
            let node: HTMLElement | null = current;
            while (node) {
                parts.unshift(node.querySelector(".outline-label")?.textContent || "(untitled)");
                node = parents.get(node) ?? null;
            }
            path = `${fileName}${BREADCRUMB_SEPARATOR}${parts.join(BREADCRUMB_SEPARATOR)}`;
        }
        setBreadcrumbPath(path);
    }

    function sync(position: OutlinePosition | null = null, forceFollow = false) {
        if (!deps.hasScrollContainer() || !DOM.sidebarSections) return;
        if (rows.length === 0) {
            syncBreadcrumb(null);
            return;
        }
        const best = bestRow(position ?? deps.getCurrentPosition());
        const visible = sectionsVisible();
        const activeChanged = best !== activeRow;
        if (visible && activeChanged) {
            activeRow?.classList.remove("outline-active");
            activeRow = best;
            if (best) {
                best.classList.add("outline-active");
                let node = best.parentElement;
                let expanded = false;
                while (node && node !== DOM.sidebarSections) {
                    if (node.classList.contains("outline-children") && node.classList.contains("hidden")) {
                        node.classList.remove("hidden");
                        node.previousElementSibling?.classList.remove("outline-collapsed");
                        expanded = true;
                    }
                    node = node.parentElement;
                }
                if (expanded) invalidateLayout();
            }
        }
        if (best && visible && (forceFollow || (!deps.isFollowSuppressed() && deps.getSidebarFollow()))) {
            scrollRowIntoView(best, forceFollow || activeChanged);
        }
        syncBreadcrumb(best);
    }

    async function resolveDestination(destination: unknown): Promise<OutlineTarget | null> {
        try {
            const doc = deps.getDocument();
            if (!destination || !doc) return null;
            if (typeof destination === "string") return resolveDestination(await doc.getDestination(destination));
            if (!Array.isArray(destination)) return null;
            const dest = destination as unknown[];
            const reference = dest[0];
            if (reference && typeof reference === "object" && "num" in reference) {
                return withDestinationPosition((await doc.getPageIndex(reference)) + 1, dest, doc);
            }
            if (typeof reference === "number") return withDestinationPosition(Math.round(reference), dest, doc);
        } catch {}
        return null;
    }

    async function withDestinationPosition(
        pageNumber: number,
        destination: unknown[],
        doc: NonNullable<ReturnType<OutlineDependencies["getDocument"]>>
    ): Promise<OutlineTarget | null> {
        const page = Math.min(doc.numPages, Math.max(1, pageNumber));
        const modeValue = destination[1] as { name?: unknown } | string | undefined;
        const mode = typeof modeValue === "object" && modeValue !== null ? modeValue.name : modeValue;
        let top: number | null = null;
        if (mode === "XYZ" && typeof destination[3] === "number") top = destination[3];
        else if ((mode === "FitH" || mode === "FitBH") && typeof destination[2] === "number") top = destination[2];
        if (top === null) return { page, y: null };

        let height = deps.getPageHeightPoints(page);
        if (height === undefined) {
            const pdfPage = await doc.getPage(page);
            height = pdfPage.view[3] - pdfPage.view[1];
        }
        const yPoints = height - top;
        return yPoints <= 1 ? { page, y: null } : { page, y: yPoints * deps.getScale() };
    }

    async function linkRows() {
        if (!DOM.sidebarSections) return;
        const rows = Array.from(DOM.sidebarSections.querySelectorAll<HTMLElement>(".outline-item"));
        let next = 0;
        const worker = async () => {
            while (next < rows.length) {
                const row = rows[next++];
                const destination = destinations.get(row);
                if (!destination) continue;
                const target = await resolveDestination(destination);
                if (target) {
                    row.dataset.page = String(target.page);
                    positions.set(row, { page: target.page, y: target.y ?? 0 });
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(OUTLINE_LINK_CONCURRENCY, rows.length) }, worker));
    }

    async function render() {
        const doc = deps.getDocument();
        if (!doc || !DOM.sidebarSections) return;
        installObservers();
        DOM.sidebarSections.innerHTML = "";
        invalidateViewport();
        invalidateLayout();
        activeRow = null;
        positionedRows = [];
        rows = [];
        breadcrumbRow = null;
        breadcrumbFileName = undefined;
        destinations.clear();
        positions.clear();
        parents.clear();

        const outline = await doc.getOutline().catch(() => null);
        if (!outline || outline.length === 0) {
            const empty = document.createElement("div");
            empty.className = "text-gray-500 text-xs italic p-2";
            empty.textContent = "No sections in this document";
            DOM.sidebarSections.appendChild(empty);
            syncBreadcrumb();
            return;
        }

        const fragment = document.createDocumentFragment();
        for (const item of outline) {
            fragment.appendChild(
                buildOutlineItem(item, 0, null, {
                    setParent: (row, parent) => parents.set(row, parent),
                    setDestination: (row, destination) => destinations.set(row, destination),
                    toggleChildren: invalidateLayout,
                    navigate: destination => {
                        void resolveDestination(destination).then(target => {
                            if (target) deps.jumpToPage(target.page, null, true);
                        });
                    }
                })
            );
        }
        DOM.sidebarSections.appendChild(fragment);
        rows = Array.from(DOM.sidebarSections.querySelectorAll<HTMLElement>(".outline-item"));
        await linkRows();
        positionedRows = rows
            .map((row, order) => {
                const location = positions.get(row);
                return location ? { row, page: location.page, y: location.y, order } : null;
            })
            .filter((entry): entry is { row: HTMLElement; page: number; y: number; order: number } => entry !== null)
            .sort((left, right) => left.page - right.page || left.y - right.y || left.order - right.order);
        sync();
    }

    function reset() {
        rows = [];
        activeRow = null;
        fileName = null;
        breadcrumbRow = null;
        breadcrumbFileName = undefined;
        destinations.clear();
        positions.clear();
        parents.clear();
        positionedRows = [];
        invalidateLayout();
        syncBreadcrumb();
    }

    function setFileName(name: string | null) {
        fileName = name;
        syncBreadcrumb();
    }

    return { invalidateLayout, invalidateViewport, render, reset, resolveDestination, setFileName, sync };
}
