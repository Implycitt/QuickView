import header from "../html/header.html?raw";
import keybindsModal from "../html/keybindsModal.html?raw";
import mainContent from "../html/mainContent.html?raw";
import searchOverlay from "../html/searchOverlay.html?raw";
import sidebar from "../html/sidebar.html?raw";
import titlebar from "../html/titlebar.html?raw";

export function renderApplicationShell(): string {
    const workspace = `<div id="app-shell" class="flex min-h-0 min-w-0 flex-1 overflow-hidden gap-1">${sidebar}${mainContent}</div>`;
    return [titlebar, header, workspace, searchOverlay, keybindsModal].join("\n");
}
