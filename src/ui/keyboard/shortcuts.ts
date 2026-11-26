import { toggleSidebarFollow } from "../../rendering/pdf/renderer.js";
import { runSearch } from "../../rendering/search/controller.js";
import { openSearch } from "../../rendering/search/ui/dialog.js";
import { openThemePicker } from "../app/colorSchemes.js";
import { DOM, setSidebarTab, toggleKeybindsModal, toggleSidebar } from "../core/dom.js";

const SHORTCUTS: Record<string, (event: KeyboardEvent) => void> = {
    "/": event => {
        event.preventDefault();
        toggleKeybindsModal();
    },
    ";": event => {
        event.preventDefault();
        openSearch(runSearch);
    },
    ":": event => {
        event.preventDefault();
        openSearch(runSearch);
    },
    escape: event => {
        if (DOM.keybindsModal?.classList.contains("hidden")) return;
        event.preventDefault();
        toggleKeybindsModal();
    },
    m: event => {
        event.preventDefault();
        DOM.toggleScrollModeBtn?.click();
    },
    b: event => {
        event.preventDefault();
        DOM.toggleSpreadModeBtn?.click();
    },
    s: event => {
        event.preventDefault();
        toggleSidebar();
    },
    o: event => {
        event.preventDefault();
        setSidebarTab(DOM.sidebarPreviews.classList.contains("hidden") ? "previews" : "sections");
    },
    t: event => {
        event.preventDefault();
        openThemePicker();
    },
    l: event => {
        event.preventDefault();
        toggleSidebarFollow();
    },
    i: event => {
        event.preventDefault();
        DOM.magnifierToggleBtn?.click();
    },
    z: event => {
        event.preventDefault();
        DOM.zoomInBtn?.click();
    },
    x: event => {
        event.preventDefault();
        DOM.zoomOutBtn?.click();
    },
    f: event => {
        event.preventDefault();
        document.querySelector<HTMLButtonElement>(".file-picker-btn")?.click();
    },
    g: event => {
        event.preventDefault();
        DOM.pageCounter?.focus();
        DOM.pageCounter?.select();
    }
};

export function isTypingTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);
}

export function handleGlobalShortcut(event: KeyboardEvent): boolean {
    if ((document.getElementById("theme-picker-modal") as HTMLDialogElement | null)?.open) return true;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.shiftKey && event.key.toLowerCase() !== "t") return false;
    const shortcut = SHORTCUTS[event.key.toLowerCase()];
    if (!shortcut) return false;
    shortcut(event);
    return true;
}
