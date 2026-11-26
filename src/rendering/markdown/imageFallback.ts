const imageFallbackListeners = new WeakMap<HTMLImageElement, { sourceKey: string; listener: () => void }>();

function imageSourceKey(img: HTMLImageElement): string {
    return JSON.stringify([img.getAttribute("src"), img.getAttribute("srcset"), img.getAttribute("sizes")]);
}

function imageDisplayName(img: HTMLImageElement): string {
    try {
        const src = img.currentSrc || img.getAttribute("src") || "";
        const url = new URL(src, document.baseURI);
        const name = decodeURIComponent(url.pathname.split("/").pop() || "image");
        return img.getAttribute("alt") || name;
    } catch {
        return img.getAttribute("alt") || img.getAttribute("src") || "image";
    }
}

function placeholderIcon(): SVGSVGElement {
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("width", "16");
    icon.setAttribute("height", "16");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", "currentColor");
    icon.setAttribute("stroke-width", "1.8");
    icon.innerHTML =
        '<rect x="3" y="4" width="18" height="16" rx="2"></rect>' +
        '<path d="M8 10h.01M8.5 15l3-3 2.5 2.5 3-3 1.5 1.5"></path>' +
        '<path d="M4 4l16 16" stroke-linecap="round"></path>';
    return icon;
}

function makePlaceholder(alt: string): HTMLElement {
    const placeholder = document.createElement("span");
    placeholder.className = "md-img-placeholder";
    placeholder.setAttribute("role", "img");
    placeholder.setAttribute("aria-label", `${alt} (image not found)`);
    const label = document.createElement("span");
    label.textContent = alt;
    const hint = document.createElement("span");
    hint.className = "md-img-placeholder-hint";
    hint.textContent = "not found";
    placeholder.append(placeholderIcon(), label, hint);
    return placeholder;
}

export function attachImageFallbacks(root: HTMLElement) {
    root.querySelectorAll("img").forEach(img => {
        const sourceKey = imageSourceKey(img);
        const existing = imageFallbackListeners.get(img);
        if (existing?.sourceKey === sourceKey) return;
        if (existing) img.removeEventListener("error", existing.listener);
        const onError = () => {
            if (!img.isConnected || img.naturalWidth > 0 || imageSourceKey(img) !== sourceKey) return;
            img.replaceWith(makePlaceholder(imageDisplayName(img)));
        };
        imageFallbackListeners.set(img, { sourceKey, listener: onError });
        img.addEventListener("error", onError, { once: true });
    });
}
