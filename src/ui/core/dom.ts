export const DOM = {} as {
    sidebar: HTMLElement;
    sidebarPreviews: HTMLElement;
    sidebarSections: HTMLElement;
    sidebarTabs: HTMLElement;
    tabPreviewsBtn: HTMLButtonElement;
    tabSectionsBtn: HTMLButtonElement;
    sidebarFollowBtn: HTMLButtonElement;
    sidebarToggle: HTMLButtonElement;
    sidebarResizer: HTMLElement;
    mainContentNode: HTMLElement;
    pdfTools: HTMLElement;
    toggleScrollModeBtn: HTMLButtonElement;
    toggleSpreadModeBtn: HTMLButtonElement;
    magnifierToggleBtn: HTMLButtonElement;
    zoomInBtn: HTMLButtonElement;
    zoomOutBtn: HTMLButtonElement;
    zoomLevelSpan: HTMLInputElement;
    pageCounter: HTMLInputElement;
    pageTotal: HTMLSpanElement;
    breadcrumb: HTMLSpanElement;
    keybindsToggleBtn: HTMLButtonElement;
    keybindsModal: HTMLElement;
    closeKeybindsBtn: HTMLButtonElement;
};

function requireElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`QuickView shell is missing required element #${id}.`);
    return element as T;
}

export function initDOM() {
    DOM.sidebar = requireElement("sidebar");
    DOM.sidebarPreviews = requireElement("sidebar-previews");
    DOM.sidebarSections = requireElement("sidebar-sections");
    DOM.sidebarTabs = requireElement("sidebar-tabs");
    DOM.tabPreviewsBtn = requireElement("tab-previews");
    DOM.tabSectionsBtn = requireElement("tab-sections");
    DOM.sidebarFollowBtn = requireElement("sidebar-follow-btn");
    DOM.sidebarToggle = requireElement("sidebar-toggle");
    DOM.sidebarResizer = requireElement("sidebar-resizer");
    DOM.mainContentNode = requireElement("main-content");
    DOM.pdfTools = requireElement("pdf-tools");
    DOM.toggleScrollModeBtn = requireElement("toggle-scroll-mode");
    DOM.toggleSpreadModeBtn = requireElement("toggle-spread-mode");
    DOM.magnifierToggleBtn = requireElement("toggle-magnifier");
    DOM.zoomInBtn = requireElement("zoom-in");
    DOM.zoomOutBtn = requireElement("zoom-out");
    DOM.zoomLevelSpan = requireElement("zoom-level");
    DOM.pageCounter = requireElement("page-counter");
    DOM.pageTotal = requireElement("page-total");
    DOM.breadcrumb = requireElement("breadcrumb");
    DOM.keybindsToggleBtn = requireElement("keybinds-toggle");
    DOM.keybindsModal = requireElement("keybinds-modal");
    DOM.closeKeybindsBtn = requireElement("close-keybinds");
}

let savedSidebarWidth = "280px";
export function getSavedSidebarWidth(): number {
    const width = parseFloat(savedSidebarWidth);
    return Number.isFinite(width) && width > 0 ? width : 280;
}

export function getSidebarTargetWidth(): number {
    const width = parseFloat(DOM.sidebar?.style.width || savedSidebarWidth);
    return Number.isFinite(width) && width > 0 ? width : getSavedSidebarWidth();
}

export function setSavedSidebarWidth(width: number) {
    if (!Number.isFinite(width)) return;
    savedSidebarWidth = `${Math.max(150, Math.min(600, width))}px`;
    if (DOM.sidebar && DOM.sidebar.style.width !== "0px") DOM.sidebar.style.width = savedSidebarWidth;
}

const SIDEBAR_TRANSITION_CLASSES = ["transition-[width]", "duration-300"];

export function toggleSidebar(forceState?: "open" | "closed", animate = true) {
    if (!DOM.sidebar) return;

    const isClosed = DOM.sidebar.style.width === "0px";
    const applyWidth = (width: string) => {
        if (animate) {
            DOM.sidebar.style.width = width;
            return;
        }
        DOM.sidebar.classList.remove(...SIDEBAR_TRANSITION_CLASSES);
        DOM.sidebar.style.width = width;
        void DOM.sidebar.offsetWidth;
        DOM.sidebar.classList.add(...SIDEBAR_TRANSITION_CLASSES);
    };

    if (forceState === "open" || (!forceState && isClosed)) {
        applyWidth(savedSidebarWidth);
        window.dispatchEvent(new CustomEvent("qv:sidebar-toggled", { detail: { opened: true } }));
        window.dispatchEvent(new Event("qv:sidebar-width-changed"));
    } else {
        if (!isClosed) {
            savedSidebarWidth = DOM.sidebar.style.width || "280px";
        }
        applyWidth("0px");
        window.dispatchEvent(new CustomEvent("qv:sidebar-toggled", { detail: { opened: false } }));
        window.dispatchEvent(new Event("qv:sidebar-width-changed"));
    }
}

export function setSidebarFollowLabel(follow: boolean) {
    if (!DOM.sidebarFollowBtn) return;
    const locked = document.getElementById("follow-icon-locked");
    const unlocked = document.getElementById("follow-icon-unlocked");
    locked?.classList.toggle("hidden", !follow);
    unlocked?.classList.toggle("hidden", follow);
    DOM.sidebarFollowBtn.classList.toggle("sidebar-follow-active", follow);
    DOM.sidebarFollowBtn.setAttribute("aria-pressed", String(follow));
}

export function setSidebarTab(tab: "previews" | "sections") {
    if (!DOM.sidebarPreviews || !DOM.sidebarSections || !DOM.tabPreviewsBtn || !DOM.tabSectionsBtn) return;
    const previews = tab === "previews";
    DOM.sidebarPreviews.classList.toggle("hidden", !previews);
    DOM.sidebarSections.classList.toggle("hidden", previews);
    DOM.tabPreviewsBtn.classList.toggle("sidebar-tab-active", previews);
    DOM.tabSectionsBtn.classList.toggle("sidebar-tab-active", !previews);
    DOM.tabPreviewsBtn.setAttribute("aria-selected", String(previews));
    DOM.tabSectionsBtn.setAttribute("aria-selected", String(!previews));
    window.dispatchEvent(new Event("qv:sidebar-tab-changed"));
}

export type ScrollMode = "snap" | "free";

export function getScrollMode(container: HTMLElement | null | undefined): ScrollMode {
    return container?.dataset.scrollMode === "snap" ? "snap" : "free";
}

export function updateScrollModeClasses(isSnapMode: boolean) {
    if (!DOM.toggleScrollModeBtn) return;
    DOM.toggleScrollModeBtn.innerText = `Mode: ${isSnapMode ? "Snap" : "Free"}`;
}

export function updateSpreadModeClasses(isSpreadMode: boolean) {
    if (!DOM.toggleSpreadModeBtn) return;
    DOM.toggleSpreadModeBtn.innerText = `Book: ${isSpreadMode ? "On" : "Off"}`;
    DOM.toggleSpreadModeBtn.setAttribute("aria-pressed", String(isSpreadMode));
}

export function updateMagnifierClasses(isMagnifierMode: boolean) {
    if (!DOM.magnifierToggleBtn) return;
    DOM.magnifierToggleBtn.setAttribute("aria-pressed", String(isMagnifierMode));
    document.body.classList.toggle("qv-magnifier-on", isMagnifierMode);
}

export function initSidebarResizer() {
    const sidebar = DOM.sidebar;
    const resizer = DOM.sidebarResizer;

    if (!sidebar || !resizer) return;

    let isResizing = false;

    resizer.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const current = parseFloat(sidebar.style.width) || getSavedSidebarWidth();
        setSavedSidebarWidth(current + direction * (event.shiftKey ? 40 : 16));
        resizer.setAttribute("aria-valuenow", String(Math.round(getSavedSidebarWidth())));
        window.dispatchEvent(new Event("qv:sidebar-resized"));
        window.dispatchEvent(new Event("resize"));
    });

    resizer.addEventListener("mousedown", () => {
        isResizing = true;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        sidebar.classList.remove("transition-[width]", "duration-300");
    });

    document.addEventListener("mousemove", e => {
        if (!isResizing) return;

        const newWidth = e.clientX;

        if (newWidth > 150 && newWidth < 600) {
            sidebar.style.width = `${newWidth}px`;
            resizer.setAttribute("aria-valuenow", String(Math.round(newWidth)));
            window.dispatchEvent(new Event("qv:sidebar-resized"));
        }
    });

    document.addEventListener("mouseup", () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            sidebar.classList.add("transition-[width]", "duration-300");
            savedSidebarWidth = sidebar.style.width || savedSidebarWidth;
            resizer.setAttribute("aria-valuenow", String(Math.round(getSavedSidebarWidth())));
            window.dispatchEvent(new Event("qv:sidebar-width-changed"));
            window.dispatchEvent(new Event("resize"));
        }
    });
}

export function toggleKeybindsModal() {
    if (!DOM.keybindsModal) return;
    DOM.keybindsModal.classList.toggle("hidden");
}
