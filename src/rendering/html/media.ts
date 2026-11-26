const LOCAL_ASSET_SCHEME = "quickview-asset://media";

function pathSegments(filePath: string): string[] {
    const normalized = filePath.replace(/\\/g, "/");
    if (normalized.startsWith("//")) return ["_unc", ...normalized.slice(2).split("/")];
    if (/^[a-z]:\//i.test(normalized)) {
        const [drive, ...rest] = normalized.split("/");
        return [drive, ...rest];
    }
    return ["_abs", ...normalized.replace(/^\/+/, "").split("/")];
}

export function htmlDocumentUrl(filePath: string): string {
    const encodedPath = pathSegments(filePath)
        .map(segment => encodeURIComponent(segment))
        .join("/");
    return `${LOCAL_ASSET_SCHEME}/${encodedPath}`;
}

export function htmlUrlToPath(url: URL): string | null {
    if (url.protocol !== "quickview-asset:" || url.hostname !== "media") return null;
    try {
        const parts = url.pathname
            .split("/")
            .filter(Boolean)
            .map(part => decodeURIComponent(part));
        if (parts[0] === "_unc") {
            const [host, ...rest] = parts.slice(1);
            return host && rest.length ? `//${host}/${rest.join("/")}` : null;
        }
        if (parts[0] === "_abs") return `/${parts.slice(1).join("/")}`;
        if (/^[a-z]:$/i.test(parts[0] ?? "")) return parts.join("/");
        return parts.length ? parts.join("/") : null;
    } catch {
        return null;
    }
}
