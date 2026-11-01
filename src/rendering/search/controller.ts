import { PdfState } from '../pdf/state.js';
import { clearPageIndexStore, pageIndexes } from './pdf/pageIndexStore.js';
import { scanPdf } from './pdf/scan.js';
import { clearMarkdownIndex, ensureMarkdownIndex, markdownBlocks, scanMarkdown } from './markdown/index.js';
import { parseQuery } from './core/query.js';
import type { PageMatch, SearchMode, SearchResult } from './core/types.js';
import { applyPdfHighlights, applyMarkdownHighlights, setActiveHighlights } from './ui/highlights.js';
import { clearPendingSearchScroll, jumpToSearchResult } from './ui/navigation.js';
import { initSearchDialog, closeSearchDialog, updateSearchDialog } from './ui/dialog.js';
import { renderEmpty, renderResults } from './ui/results.js';

let searchVersion = 0;
let activeMatches: Map<number, PageMatch> | null = null;
let currentResults: SearchResult[] = [];
let selectedIndex = 0;
let searchMode: SearchMode | null = null;

function applyAllHighlights() {
    for (const [pageNum, index] of pageIndexes) applyPdfHighlights(index, pageNum);
    applyMarkdownHighlights(markdownBlocks, activeMatches);
}

function publishResults(results: SearchResult[], matches: Map<number, PageMatch>, done: number, total: number) {
    activeMatches = matches;
    setActiveHighlights(matches);
    currentResults = results;
    renderResults(results, done, total, searchMode ?? 'pdf', selectedIndex, selectResult);
    updateSearchDialog(results, searchMode);
    applyAllHighlights();
}

function selectResult(index: number) {
    const result = currentResults[index];
    if (!result || !searchMode) return;
    selectedIndex = index;
    jumpToSearchResult(result, searchMode);
    renderResults(
        currentResults,
        currentResults.length,
        currentResults.length,
        searchMode,
        selectedIndex,
        selectResult,
    );
}

export function runSearch(query: string) {
    clearPendingSearchScroll();
    const version = ++searchVersion;
    const tokens = parseQuery(query);
    if (tokens.length > 0) ensureMarkdownIndex();
    const hasPdf = !!PdfState.currentPdfDoc;
    const hasMarkdown = markdownBlocks.length > 0;
    searchMode = hasPdf ? 'pdf' : hasMarkdown ? 'md' : null;
    selectedIndex = 0;
    updateSearchDialog([], searchMode);
    if (!searchMode) {
        currentResults = [];
        activeMatches = null;
        setActiveHighlights(null);
        updateSearchDialog([], null);
        renderEmpty();
        applyAllHighlights();
        return;
    }
    if (tokens.length === 0) {
        currentResults = [];
        activeMatches = null;
        setActiveHighlights(null);
        updateSearchDialog([], searchMode);
        renderEmpty();
        applyAllHighlights();
        return;
    }
    if (hasPdf) {
        void scanPdf(tokens, () => version === searchVersion, publishResults);
        return;
    }
    const { results, matches } = scanMarkdown(tokens);
    if (version === searchVersion) publishResults(results, matches, results.length, results.length);
}

export function initSearch() {
    initSearchDialog(
        runSearch,
        (index) => {
            const result = currentResults[index];
            if (result && searchMode) jumpToSearchResult(result, searchMode);
        },
        closeSearch,
    );
    updateSearchDialog([], null);
}

function closeSearch() {
    activeMatches = null;
    setActiveHighlights(null);
    clearPendingSearchScroll();
    applyAllHighlights();
    searchVersion++;
    currentResults = [];
}

export function resetSearchState() {
    searchVersion++;
    clearPageIndexStore();
    clearMarkdownIndex();
    searchMode = null;
    currentResults = [];
    activeMatches = null;
    setActiveHighlights(null);
    clearPendingSearchScroll();
    updateSearchDialog([], null);
    closeSearchDialog();
}
