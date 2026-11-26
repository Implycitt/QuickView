import { PdfState } from "./state.js";

import { DOM, setSidebarFollowLabel, updateScrollModeClasses, updateSpreadModeClasses } from "../../ui/core/dom.js";
import { scrollInstantly } from "../../ui/core/scroll.js";
import type { PdfLocation } from "../../viewer/state.js";

const WHEEL_STEP_DISTANCE = 24;
const WHEEL_STEP_COOLDOWN_MS = 110;
const SNAP_ANCHOR_TTL_MS = 1500;
const REALIGN_PAGE_TOLERANCE = 1;
const SNAP_RESUME_KEYS = new Set(["j", "k", "arrowup", "arrowdown", "pageup", "pagedown", "home", "end", " "]);

interface NavigationDependencies {
    getScrollContainer: () => HTMLElement | null;
    getPageCount: () => number;
    getPageTop: (page: number) => number;
    getPageHeight: (page: number) => number;
    getRowHeight: (page: number) => number;
    getRowStart: (page: number, rowOffset: number) => number;
    isPageMeasured: (page: number) => boolean;
    mountAroundPage: (page: number) => void;
    ensureGeometry: () => void;
    currentPageAtViewport: () => number;
    scheduleRender: () => void;
    measureAround: (page: number) => Promise<void>;
    refreshSidebar: (scrollToActive?: boolean) => void;
    applyScrollMode: () => void;
    clearPendingRestore?: () => void;
}

export function createPdfNavigation(deps: NavigationDependencies) {
    let snapSuspended = false;
    let followSuppressed = false;
    let resumeHandler: ((event: Event) => void) | null = null;
    let anchoredPage: number | null = null;
    let anchorExpiresAt = 0;
    let wheelContainer: HTMLElement | null = null;
    let wheelAccumulator = 0;
    let wheelLockUntil = 0;

    function scrollMode(): "snap" | "free" {
        return PdfState.isSnapMode && !snapSuspended ? "snap" : "free";
    }

    function viewportHeight(): number {
        return deps.getScrollContainer()?.clientHeight ?? 0;
    }

    function alignedTopForPage(page: number): number {
        const top = deps.getPageTop(page);
        const viewport = viewportHeight();
        const height = deps.getRowHeight(page);
        if (viewport <= 0 || height >= viewport) return Math.max(0, top);
        return Math.max(0, top - (viewport - height) / 2);
    }

    function pageEndTop(page: number): number {
        const viewport = viewportHeight();
        const height = deps.getRowHeight(page);
        const top = deps.getPageTop(page);
        if (viewport <= 0 || height <= viewport) return alignedTopForPage(page);
        return Math.max(0, top + height - viewport);
    }

    function pageIsLong(page: number): boolean {
        const viewport = viewportHeight();
        return viewport > 0 && deps.getRowHeight(page) > viewport + 4;
    }

    function topForPage(page: number): number {
        return scrollMode() === "snap" ? alignedTopForPage(page) : deps.getPageTop(page);
    }

    function setScrollTop(top: number) {
        const scroll = deps.getScrollContainer();
        if (!scroll) return;
        scrollInstantly(scroll, top);
    }

    function anchorAlignment(page: number) {
        anchoredPage = scrollMode() === "snap" && !pageIsLong(page) ? deps.getRowStart(page, 0) : null;
        anchorExpiresAt = performance.now() + SNAP_ANCHOR_TTL_MS;
    }

    function refreshSnapAnchor() {
        if (anchoredPage === null) return;
        if (scrollMode() !== "snap" || performance.now() > anchorExpiresAt) {
            anchoredPage = null;
            return;
        }
        if (deps.currentPageAtViewport() !== anchoredPage) {
            anchoredPage = null;
            return;
        }
        setScrollTop(alignedTopForPage(anchoredPage));
    }

    function clearSnapResumeHandler() {
        if (!resumeHandler) return;
        window.removeEventListener("keydown", resumeHandler, { capture: true });
        resumeHandler = null;
    }

    function isTypingTarget(target: EventTarget | null): boolean {
        return target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);
    }

    function resumeSnap() {
        if (!PdfState.isSnapMode || !snapSuspended) return;
        clearSnapResumeHandler();
        snapSuspended = false;
        anchoredPage = null;
        deps.applyScrollMode();
        window.dispatchEvent(new Event("qv:pdf-viewer-settings-changed"));
    }

    function installSnapResumeHandler() {
        if (!snapSuspended || resumeHandler) return;
        const resume = (event: Event) => {
            if (event instanceof KeyboardEvent) {
                if (!SNAP_RESUME_KEYS.has(event.key.toLowerCase()) || isTypingTarget(event.target)) return;
            }
            resumeSnap();
        };
        resumeHandler = resume;
        window.addEventListener("keydown", resume, { capture: true });
    }

    function suspendSnap() {
        if (scrollMode() !== "snap") return;
        snapSuspended = true;
        anchoredPage = null;
        installSnapResumeHandler();
        deps.applyScrollMode();
        window.dispatchEvent(new Event("qv:pdf-viewer-settings-changed"));
    }

    function applySettings(settings: {
        isSnapMode: boolean;
        snapSuspended: boolean;
        sidebarFollow: boolean;
        isSpreadMode: boolean;
    }) {
        PdfState.isSnapMode = settings.isSnapMode;
        PdfState.sidebarFollow = settings.sidebarFollow;
        PdfState.isSpreadMode = settings.isSpreadMode;
        clearSnapResumeHandler();
        snapSuspended = settings.snapSuspended && settings.isSnapMode;
        anchoredPage = null;
        setSidebarFollowLabel(PdfState.sidebarFollow);
        updateScrollModeClasses(PdfState.isSnapMode);
        updateSpreadModeClasses(PdfState.isSpreadMode);
        if (snapSuspended) installSnapResumeHandler();
        deps.applyScrollMode();
        window.dispatchEvent(new Event("qv:pdf-viewer-settings-changed"));
    }

    function setZoom(scale: number, mode: "auto" | "manual") {
        if (!Number.isFinite(scale) || scale <= 0) return;
        PdfState.currentScale = scale;
        PdfState.zoomMode = mode;
        anchoredPage = null;
        if (DOM.zoomLevelSpan) DOM.zoomLevelSpan.value = `${Math.round(scale * 100)}%`;
        window.dispatchEvent(new Event("qv:pdf-viewer-settings-changed"));
    }

    function captureLocation(saved: PdfLocation | null): PdfLocation | null {
        const scroll = deps.getScrollContainer();
        if (!scroll || deps.getPageCount() === 0) return saved;
        const scrollTop = scroll.scrollTop;
        const page = deps.currentPageAtViewport();
        const height = deps.getRowHeight(page) || 1;
        const fraction = Math.max(0, Math.min(1, (scrollTop - deps.getPageTop(page)) / height));
        return { page, fraction, scrollTop, scale: PdfState.currentScale };
    }

    function scrollTopForLocation(location: PdfLocation): number {
        const page = Math.min(deps.getPageCount(), Math.max(1, location.page));
        const scroll = deps.getScrollContainer();
        const maxScroll = Math.max(0, (scroll?.scrollHeight ?? 0) - (scroll?.clientHeight ?? 0));
        if (scrollMode() === "snap") {
            const viewport = viewportHeight();
            const height = deps.getRowHeight(page);
            const target =
                pageIsLong(page) && location.fraction > 0
                    ? deps.getPageTop(page) + location.fraction * (height - viewport)
                    : alignedTopForPage(page);
            return Math.max(0, Math.min(maxScroll, target));
        }
        const sameScale = Math.abs(PdfState.currentScale - location.scale) < 0.001;
        const target = sameScale
            ? location.scrollTop
            : deps.getPageTop(page) + location.fraction * deps.getRowHeight(page);
        return Math.max(0, Math.min(maxScroll, target));
    }

    function restoreScrollPosition(location: PdfLocation | null) {
        const scroll = deps.getScrollContainer();
        if (!location || !scroll || deps.getPageCount() === 0) return;
        deps.mountAroundPage(location.page);
        deps.ensureGeometry();
        setScrollTop(scrollTopForLocation(location));
        anchorAlignment(Math.min(deps.getPageCount(), Math.max(1, location.page)));
    }

    function restorePosition(location: PdfLocation | null) {
        if (!location) return;
        const pageCount = deps.getPageCount();
        const page = Math.max(1, Math.min(pageCount || location.page, location.page));
        const scroll = deps.getScrollContainer();
        if (!scroll || pageCount === 0) return;
        deps.mountAroundPage(page);
        deps.ensureGeometry();
        setScrollTop(scrollTopForLocation(location));
        anchorAlignment(page);
        if (DOM.pageCounter) {
            DOM.pageCounter.value = String(page);
            DOM.pageCounter.dataset.current = String(page);
        }
        if (!snapSuspended) deps.clearPendingRestore?.();
        deps.scheduleRender();
    }

    function goToPage(pageNumber: number) {
        const scroll = deps.getScrollContainer();
        const pageCount = deps.getPageCount();
        if (!scroll || pageCount === 0 || !PdfState.currentPdfDoc) return;
        const page = Math.min(pageCount, Math.max(1, Math.round(pageNumber)));
        deps.mountAroundPage(page);
        deps.ensureGeometry();
        setScrollTop(topForPage(page));
        anchorAlignment(page);
        deps.scheduleRender();
        if (deps.isPageMeasured(page)) return;
        void deps.measureAround(page).then(() => {
            if (!PdfState.currentPdfDoc) return;
            if (Math.abs(deps.currentPageAtViewport() - page) > REALIGN_PAGE_TOLERANCE) return;
            deps.ensureGeometry();
            setScrollTop(topForPage(page));
            anchorAlignment(page);
        });
    }

    function jumpToPage(pageNumber: number, yCss: number | null = null, center = false) {
        const pageCount = deps.getPageCount();
        if (pageCount === 0 || !PdfState.currentPdfDoc) return;
        const page = Math.max(1, Math.min(pageCount, Math.round(pageNumber)));
        deps.mountAroundPage(page);
        deps.scheduleRender();
        const precise = yCss !== null && yCss > 0;

        const jump = () => {
            const target = document.getElementById(`page-container-${page}`);
            const scroll = deps.getScrollContainer();
            if (!target || !scroll) return;
            if (!precise && scrollMode() === "snap") {
                deps.ensureGeometry();
                setScrollTop(topForPage(page));
                anchorAlignment(page);
                return;
            }
            const pageRect = target.getBoundingClientRect();
            const pageHeight = pageRect.height || deps.getPageHeight(page);
            const y = yCss == null ? (center ? pageHeight / 2 : 0) : Math.max(0, Math.min(yCss, pageHeight - 1));
            const base = pageRect.top - scroll.getBoundingClientRect().top + scroll.scrollTop;
            const top = center ? Math.max(0, base + y - scroll.clientHeight / 2) : base + y;
            if (precise) suspendSnap();
            setScrollTop(top);
        };
        jump();
        if (deps.isPageMeasured(page)) return;
        void deps.measureAround(page).then(() => {
            if (!PdfState.currentPdfDoc) return;
            if (Math.abs(deps.currentPageAtViewport() - page) > REALIGN_PAGE_TOLERANCE) return;
            jump();
        });
    }

    function stepPage(direction: number) {
        if (scrollMode() !== "snap") return;
        const scroll = deps.getScrollContainer();
        const pageCount = deps.getPageCount();
        if (!scroll || pageCount === 0 || !PdfState.currentPdfDoc) return;
        const current = Math.min(pageCount, Math.max(1, deps.currentPageAtViewport()));
        const viewport = viewportHeight() || 1;

        if (pageIsLong(current)) {
            const top = deps.getPageTop(current);
            const last = pageEndTop(current);
            const target = scroll.scrollTop + direction * viewport * 0.9;
            if (target > top - 0.5 && target < last + 0.5) {
                setScrollTop(target);
                return;
            }
        }

        const next = Math.min(pageCount, Math.max(1, deps.getRowStart(current, direction)));
        if (next === current) return;
        deps.mountAroundPage(next);
        deps.ensureGeometry();
        setScrollTop(direction < 0 ? pageEndTop(next) : alignedTopForPage(next));
        anchorAlignment(next);
        deps.scheduleRender();
    }

    function alignToSpread() {
        if (!PdfState.isSpreadMode || snapSuspended) return;
        const scroll = deps.getScrollContainer();
        if (!scroll || deps.getPageCount() === 0) return;
        const page = deps.currentPageAtViewport();
        if (pageIsLong(page)) return;
        setScrollTop(alignedTopForPage(page));
    }

    function normalizeWheelDelta(event: WheelEvent): number {
        if (event.deltaMode === 1) return event.deltaY * 16;
        if (event.deltaMode === 2) return event.deltaY * (viewportHeight() || 400);
        return event.deltaY;
    }

    function handleWheel(event: WheelEvent) {
        if (!PdfState.isSnapMode || event.ctrlKey || event.metaKey || event.altKey || event.deltaY === 0) return;
        const scroll = deps.getScrollContainer();
        if (!scroll || deps.getPageCount() === 0) return;
        if (snapSuspended) resumeSnap();

        event.preventDefault();
        wheelAccumulator += normalizeWheelDelta(event);
        const now = performance.now();
        if (now < wheelLockUntil) return;
        if (Math.abs(wheelAccumulator) < WHEEL_STEP_DISTANCE) return;
        const direction = wheelAccumulator > 0 ? 1 : -1;
        wheelAccumulator = 0;
        wheelLockUntil = now + WHEEL_STEP_COOLDOWN_MS;
        stepPage(direction);
    }

    function attachScrollContainer(scroll: HTMLElement) {
        detachScrollContainer();
        wheelContainer = scroll;
        wheelContainer.addEventListener("wheel", handleWheel, { passive: false });
    }

    function detachScrollContainer() {
        wheelContainer?.removeEventListener("wheel", handleWheel);
        wheelContainer = null;
        wheelAccumulator = 0;
        wheelLockUntil = 0;
        anchoredPage = null;
    }

    function setSidebarFollowSuppressed(value: boolean) {
        followSuppressed = value;
    }

    function toggleSidebarFollow(): boolean {
        PdfState.sidebarFollow = !PdfState.sidebarFollow;
        setSidebarFollowLabel(PdfState.sidebarFollow);
        if (PdfState.sidebarFollow) deps.refreshSidebar(true);
        return PdfState.sidebarFollow;
    }

    function reset() {
        clearSnapResumeHandler();
        detachScrollContainer();
        snapSuspended = false;
        followSuppressed = false;
    }

    return {
        alignToSpread,
        applySettings,
        attachScrollContainer,
        captureLocation,
        detachScrollContainer,
        goToPage,
        isSnapSuspended: () => snapSuspended,
        jumpToPage,
        refreshSnapAnchor,
        resumeSnap,
        restorePosition,
        restoreScrollPosition,
        scrollTopForLocation,
        setSidebarFollowSuppressed,
        setZoom,
        stepPage,
        toggleSidebarFollow,
        reset,
        isFollowSuppressed: () => followSuppressed
    };
}
