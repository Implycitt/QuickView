import {
    applyPdfViewerSettings,
    goToPage,
    renderAllMainPages,
    renderThumbnails,
    refreshSidebarSync,
    setPdfSpreadMode,
    toggleSidebarFollow
} from "../../rendering/pdf/renderer.js";
import { PdfState } from "../../rendering/pdf/state.js";
import type { FileResponse } from "../../types/types.d.ts";
import { DOM, toggleSidebar, toggleKeybindsModal, setSidebarTab, setSidebarFollowLabel } from "../core/dom.js";

interface ViewerControlDependencies {
    openDocument: (content: FileResponse) => Promise<void>;
    onStateChanged: () => void;
}

export function bindViewerControls({ openDocument, onStateChanged }: ViewerControlDependencies) {
    DOM.closeKeybindsBtn?.addEventListener("click", toggleKeybindsModal);
    document.querySelector<HTMLButtonElement>("#empty-state .file-picker-btn")?.addEventListener("click", () => {
        document.getElementById("choose-file-button")?.click();
    });
    DOM.keybindsToggleBtn?.addEventListener("click", toggleKeybindsModal);
    window.addEventListener("click", event => {
        if (event.target === DOM.keybindsModal) toggleKeybindsModal();
    });

    DOM.sidebarToggle?.addEventListener("click", () => toggleSidebar());
    DOM.tabPreviewsBtn?.addEventListener("click", () => setSidebarTab("previews"));
    DOM.tabSectionsBtn?.addEventListener("click", () => setSidebarTab("sections"));
    DOM.sidebarFollowBtn?.addEventListener("click", toggleSidebarFollow);
    setSidebarFollowLabel(PdfState.sidebarFollow);

    window.addEventListener("qv:sidebar-tab-changed", () => {
        refreshSidebarSync(true);
        if (!DOM.sidebarPreviews.classList.contains("hidden")) renderThumbnails();
    });
    window.addEventListener("qv:sidebar-toggled", event => {
        if ((event as CustomEvent).detail?.opened) {
            setTimeout(() => {
                refreshSidebarSync(true);
                if (!DOM.sidebarPreviews.classList.contains("hidden")) renderThumbnails();
            }, 350);
            return;
        }
        refreshSidebarSync();
    });
    window.addEventListener("qv:sidebar-width-changed", () => {
        if (!DOM.sidebarPreviews.classList.contains("hidden")) renderThumbnails();
    });

    DOM.toggleScrollModeBtn?.addEventListener("click", () => {
        PdfState.isSnapMode = !PdfState.isSnapMode;
        applyPdfViewerSettings({
            isSnapMode: PdfState.isSnapMode,
            snapSuspended: false,
            sidebarFollow: PdfState.sidebarFollow,
            isSpreadMode: PdfState.isSpreadMode
        });
        onStateChanged();
    });
    DOM.toggleSpreadModeBtn?.addEventListener("click", () => {
        setPdfSpreadMode(!PdfState.isSpreadMode);
        onStateChanged();
    });
    DOM.zoomInBtn?.addEventListener("click", () => {
        PdfState.zoomMode = "manual";
        PdfState.currentScale = Math.min(9.99, Math.round((PdfState.currentScale + 0.2) * 100) / 100);
        if (DOM.zoomLevelSpan) DOM.zoomLevelSpan.value = `${Math.round(PdfState.currentScale * 100)}%`;
        onStateChanged();
        void renderAllMainPages().then(onStateChanged);
    });
    DOM.zoomOutBtn?.addEventListener("click", () => {
        if (PdfState.currentScale <= 0.4) return;
        PdfState.zoomMode = "manual";
        PdfState.currentScale = Math.max(0.1, Math.round((PdfState.currentScale - 0.2) * 100) / 100);
        if (DOM.zoomLevelSpan) DOM.zoomLevelSpan.value = `${Math.round(PdfState.currentScale * 100)}%`;
        onStateChanged();
        void renderAllMainPages().then(onStateChanged);
    });

    DOM.pageCounter?.addEventListener("change", () => {
        if (!PdfState.currentPdfDoc) {
            DOM.pageCounter.value = "1";
            return;
        }
        const parsed = parseInt(DOM.pageCounter.value, 10);
        const page = Math.max(1, Math.min(PdfState.currentPdfDoc.numPages, Number.isNaN(parsed) ? 1 : parsed));
        if (DOM.pageCounter.value !== String(page)) DOM.pageCounter.value = String(page);
        DOM.pageCounter.dataset.current = String(page);
        goToPage(page);
    });
    DOM.pageCounter?.addEventListener("keydown", event => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        else if (event.key === "Escape") {
            const input = event.target as HTMLInputElement;
            input.value = input.dataset.current || "1";
            input.blur();
        }
    });
    DOM.zoomLevelSpan?.addEventListener("change", event => {
        const input = event.target as HTMLInputElement;
        const zoom = parseFloat(input.value.replace("%", ""));
        if (!Number.isNaN(zoom) && zoom > 10 && zoom < 1000) {
            PdfState.zoomMode = "manual";
            PdfState.currentScale = zoom / 100;
            void renderAllMainPages().then(onStateChanged);
            onStateChanged();
        } else {
            input.value = `${Math.round(PdfState.currentScale * 100)}%`;
        }
    });

    document.getElementById("choose-file-button")?.addEventListener("click", async () => {
        try {
            const content = await window.electronAPI.pickAndReadFile();
            if (content) await openDocument(content);
        } catch (error) {
            console.error("Failed to read file", error);
            DOM.mainContentNode.innerHTML = '<p class="text-red-500 font-medium m-8">Error reading file.</p>';
        }
    });
}
