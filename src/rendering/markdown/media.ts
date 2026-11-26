const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;

function filePathToUrl(filePath: string): URL {
    const normalizedPath = filePath.replace(/\\/g, "/");
    if (normalizedPath.startsWith("//")) {
        const [, , host, ...segments] = normalizedPath.split("/");
        return new URL(`file://${host}/${segments.map(encodeURIComponent).join("/")}`);
    }
    if (/^[a-z]:\//i.test(normalizedPath)) {
        const [drive, ...segments] = normalizedPath.split("/");
        return new URL(`file:///${drive}/${segments.map(encodeURIComponent).join("/")}`);
    }
    const encodedPath = normalizedPath
        .split("/")
        .map((segment, index) => (index === 0 && normalizedPath.startsWith("/") ? "" : encodeURIComponent(segment)))
        .join("/");
    return new URL(`file://${normalizedPath.startsWith("/") ? "" : "/"}${encodedPath}`);
}

function fileUrlToPath(url: URL): string {
    const pathname = decodeURIComponent(url.pathname);
    if (url.hostname) return `//${url.hostname}${pathname}`;
    const drive = pathname.slice(1, 3);
    return pathname.startsWith("/") && /^[a-z]:$/i.test(drive) ? pathname.slice(1) : pathname;
}

function localImageUrl(filePath: string): string {
    return `quickview-asset://media/?path=${encodeURIComponent(filePath)}`;
}

function resolveRelativeSrc(src: string, baseUrl: URL): string {
    if (!src || src.startsWith("#")) return src;
    if (/^[a-z]:[\\/]/i.test(src)) return filePathToUrl(src).href;
    if (URL_SCHEME.test(src) || src.startsWith("//")) return src;
    try {
        return new URL(src.replace(/\\/g, "/"), baseUrl).href;
    } catch {
        return src;
    }
}

function resolveImageSrc(src: string, baseUrl: URL): string {
    const resolved = resolveRelativeSrc(src, baseUrl);
    if (!resolved.toLowerCase().startsWith("file:")) return resolved;
    try {
        return localImageUrl(fileUrlToPath(new URL(resolved)));
    } catch {
        return resolved;
    }
}

function resolveSrcSet(srcset: string, baseUrl: URL, resolveSrc = resolveRelativeSrc): string {
    const candidates: string[] = [];
    let index = 0;
    while (index < srcset.length) {
        while (index < srcset.length && (srcset[index] === "," || /\s/.test(srcset[index]))) index++;
        if (index >= srcset.length) break;
        let src = "";
        while (index < srcset.length && !/\s/.test(srcset[index])) src += srcset[index++];
        let hadTrailingComma = false;
        while (src.endsWith(",")) {
            src = src.slice(0, -1);
            hadTrailingComma = true;
        }
        let descriptor = "";
        if (!hadTrailingComma) {
            while (index < srcset.length && /\s/.test(srcset[index])) index++;
            while (index < srcset.length && srcset[index] !== ",") descriptor += srcset[index++];
            if (index < srcset.length) index++;
        }
        if (src) {
            const resolved = resolveSrc(src, baseUrl);
            candidates.push(descriptor.trim() ? `${resolved} ${descriptor.trim()}` : resolved);
        }
    }
    return candidates.join(", ");
}

export function resolveMarkdownMedia(html: string, filePath: string): string {
    if (!filePath) return html;
    const baseUrl = new URL(".", filePathToUrl(filePath));
    const template = document.createElement("template");
    template.innerHTML = html;
    const attributes: Array<[string, string, "image" | "image-srcset" | "relative" | "srcset"]> = [
        ["img[src]", "src", "image"],
        ["img[srcset]", "srcset", "image-srcset"],
        ["picture source[src]", "src", "image"],
        ["picture source[srcset]", "srcset", "image-srcset"],
        ["image[href]", "href", "image"],
        ["image[xlink\\:href]", "xlink:href", "image"],
        ["source[src]", "src", "relative"],
        ["source[srcset]", "srcset", "srcset"],
        ["video[src]", "src", "relative"],
        ["video[poster]", "poster", "relative"],
        ["audio[src]", "src", "relative"],
        ["iframe[src]", "src", "relative"],
        ["embed[src]", "src", "relative"],
        ["object[data]", "data", "relative"]
    ];
    for (const [selector, attribute, resolver] of attributes) {
        template.content.querySelectorAll(selector).forEach(element => {
            if (selector.startsWith("source[") && element.parentElement?.tagName.toLowerCase() === "picture") return;
            const value = element.getAttribute(attribute);
            if (value === null) return;
            const resolved =
                resolver === "image"
                    ? resolveImageSrc(value, baseUrl)
                    : resolver === "image-srcset"
                      ? resolveSrcSet(value, baseUrl, resolveImageSrc)
                      : resolver === "srcset"
                        ? resolveSrcSet(value, baseUrl)
                        : resolveRelativeSrc(value, baseUrl);
            element.setAttribute(attribute, resolved);
        });
    }
    return template.innerHTML;
}
