import { BREADCRUMB_SEPARATOR, setBreadcrumbPath } from "../../ui/core/breadcrumb.js";
import { DOM } from "../../ui/core/dom.js";

let mdFileName: string | null = null;
let mdHeadings: HTMLElement[] = [];
let mdScroller: HTMLElement | null = null;

export function initMdBreadcrumb(fileName: string, scroller: HTMLElement) {
    if (mdScroller && mdScroller !== scroller) mdScroller.removeEventListener("scroll", syncMdBreadcrumb);
    mdFileName = fileName;
    mdHeadings = Array.from(scroller.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"));
    if (mdScroller !== scroller) scroller.addEventListener("scroll", syncMdBreadcrumb, { passive: true });
    mdScroller = scroller;
    syncMdBreadcrumb();
}

export function clearMdBreadcrumb() {
    mdScroller?.removeEventListener("scroll", syncMdBreadcrumb);
    mdScroller = null;
    mdFileName = null;
    mdHeadings = [];
    setBreadcrumbPath(null);
}

function headingLevel(element: HTMLElement): number {
    return parseInt(element.tagName.charAt(1), 10);
}

function headingPath(index: number): string[] {
    const path: string[] = [];
    let minLevel = headingLevel(mdHeadings[index]);
    for (let i = index - 1; i >= 0; i--) {
        const level = headingLevel(mdHeadings[i]);
        if (level < minLevel) {
            path.unshift(mdHeadings[i].textContent?.trim() || "(untitled)");
            minLevel = level;
        }
    }
    path.push(mdHeadings[index].textContent?.trim() || "(untitled)");
    return path;
}

function syncMdBreadcrumb() {
    if (!mdFileName) {
        setBreadcrumbPath(null);
        return;
    }
    let path = mdFileName;
    if (mdHeadings.length > 0 && DOM.mainContentNode) {
        const scroller = DOM.mainContentNode;
        const mid = scroller.scrollTop + (scroller.clientHeight || 1) / 2;
        let bestIndex = -1;
        for (let i = 0; i < mdHeadings.length; i++) {
            const top =
                mdHeadings[i].getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
            if (top <= mid) bestIndex = i;
            else break;
        }
        if (bestIndex >= 0) {
            path = `${mdFileName}${BREADCRUMB_SEPARATOR}${headingPath(bestIndex).join(BREADCRUMB_SEPARATOR)}`;
        }
    }
    setBreadcrumbPath(path);
}
