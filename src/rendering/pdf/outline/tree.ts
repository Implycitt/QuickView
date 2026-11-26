import type { PdfOutlineItem } from "../types.js";

interface OutlineTreeCallbacks {
    setParent: (row: HTMLElement, parent: HTMLElement | null) => void;
    setDestination: (row: HTMLElement, destination: unknown) => void;
    toggleChildren: () => void;
    navigate: (destination: unknown) => void;
}

export function buildOutlineItem(
    item: PdfOutlineItem,
    depth: number,
    parentRow: HTMLElement | null,
    callbacks: OutlineTreeCallbacks
): HTMLElement {
    const node = document.createElement("div");
    node.className = "outline-node";
    const row = document.createElement("div");
    row.className = "outline-item";
    row.style.paddingLeft = `${depth * 12 + 4}px`;
    callbacks.setParent(row, parentRow);

    const hasChildren = Array.isArray(item.items) && item.items.length > 0;
    const caret = document.createElement("span");
    caret.className = hasChildren ? "outline-caret" : "outline-caret outline-caret-placeholder";
    if (hasChildren) caret.textContent = "▸";
    row.appendChild(caret);

    const label = document.createElement("span");
    label.className = "outline-label";
    label.textContent = item.title || "(untitled)";
    if (item.bold) label.style.fontWeight = "700";
    if (item.italic) label.style.fontStyle = "italic";
    row.appendChild(label);
    node.appendChild(row);

    if (hasChildren) {
        const wrapper = document.createElement("div");
        wrapper.className = "outline-children";
        for (const child of item.items!) {
            wrapper.appendChild(buildOutlineItem(child, depth + 1, row, callbacks));
        }
        node.appendChild(wrapper);
        caret.addEventListener("click", event => {
            event.stopPropagation();
            wrapper.classList.toggle("hidden");
            row.classList.toggle("outline-collapsed");
            callbacks.toggleChildren();
        });
    }

    if (item.dest) {
        callbacks.setDestination(row, item.dest);
        row.addEventListener("click", () => callbacks.navigate(item.dest));
    }
    return node;
}
