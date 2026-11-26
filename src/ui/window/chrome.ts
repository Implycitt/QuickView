import { BREADCRUMB_SEPARATOR } from "../core/breadcrumb.js";

type WindowState = { maximized: boolean };

export function initWindowChrome() {
    const api = window.electronAPI;
    const titlebar = document.getElementById("titlebar");
    const minimizeBtn = document.getElementById("window-minimize");
    const maximizeBtn = document.getElementById("window-maximize");
    const closeBtn = document.getElementById("window-close");
    const titleLabel = document.getElementById("titlebar-document");

    if (!api || api.platform !== "linux" || !titlebar || !minimizeBtn || !maximizeBtn || !closeBtn) {
        return;
    }

    document.body.classList.add("has-custom-titlebar");

    minimizeBtn.addEventListener("click", () => api.minimize());
    maximizeBtn.addEventListener("click", () => api.toggleMaximize());
    closeBtn.addEventListener("click", () => api.closeWindow());

    const applyState = (state: WindowState) => {
        maximizeBtn.classList.toggle("titlebar-btn-active", !!state?.maximized);
        const label = state?.maximized ? "Restore" : "Maximize";
        maximizeBtn.setAttribute("title", label);
        maximizeBtn.setAttribute("aria-label", label);
    };

    api.onWindowState(applyState);
    void api.getWindowState().then(applyState);

    const breadcrumb = document.getElementById("breadcrumb");
    if (titleLabel && breadcrumb) {
        const syncTitleLabel = () => {
            const trail = (breadcrumb.title || breadcrumb.textContent || "").trim();
            const name = trail.split(BREADCRUMB_SEPARATOR)[0] || "QuickView";
            titleLabel.textContent = name;
            titleLabel.title = trail || "QuickView";
            document.title = name;
        };
        new MutationObserver(syncTitleLabel).observe(breadcrumb, {
            attributes: true,
            attributeFilter: ["title"],
            childList: true,
            characterData: true,
            subtree: true
        });
        syncTitleLabel();
    }
}
