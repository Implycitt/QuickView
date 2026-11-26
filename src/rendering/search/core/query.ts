import type { SearchResult } from "./types.js";

export function isWhitespace(code: number): boolean {
    return code === 32 || (code >= 9 && code <= 13);
}

export function normalize(value: string): string {
    return value
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}

export function normalizeBlock(raw: string): string {
    return raw.toLowerCase().replace(/\s+/g, " ").trim();
}

export function parseQuery(query: string): string[] {
    return normalizeBlock(query)
        .split(" ")
        .filter(token => token.length > 0);
}

export function sortResults(results: SearchResult[]) {
    results.sort(
        (left, right) => Number(left.fuzzy) - Number(right.fuzzy) || left.page - right.page || left.start - right.start
    );
}
