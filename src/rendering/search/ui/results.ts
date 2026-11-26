import type { SearchMode, SearchResult } from "../core/types.js";
import { markdownBlocks, markdownBlockLabel } from "../markdown/index.js";
import { pageIndexes } from "../pdf/pageIndexStore.js";

export function renderEmpty() {
    const list = document.getElementById("search-results");
    const count = document.getElementById("search-count");
    if (!list || !count) return;
    list.innerHTML = "";
    count.textContent = "";
    const hint = document.createElement("div");
    hint.className = "search-result-empty";
    hint.textContent = "Type to fuzzy search…";
    list.appendChild(hint);
}

export function renderResults(
    results: SearchResult[],
    done: number,
    total: number,
    mode: SearchMode,
    selectedIndex: number,
    onSelect: (index: number) => void
) {
    const list = document.getElementById("search-results");
    const count = document.getElementById("search-count");
    if (!list || !count) return;
    selectedIndex = Math.min(selectedIndex, Math.max(0, results.length - 1));
    list.innerHTML = "";
    if (results.length === 0) {
        const empty = document.createElement("div");
        empty.className = "search-result-empty";
        empty.textContent = done === 0 ? "No matches yet…" : "No matches";
        list.appendChild(empty);
        count.textContent = done < total ? `${done}/${total} pages scanned` : "No matches";
        return;
    }

    count.textContent = `${results.length} match${results.length === 1 ? "" : "es"}${done < total ? ` · ${done}/${total} scanned` : ""}`;
    for (let index = 0; index < results.length; index++) {
        const result = results[index];
        const row = document.createElement("button");
        row.className = `search-result${index === selectedIndex ? " search-result-selected" : ""}`;
        row.addEventListener("mousedown", event => event.preventDefault());
        row.addEventListener("click", () => onSelect(index));

        const heading = document.createElement("span");
        heading.className = "search-result-head";
        const page = document.createElement("span");
        page.className = "search-result-page";
        page.textContent = mode === "md" ? markdownBlockLabel(result.page) : `Page ${result.page}`;
        const ordinal = document.createElement("span");
        ordinal.className = "search-result-index";
        ordinal.textContent = `${index + 1}/${results.length}`;
        heading.append(page, ordinal);

        const snippet = document.createElement("span");
        snippet.className = "search-result-snippet";
        const block = mode === "md" ? markdownBlocks[result.page] : undefined;
        const indexData = mode === "pdf" ? pageIndexes.get(result.page) : undefined;
        const text = mode === "md" ? (block?.text ?? "") : (indexData?.text ?? "");
        const start = Math.max(0, result.start - 32);
        const end = Math.min(text.length, result.end + 64);
        if (start < result.start) snippet.append(document.createTextNode(text.slice(start, result.start)));
        const mark = document.createElement("mark");
        mark.textContent = text.slice(result.start, result.end);
        snippet.append(mark);
        if (result.end < end) snippet.append(document.createTextNode(text.slice(result.end, end)));
        row.append(heading, snippet);
        list.appendChild(row);
    }
    (list.children[selectedIndex] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
}
