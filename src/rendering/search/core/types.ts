export interface PageIndex {
    text: string;
    ranges: { start: number; end: number }[];
    spans: (HTMLElement | null)[];
}

export interface PageMatch {
    start: number;
    end: number;
}

export interface SearchResult {
    page: number;
    start: number;
    end: number;
    fuzzy: boolean;
}

export type SearchMode = 'pdf' | 'md';
