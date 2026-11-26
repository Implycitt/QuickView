const DEFAULT_PAGE_POINTS = { width: 612, height: 792 };
const DEFAULT_PAGE_PADDING = 32;
const DEFAULT_PAGE_GAP = 32;
const PAGE_CONTAINER_CLASS = "pdf-page-container shadow-lg bg-white shrink-0 relative";
const PAGE_ROW_CLASS = "pdf-page-row mx-auto mb-8 flex shrink-0 items-center justify-center";
const SPREAD_ROW_GAP_CLASS = "gap-px";

export const SPREAD_PAGE_GAP = 1;
const MOUNT_BEHIND_PAGES = 3;
const MOUNT_AHEAD_PAGES = 6;
const LARGE_DOC_PAGES = 700;
const LARGE_DOC_MOUNT_BEHIND = 2;
const LARGE_DOC_MOUNT_AHEAD = 4;

interface PdfPageLayoutDependencies {
    getScale: () => number;
    getSnapMode: () => boolean;
    getSpreadMode: () => boolean;
    isSnapSuspended: () => boolean;
    onPageSizeChanged: (page: number) => void;
    onPageUnmounted: (page: number) => void;
}

export function createPdfPageLayout(deps: PdfPageLayoutDependencies) {
    const pageSizePoints = new Map<number, { width: number; height: number }>();
    let scrollContainer: HTMLElement | null = null;
    let pageContainers: Array<HTMLElement | undefined> = [];
    let pageCount = 0;
    let mountedPages: number[] = [];
    let topSpacer: HTMLElement | null = null;
    let bottomSpacer: HTMLElement | null = null;
    let spacerTopHeight = -1;
    let spacerBottomHeight = -1;
    let placeholderPoints = { ...DEFAULT_PAGE_POINTS };
    let rowFirstPages: number[] = [];
    let rowLastPages: number[] = [];
    let rowTops: number[] = [];
    let rowHeights: number[] = [];
    let rowOfPage: number[] = [];
    let mountedRows: number[] = [];
    let rowContainers: Array<HTMLElement | undefined> = [];
    let pageGeometryDirty = true;
    let geoLayout: { baseTop: number; gap: number } | null = null;

    function pagePointSize(pageNumber: number) {
        return pageSizePoints.get(pageNumber) ?? placeholderPoints;
    }

    function pageWidth(pageNumber: number): number {
        return pagePointSize(pageNumber).width * (deps.getScale() || 1);
    }

    function pageHeight(pageNumber: number): number {
        return pagePointSize(pageNumber).height * (deps.getScale() || 1);
    }

    function setPlaceholderPoints(points: { width: number; height: number }) {
        placeholderPoints = points;
    }

    function clearPageSizes() {
        pageSizePoints.clear();
        pageGeometryDirty = true;
        placeholderPoints = { ...DEFAULT_PAGE_POINTS };
    }

    function setPagePoints(pageNumber: number, points: { width: number; height: number }) {
        const existing = pageSizePoints.get(pageNumber);
        if (
            existing &&
            Math.abs(existing.width - points.width) < 0.5 &&
            Math.abs(existing.height - points.height) < 0.5
        ) {
            return false;
        }
        pageSizePoints.set(pageNumber, points);
        const container = pageContainers[pageNumber - 1];
        if (container) {
            container.style.width = `${pageWidth(pageNumber)}px`;
            container.style.height = `${pageHeight(pageNumber)}px`;
        }
        pageGeometryDirty = true;
        deps.onPageSizeChanged(pageNumber);
        return true;
    }

    function spreadBandHeight(): number {
        if (!deps.getSpreadMode()) return 0;
        return Math.max(0, scrollContainer?.clientHeight ?? 0);
    }

    function syncMountedRowHeights() {
        for (const row of mountedRows) {
            const element = rowContainers[row];
            if (!element) continue;
            const minHeight = `${rowHeights[row] ?? 0}px`;
            if (element.style.minHeight !== minHeight) element.style.minHeight = minHeight;
        }
    }

    function rebuildRows() {
        const spread = deps.getSpreadMode();
        rowFirstPages = [];
        rowLastPages = [];
        rowTops = [];
        rowHeights = [];
        rowOfPage = new Array<number>(pageCount);
        if (pageCount === 0) return;
        let page = 1;
        while (page <= pageCount) {
            const first = page;
            const last = !spread ? page : first === 1 ? 1 : Math.min(pageCount, first + 1);
            rowFirstPages.push(first);
            rowLastPages.push(last);
            for (let number = first; number <= last; number++) rowOfPage[number - 1] = rowFirstPages.length - 1;
            page = last + 1;
        }
        const layout = geoLayout ?? { baseTop: DEFAULT_PAGE_PADDING, gap: DEFAULT_PAGE_GAP };
        const scale = deps.getScale() || 1;
        const band = spreadBandHeight();
        let y = layout.baseTop;
        for (let row = 0; row < rowFirstPages.length; row++) {
            rowTops[row] = y;
            let height = 0;
            for (let number = rowFirstPages[row]; number <= rowLastPages[row]; number++) {
                height = Math.max(height, pagePointSize(number).height * scale);
            }
            height = Math.max(height, band);
            rowHeights[row] = height;
            y += height + layout.gap;
        }
        syncMountedRowHeights();
    }

    function setViewer(scroll: HTMLElement, totalPages: number, top: HTMLElement, bottom: HTMLElement) {
        scrollContainer = scroll;
        pageCount = totalPages;
        pageContainers = new Array<HTMLElement | undefined>(totalPages);
        mountedPages = [];
        mountedRows = [];
        rowContainers = [];
        topSpacer = top;
        bottomSpacer = bottom;
        spacerTopHeight = -1;
        spacerBottomHeight = -1;
        pageGeometryDirty = true;
        geoLayout = null;
    }

    function clearViewer() {
        scrollContainer = null;
        pageContainers = [];
        mountedPages = [];
        mountedRows = [];
        rowContainers = [];
        rowFirstPages = [];
        rowLastPages = [];
        rowTops = [];
        rowHeights = [];
        rowOfPage = [];
        pageCount = 0;
        topSpacer = null;
        bottomSpacer = null;
        spacerTopHeight = -1;
        spacerBottomHeight = -1;
        pageGeometryDirty = true;
        geoLayout = null;
    }

    function ensureGeometry() {
        if (!pageGeometryDirty) return;
        pageGeometryDirty = false;
        rebuildRows();
    }

    function rowOf(pageNumber: number): number {
        ensureGeometry();
        return rowOfPage[pageNumber - 1] ?? 0;
    }

    function pageTop(pageNumber: number): number {
        ensureGeometry();
        return rowTops[rowOfPage[pageNumber - 1]] ?? geoLayout?.baseTop ?? DEFAULT_PAGE_PADDING;
    }

    function pageBottom(pageNumber: number): number {
        return pageTop(pageNumber) + pageHeight(pageNumber);
    }

    function rowHeight(pageNumber: number): number {
        ensureGeometry();
        return rowHeights[rowOfPage[pageNumber - 1]] ?? pageHeight(pageNumber);
    }

    function rowBottom(pageNumber: number): number {
        return pageTop(pageNumber) + rowHeight(pageNumber);
    }

    function pageAtOffset(offset: number): number {
        if (pageCount === 0) return 1;
        ensureGeometry();
        const target = Math.max(0, Math.min(rowBottom(pageCount), offset));
        let low = 0;
        let high = rowFirstPages.length - 1;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (rowTops[middle] + rowHeights[middle] <= target) low = middle + 1;
            else high = middle;
        }
        const first = rowFirstPages[low];
        const last = rowLastPages[low];
        for (let page = first; page < last; page++) {
            if (pageBottom(page) > target) return page;
        }
        return last;
    }

    function rowStart(pageNumber: number, rowOffset: number): number {
        ensureGeometry();
        const row = Math.max(0, Math.min(rowFirstPages.length - 1, rowOfPage[pageNumber - 1] + rowOffset));
        return rowFirstPages[row] ?? 1;
    }

    function getMountMargins() {
        return pageCount > LARGE_DOC_PAGES
            ? { behind: LARGE_DOC_MOUNT_BEHIND, ahead: LARGE_DOC_MOUNT_AHEAD }
            : { behind: MOUNT_BEHIND_PAGES, ahead: MOUNT_AHEAD_PAGES };
    }

    function updateSpacers() {
        if (!topSpacer || !bottomSpacer || mountedPages.length === 0 || pageCount === 0) return;
        const first = mountedPages[0];
        const last = mountedPages[mountedPages.length - 1];
        const base = geoLayout?.baseTop ?? DEFAULT_PAGE_PADDING;
        const top = Math.max(0, pageTop(first) - base);
        const bottom = Math.max(0, rowBottom(pageCount) - rowBottom(last));
        if (spacerTopHeight !== top) {
            spacerTopHeight = top;
            topSpacer.style.height = `${top}px`;
        }
        if (spacerBottomHeight !== bottom) {
            spacerBottomHeight = bottom;
            bottomSpacer.style.height = `${bottom}px`;
        }
    }

    function createContainer(pageNumber: number): HTMLElement {
        const size = pagePointSize(pageNumber);
        const scale = deps.getScale() || 1;
        const container = document.createElement("div");
        container.id = `page-container-${pageNumber}`;
        container.className = PAGE_CONTAINER_CLASS;
        container.dataset.pageNum = String(pageNumber);
        container.style.width = `${size.width * scale}px`;
        container.style.height = `${size.height * scale}px`;
        return container;
    }

    function createRow(row: number): HTMLElement | null {
        if (!scrollContainer || !bottomSpacer || rowContainers[row]) return null;
        const element = document.createElement("div");
        element.className =
            rowLastPages[row] > rowFirstPages[row] ? `${PAGE_ROW_CLASS} ${SPREAD_ROW_GAP_CLASS}` : PAGE_ROW_CLASS;
        element.dataset.rowIndex = String(row);
        element.style.minHeight = `${rowHeights[row] ?? 0}px`;
        for (let pageNumber = rowFirstPages[row]; pageNumber <= rowLastPages[row]; pageNumber++) {
            if (pageContainers[pageNumber - 1]) continue;
            const container = createContainer(pageNumber);
            element.appendChild(container);
            pageContainers[pageNumber - 1] = container;
            mountedPages.push(pageNumber);
        }
        let inserted = false;
        for (const mounted of mountedRows) {
            if (mounted > row) {
                rowContainers[mounted]?.before(element);
                inserted = true;
                break;
            }
        }
        if (!inserted) bottomSpacer.before(element);
        rowContainers[row] = element;
        mountedRows.push(row);
        mountedRows.sort((left, right) => left - right);
        mountedPages.sort((left, right) => left - right);
        return element;
    }

    function unmountRow(row: number) {
        rowContainers[row]?.remove();
        rowContainers[row] = undefined;
        const index = mountedRows.indexOf(row);
        if (index >= 0) mountedRows.splice(index, 1);
        for (const pageNumber of [...mountedPages]) {
            if (rowOf(pageNumber) !== row) continue;
            pageContainers[pageNumber - 1] = undefined;
            const pageIndex = mountedPages.indexOf(pageNumber);
            if (pageIndex >= 0) mountedPages.splice(pageIndex, 1);
            deps.onPageUnmounted(pageNumber);
        }
    }

    function unmountAllRows() {
        for (const row of [...mountedRows]) unmountRow(row);
    }

    function syncMountedPages(first: number, last: number) {
        if (!scrollContainer || pageCount === 0) return;
        ensureGeometry();
        first = Math.max(1, Math.min(pageCount, first));
        last = Math.max(first, Math.min(pageCount, last));
        const firstRow = rowOfPage[first - 1];
        const lastRow = rowOfPage[last - 1];
        const needed = lastRow - firstRow + 1;
        if (
            mountedRows.length === needed &&
            mountedRows[0] === firstRow &&
            mountedRows[mountedRows.length - 1] === lastRow
        ) {
            updateSpacers();
            return;
        }
        const overlaps = mountedRows.some(row => row >= firstRow && row <= lastRow);
        if (!overlaps) unmountAllRows();
        for (const row of [...mountedRows]) {
            if (row < firstRow || row > lastRow) unmountRow(row);
        }
        for (let row = firstRow; row <= lastRow; row++) {
            if (!rowContainers[row]) createRow(row);
        }
        updateSpacers();
    }

    function mountAroundPage(pageNumber: number) {
        const margin = getMountMargins();
        syncMountedPages(pageNumber - margin.behind, pageNumber + margin.ahead);
    }

    function applyScrollMode() {
        if (!scrollContainer) return;
        const enabled = deps.getSnapMode() && !deps.isSnapSuspended();
        scrollContainer.dataset.scrollMode = enabled ? "snap" : "free";
    }

    function sampleLayout() {
        if (!scrollContainer || mountedPages.length === 0) return;
        ensureGeometry();
        const scrollerTop = scrollContainer.getBoundingClientRect().top;
        const contentOffset = (element: HTMLElement) =>
            element.getBoundingClientRect().top - scrollerTop + scrollContainer!.scrollTop;
        const first = mountedPages[0];
        const firstRow = rowOfPage[first - 1];
        const firstElement = rowContainers[firstRow];
        if (!firstElement) return;
        const spacerAbove = Math.max(0, pageTop(first) - (geoLayout?.baseTop ?? DEFAULT_PAGE_PADDING));
        const baseTop = contentOffset(firstElement) - spacerAbove;
        let gap = geoLayout?.gap ?? DEFAULT_PAGE_GAP;
        const nextRow = firstRow + 1;
        const nextElement = rowContainers[nextRow];
        if (nextElement) {
            const measured = contentOffset(nextElement) - contentOffset(firstElement) - rowHeights[firstRow];
            if (measured >= 0 && measured < 200) gap = measured;
        }
        if (geoLayout && Math.abs(geoLayout.baseTop - baseTop) < 0.5 && Math.abs(geoLayout.gap - gap) < 0.5) return;
        geoLayout = { baseTop, gap };
        pageGeometryDirty = true;
        ensureGeometry();
        updateSpacers();
    }

    function currentPageAtViewport(lastKnownPage: number): number {
        if (pageCount === 0 || !scrollContainer) return lastKnownPage;
        const middle = scrollContainer.scrollTop + (scrollContainer.clientHeight || 1) / 2;
        return pageAtOffset(middle);
    }

    return {
        clearPageSizes,
        clearViewer,
        currentPageAtViewport,
        getMountMargins,
        getPageContainer: (pageNumber: number) => pageContainers[pageNumber - 1] ?? null,
        getPageCount: () => pageCount,
        getPageHeight: pageHeight,
        getPageHeightPoints: (pageNumber: number) => pageSizePoints.get(pageNumber)?.height,
        getPagePointSize: pagePointSize,
        getPageTop: pageTop,
        getRowHeight: rowHeight,
        getRowStart: rowStart,
        getScrollContainer: () => scrollContainer,
        isPageMeasured: (pageNumber: number) => pageSizePoints.has(pageNumber),
        mountAroundPage,
        pageAtOffset,
        sampleLayout,
        setPagePoints,
        setPlaceholderPoints,
        setViewer,
        syncMountedPages,
        applyScrollMode,
        updateSpacers
    };
}

export type PdfPageLayout = ReturnType<typeof createPdfPageLayout>;
