import { normalizeBlock, sortResults, tokenMatch } from '../core/query.js';
import type { PageMatch, SearchResult } from '../core/types.js';

const MD_BLOCK_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, td, th, dt, dd';

export interface MarkdownBlock {
    text: string;
    element: HTMLElement;
}

export let markdownBlocks: MarkdownBlock[] = [];

let indexRoot: HTMLElement | null = null;
let indexDirty = false;

function buildIndex(root: HTMLElement) {
    const candidates = Array.from(root.querySelectorAll<HTMLElement>(MD_BLOCK_SELECTOR));
    const candidateSet = new Set<Element>(candidates);
    const blocks: MarkdownBlock[] = [];
    for (const element of candidates) {
        let nested = false;
        for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
            if (candidateSet.has(parent)) {
                nested = true;
                break;
            }
        }
        if (nested) continue;
        const text = normalizeBlock(element.textContent || '');
        if (text.length > 0) blocks.push({ text, element });
    }
    markdownBlocks = blocks;
}

export function indexMarkdown(root: HTMLElement) {
    indexRoot = null;
    indexDirty = false;
    buildIndex(root);
}

export function invalidateMarkdownIndex(root: HTMLElement) {
    indexRoot = root;
    indexDirty = true;
    markdownBlocks = [];
}

export function ensureMarkdownIndex() {
    if (!indexDirty) return;
    indexDirty = false;
    const root = indexRoot;
    if (root) buildIndex(root);
}

export function clearMarkdownIndex() {
    markdownBlocks = [];
    indexRoot = null;
    indexDirty = false;
}

export function markdownBlockLabel(index: number): string {
    const block = markdownBlocks[index];
    if (!block) return '';
    for (let current = index; current >= 0; current--) {
        const tag = markdownBlocks[current].element.tagName;
        if (/^H[1-6]$/.test(tag)) {
            const heading = (markdownBlocks[current].element.textContent || '').trim();
            return heading ? heading.slice(0, 40) : 'Heading';
        }
    }

    const tag = block.element.tagName;
    if (tag === 'PRE') return 'Code block';
    if (tag === 'LI') return 'List item';
    if (tag === 'BLOCKQUOTE') return 'Quote';
    if (tag === 'TD' || tag === 'TH') return 'Table cell';
    if (tag === 'DT') return 'Term';
    if (tag === 'DD') return 'Definition';
    return 'Paragraph';
}

export function scanMarkdown(tokens: string[]): { results: SearchResult[]; matches: Map<number, PageMatch> } {
    const results: SearchResult[] = [];
    const matches = new Map<number, PageMatch>();
    for (let index = 0; index < markdownBlocks.length; index++) {
        const match = tokenMatch(markdownBlocks[index].text, tokens);
        if (!match) continue;
        results.push({ page: index, score: match.score, start: match.start, end: match.end });
        matches.set(index, { start: match.start, end: match.end });
    }
    sortResults(results);
    return { results, matches };
}
