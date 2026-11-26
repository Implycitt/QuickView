import { normalize } from "./query.js";
import type { PageMatch } from "./types.js";

const NGRAM_SIZE = 3;
const PADDING_START = "$$";
const PADDING_WORD = "!$$";
const PADDING_END = "!";
const MIN_FUZZY_SIMILARITY = 0.5;
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

export interface TextMatch extends PageMatch {
    fuzzy: boolean;
}

function ngrams(value: string): Set<string> {
    const padded = PADDING_START + value.replaceAll(" ", PADDING_WORD) + PADDING_END;
    const grams = new Set<string>();

    for (let index = 0; index <= padded.length - NGRAM_SIZE; index++) {
        const gram = padded.slice(index, index + NGRAM_SIZE);
        if (gram.endsWith("$")) continue;
        grams.add(gram.includes("$") ? gram : [...gram].sort().join(""));
    }

    return grams;
}

function fuzzySimilarity(token: string, word: string): number {
    const tokenGrams = ngrams(token);
    const wordGrams = ngrams(word);
    const shared = [...tokenGrams].filter(gram => wordGrams.has(gram)).length;
    return shared / Math.max(tokenGrams.size, wordGrams.size);
}

function isWordCharacter(value: string | undefined): boolean {
    return value !== undefined && WORD_CHARACTER.test(value);
}

function literalOccurrences(text: string, token: string): TextMatch[] {
    const occurrences: TextMatch[] = [];

    for (let start = text.indexOf(token); start !== -1; start = text.indexOf(token, start + 1)) {
        const end = start + token.length;
        const wholeWord = !isWordCharacter(text[start - 1]) && !isWordCharacter(text[end]);
        occurrences.push({ start, end, fuzzy: !wholeWord });
    }

    return occurrences;
}

function fuzzyOccurrences(text: string, token: string): TextMatch[] {
    const normalizedToken = normalize(token);
    const occurrences: TextMatch[] = [];

    for (const match of text.matchAll(/\S+/g)) {
        if (fuzzySimilarity(normalizedToken, normalize(match[0])) < MIN_FUZZY_SIMILARITY) continue;
        const start = match.index ?? 0;
        occurrences.push({ start, end: start + match[0].length, fuzzy: true });
    }

    return occurrences;
}

function tokenOccurrences(text: string, token: string): TextMatch[] {
    const literal = literalOccurrences(text, token);
    return literal.length > 0 ? literal : fuzzyOccurrences(text, token);
}

function mergeRanges(occurrences: TextMatch[]): TextMatch[] {
    const sorted = [...occurrences].sort((left, right) => left.start - right.start);
    const ranges: TextMatch[] = [];

    for (const occurrence of sorted) {
        const last = ranges[ranges.length - 1];
        if (last && occurrence.start <= last.end) {
            last.end = Math.max(last.end, occurrence.end);
            last.fuzzy = last.fuzzy && occurrence.fuzzy;
            continue;
        }
        ranges.push({ ...occurrence });
    }

    return ranges;
}

export function matchText(text: string, tokens: string[]): TextMatch[] | null {
    if (tokens.length === 0 || text.length === 0) return null;

    const occurrences: TextMatch[] = [];

    for (const token of tokens) {
        const matches = tokenOccurrences(text, token);
        if (matches.length === 0) return null;
        occurrences.push(...matches);
    }

    return mergeRanges(occurrences);
}
