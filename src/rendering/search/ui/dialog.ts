import { DOM, toggleSidebar } from "../../../ui/core/dom.js";
import type { SearchResult } from "../core/types.js";
import { markdownBlocks } from "../markdown/index.js";

let sidebarRestore = false;
let selectedIndex = 0;
let results: SearchResult[] = [];
let resultMode: "pdf" | "md" | null = null;

export function updateSearchDialog(resultsIn: SearchResult[], mode: "pdf" | "md" | null) {
    results = resultsIn;
    resultMode = mode;
    selectedIndex = Math.min(selectedIndex, Math.max(0, results.length - 1));
}

export function openSearch(search: (query: string) => void) {
    if (markdownBlocks.length === 0 && !document.getElementById("pdf-scroll-container")) return;
    const overlay = document.getElementById("search-overlay");
    const input = document.getElementById("search-input") as HTMLInputElement | null;
    if (!overlay || !input) return;
    if (!overlay.classList.contains("hidden")) {
        input.focus();
        return;
    }
    sidebarRestore = !!DOM.sidebar && DOM.sidebar.style.width !== "0px";
    if (sidebarRestore) toggleSidebar("closed");
    overlay.classList.remove("hidden");
    input.value = "";
    selectedIndex = 0;
    search("");
    input.focus();
}

export function closeSearchDialog() {
    const overlay = document.getElementById("search-overlay");
    if (!overlay || overlay.classList.contains("hidden")) return;
    overlay.classList.add("hidden");
    const input = document.getElementById("search-input") as HTMLInputElement | null;
    if (input) input.value = "";
    if (sidebarRestore && DOM.sidebar && DOM.sidebar.style.width === "0px") toggleSidebar("open");
    sidebarRestore = false;
}

export function initSearchDialog(search: (query: string) => void, select: (index: number) => void, close: () => void) {
    const input = document.getElementById("search-input") as HTMLInputElement | null;
    if (!input) return;
    const closeIfOpen = () => {
        if (document.getElementById("search-overlay")?.classList.contains("hidden")) return;
        closeSearchDialog();
        close();
    };
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    input.addEventListener("input", () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => search(input.value), 120);
    });
    input.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            event.preventDefault();
            closeIfOpen();
        } else if (event.key === "Enter") {
            event.preventDefault();
            select(selectedIndex);
            input.focus();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            moveSelection(event.key === "ArrowDown" ? 1 : -1, select);
        }
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !document.getElementById("search-overlay")?.classList.contains("hidden")) {
            closeIfOpen();
        }
    });
}

function moveSelection(direction: number, select: (index: number) => void) {
    const list = document.getElementById("search-results");
    if (!list || list.children.length === 0) return;
    selectedIndex = Math.max(0, Math.min(list.children.length - 1, selectedIndex + direction));
    for (let index = 0; index < list.children.length; index++) {
        list.children[index].classList.toggle("search-result-selected", index === selectedIndex);
    }
    (list.children[selectedIndex] as HTMLElement).scrollIntoView({ block: "nearest" });
    if (results[selectedIndex] && resultMode) select(selectedIndex);
}
