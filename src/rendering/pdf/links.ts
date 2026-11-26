import { jumpToPdfPage } from "./state.js";
import type { PdfPageLike, PdfViewport } from "./types.js";

const LINK_PAD_X = 1;
const LINK_PAD_Y = 0.5;

interface LineBox {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

function linkHotspotRects(rect: number[], quadPoints: number[] | undefined): number[][] {
    const rects: number[][] = [];
    if (quadPoints && quadPoints.length >= 8) {
        for (let i = 2; i + 3 < quadPoints.length; i += 8) {
            const trX = quadPoints[i];
            const trY = quadPoints[i + 1];
            const blX = quadPoints[i + 2];
            const blY = quadPoints[i + 3];
            rects.push([Math.min(blX, trX), Math.min(blY, trY), Math.max(blX, trX), Math.max(blY, trY)]);
        }
    }
    if (rects.length === 0) rects.push(rect);
    return rects;
}

function textLineBoxes(container: HTMLElement): LineBox[] {
    const layer = container.querySelector(".text-layer");
    if (!layer) return [];
    const origin = container.getBoundingClientRect();
    const lines: LineBox[] = [];
    for (const span of layer.querySelectorAll<HTMLElement>("span")) {
        if (span.classList.contains("markedContent") || !span.textContent) continue;
        const rect = span.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const box = {
            left: rect.left - origin.left,
            right: rect.right - origin.left,
            top: rect.top - origin.top,
            bottom: rect.bottom - origin.top
        };
        const line = lines.find(item => box.top < item.bottom - 1 && box.bottom > item.top + 1);
        if (line) {
            line.left = Math.min(line.left, box.left);
            line.right = Math.max(line.right, box.right);
            line.top = Math.min(line.top, box.top);
            line.bottom = Math.max(line.bottom, box.bottom);
        } else {
            lines.push({ ...box });
        }
    }
    return lines;
}

function clipHotspotToText(box: number[], lines: LineBox[], output: number[][]) {
    if (lines.length === 0) {
        output.push(box);
        return;
    }
    const [x, y, width, height] = box;
    const right = x + width;
    const bottom = y + height;
    let covered = false;
    for (const line of lines) {
        const left = Math.max(x, line.left);
        const lineRight = Math.min(right, line.right);
        const top = Math.max(y, line.top);
        const lineBottom = Math.min(bottom, line.bottom);
        if (lineRight - left < 1 || lineBottom - top < 1) continue;
        covered = true;
        output.push([
            left - LINK_PAD_X,
            top - LINK_PAD_Y,
            lineRight - left + LINK_PAD_X * 2,
            lineBottom - top + LINK_PAD_Y * 2
        ]);
    }
    if (!covered) output.push(box);
}

export async function addPageLinkLayer(
    page: PdfPageLike,
    container: HTMLElement,
    viewport: PdfViewport,
    resolveDestination: (dest: unknown) => Promise<{ page: number; y: number | null } | null>
) {
    try {
        const annotations = await page.getAnnotations();
        const links = annotations.filter(annotation => annotation.subtype === "Link");
        if (links.length === 0) return;
        container.querySelectorAll(".pdf-link-layer").forEach(element => element.remove());
        const layer = document.createElement("div");
        layer.className = "pdf-link-layer";
        const lines = textLineBoxes(container);

        for (const annotation of links) {
            if (!annotation.rect || annotation.rect.length !== 4) continue;
            const href = typeof annotation.url === "string" && annotation.url.length > 0 ? annotation.url : null;
            const destination = href ? null : annotation.dest;
            if (!href && !destination) continue;
            const boxes: number[][] = [];
            for (const rect of linkHotspotRects(annotation.rect, annotation.quadPoints)) {
                const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect);
                const width = Math.abs(x2 - x1);
                const height = Math.abs(y2 - y1);
                if (width < 0.5 || height < 0.5) continue;
                clipHotspotToText([Math.min(x1, x2), Math.min(y1, y2), width, height], lines, boxes);
            }
            for (const [x, y, width, height] of boxes) {
                const element = document.createElement("a");
                element.className = "pdf-link";
                element.style.left = `${x}px`;
                element.style.top = `${y}px`;
                element.style.width = `${width}px`;
                element.style.height = `${height}px`;
                if (href) configureExternalLink(element, href);
                else configureInternalLink(element, destination, resolveDestination);
                layer.appendChild(element);
            }
        }
        if (layer.childElementCount > 0) container.appendChild(layer);
    } catch {}
}

function configureExternalLink(element: HTMLAnchorElement, href: string) {
    element.href = href;
    element.target = "_blank";
    element.rel = "noopener";
    element.title = href;
    element.addEventListener("click", event => {
        event.preventDefault();
        void window.electronAPI.openExternal(href);
    });
}

function configureInternalLink(
    element: HTMLAnchorElement,
    destination: unknown,
    resolveDestination: (dest: unknown) => Promise<{ page: number; y: number | null } | null>
) {
    element.href = "#";
    element.addEventListener("click", event => {
        event.preventDefault();
        void resolveDestination(destination).then(target => {
            if (target) jumpToPdfPage(target.page, target.y);
        });
    });
}
