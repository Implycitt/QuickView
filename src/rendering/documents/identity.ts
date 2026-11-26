export function documentIdentity(
    path: string | null | undefined,
    name: string,
    type: "pdf" | "markdown" | "html"
): string {
    return JSON.stringify([type, normalizePath(path || name)]);
}

function normalizePath(path: string): string {
    const normalized = path.replace(/\\/g, "/");
    return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}
