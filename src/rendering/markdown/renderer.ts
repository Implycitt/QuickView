import MarkdownIt from 'markdown-it';
import { resolveMarkdownMedia } from './media.js';
import { highlightCodeBlocks, isMathFenceLanguage, type FenceCodeBlock } from './syntaxHighlight.js';
export { clearMdBreadcrumb, initMdBreadcrumb } from './breadcrumb.js';

type MathEngine = typeof import('katex').default;
type MarkdownRenderer = InstanceType<typeof MarkdownIt>;
type TexmathPlugin = Parameters<MarkdownRenderer['use']>[0];

const markdownOptions = { html: true, linkify: true, typographer: true };
const MATH_MACROS = { '\\Z': '\\mathbb{Z}' };

function createMarkdownRenderer(mathEngine?: MathEngine, texmathPlugin?: TexmathPlugin): MarkdownRenderer {
    const renderer = new MarkdownIt(markdownOptions);
    if (mathEngine && texmathPlugin) {
        renderer.use(texmathPlugin, {
            engine: mathEngine,
            delimiters: 'dollars',
            katexOptions: { macros: MATH_MACROS },
        });
    }

    const defaultFence =
        renderer.renderer.rules.fence ||
        function (tokens, idx, options, _env, slf) {
            return slf.renderToken(tokens, idx, options);
        };
    renderer.renderer.rules.fence = (tokens, idx, options, _env, slf) => {
        const token = tokens[idx];
        const lang = token.info.trim().toLowerCase();
        if (mathEngine && isMathFenceLanguage(lang)) {
            try {
                const math = mathEngine.renderToString(token.content.trim(), {
                    displayMode: true,
                    throwOnError: false,
                    macros: MATH_MACROS,
                });
                return `<div class="my-4 overflow-x-auto flex justify-center">${math}</div>`;
            } catch (error) {
                console.error('KaTeX fence rendering error:', error);
            }
        }
        return defaultFence(tokens, idx, options, _env, slf);
    };
    return renderer;
}

const basicMarkdown = createMarkdownRenderer();
let mathMarkdown: MarkdownRenderer | null = null;
let mathMarkdownPromise: Promise<MarkdownRenderer> | null = null;

async function loadMathMarkdown(): Promise<MarkdownRenderer> {
    if (!mathMarkdownPromise) {
        mathMarkdownPromise = Promise.all([
            import('katex'),
            import('markdown-it-texmath'),
            import('katex/dist/katex.min.css'),
        ])
            .then(([mathModule, texmathModule]) => {
                const texmathPlugin = (texmathModule as unknown as { default: TexmathPlugin }).default;
                mathMarkdown = createMarkdownRenderer(mathModule.default, texmathPlugin);
                return mathMarkdown;
            })
            .catch((error: unknown) => {
                mathMarkdownPromise = null;
                throw error;
            });
    }
    return mathMarkdownPromise;
}

const VOID_ELEMENTS = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
]);
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);
const TAG_NAME_CHARACTER = /[A-Za-z0-9:_-]/;
const TASK_LIST_ITEM = /<li>\[([ xX])\]\s+/g;

function scanHtmlTags(html: string, openElements: string[]) {
    let index = 0;
    while (index < html.length) {
        const start = html.indexOf('<', index);
        if (start < 0) return;
        if (html.startsWith('<!--', start)) {
            const end = html.indexOf('-->', start + 4);
            index = end < 0 ? html.length : end + 3;
            continue;
        }
        const marker = html[start + 1];
        if (marker === undefined || marker === '!' || marker === '?') {
            index = start + 1;
            continue;
        }

        const closing = marker === '/';
        let cursor = closing ? start + 2 : start + 1;
        const nameStart = cursor;
        while (cursor < html.length && TAG_NAME_CHARACTER.test(html[cursor])) cursor += 1;
        const tagName = html.slice(nameStart, cursor).toLowerCase();
        if (!tagName) {
            index = start + 1;
            continue;
        }

        let quote: string | null = null;
        while (cursor < html.length) {
            const character = html[cursor];
            if (quote) {
                if (character === quote) quote = null;
            } else if (character === '"' || character === "'") {
                quote = character;
            } else if (character === '>') {
                break;
            }
            cursor += 1;
        }

        const selfClosing = html[cursor - 1] === '/';
        index = cursor + 1;
        if (closing) {
            const position = openElements.lastIndexOf(tagName);
            if (position >= 0) openElements.length = position;
            continue;
        }
        if (selfClosing || VOID_ELEMENTS.has(tagName)) continue;

        openElements.push(tagName);
        if (RAW_TEXT_ELEMENTS.has(tagName)) {
            const match = new RegExp(`</${tagName}`, 'i').exec(html.slice(index));
            if (match) index += match.index;
        }
    }
}

const MEDIA_TAG = /<(?:img|source|picture|video|audio|iframe|embed|object|image)\b/i;
const TASK_ITEM = /<li>\[[ xX]\]\s/;

function rewriteTaskListItems(html: string): string {
    return html.replace(
        TASK_LIST_ITEM,
        (_match, checked: string) =>
            `<li><input type="checkbox" disabled${checked.toLowerCase() === 'x' ? ' checked' : ''} class="mr-2 inline-block h-4 w-4 translate-y-0.5 accent-lavender-500" aria-label="${checked.toLowerCase() === 'x' ? 'checked' : 'unchecked'}">`,
    );
}

function finalizeChunk(html: string, filePath: string): string {
    let output = html;
    if (filePath && MEDIA_TAG.test(output)) output = resolveMarkdownMedia(output, filePath);
    if (TASK_ITEM.test(output)) output = rewriteTaskListItems(output);
    return output;
}

function groupTopLevelTokens(tokens: ReturnType<MarkdownRenderer['parse']>): ReturnType<MarkdownRenderer['parse']>[] {
    const groups: ReturnType<MarkdownRenderer['parse']>[] = [];
    let group: ReturnType<MarkdownRenderer['parse']> = [];
    let depth = 0;
    for (const token of tokens) {
        group.push(token);
        depth += token.nesting;
        if (depth > 0) continue;
        groups.push(group);
        group = [];
    }
    if (group.length > 0) groups.push(group);
    return groups;
}

function highlightKey(language: string, code: string): string {
    return `${language}\u0000${code}`;
}

function createHighlightLookup(blocks: FenceCodeBlock[], highlighted: string[]) {
    const lookup = new Map<string, string>();
    blocks.forEach((block, index) => {
        const html = highlighted[index];
        if (html) lookup.set(highlightKey(block.language, block.code), html);
    });
    return (code: string, language: string) => lookup.get(highlightKey(language, code)) ?? '';
}

function collectCodeBlocks(
    md: MarkdownRenderer,
    tokens: ReturnType<MarkdownRenderer['parse']>,
    mathEnabled: boolean,
): FenceCodeBlock[] {
    const blocks: FenceCodeBlock[] = [];
    for (const token of tokens) {
        if (token.type !== 'fence') continue;
        if (mathEnabled && isMathFenceLanguage(token.info.trim().toLowerCase())) continue;
        const info = token.info ? md.utils.unescapeAll(token.info).trim() : '';
        const language = info ? info.split(/(\s+)/g)[0] : '';
        if (!language) continue;
        blocks.push({ language, code: token.content });
    }
    return blocks;
}

const MATH_SYNTAX = /\$[^\n$]+\$|\$\$[\s\S]+?\$\$|^\s*`{3,}\s*(?:latex|math)\s*$/im;
const ALERT_BLOCK = /^>\s*"?\s*\[!(NOTE|WARNING|TIP|IMPORTANT|CAUTION)\]\s*"?\s*([\s\S]*?)(?=\n\s*\n|$)/gm;
const ALERT_COLORS: Record<string, string> = {
    NOTE: 'border-blue-500 bg-blue-950/40 text-blue-200',
    WARNING: 'border-yellow-500 bg-yellow-950/40 text-yellow-200',
    TIP: 'border-emerald-500 bg-emerald-950/40 text-emerald-200',
    IMPORTANT: 'border-purple-500 bg-purple-950/40 text-purple-200',
    CAUTION: 'border-red-500 bg-red-950/40 text-red-200',
};
const PREVIEW_SOURCE_LIMIT = 120_000;
const SLICE_SOURCE_LIMIT = 120_000;

function renderAlerts(source: string, md: MarkdownRenderer): string {
    return source.replace(ALERT_BLOCK, (_, type: string, content: string) => {
        let cleanContent = content.replace(/^>\s*/gm, '').trim();
        if (cleanContent.startsWith('"')) cleanContent = cleanContent.slice(1);
        if (cleanContent.endsWith('"')) cleanContent = cleanContent.slice(0, -1);
        const rendered = md.renderInline(cleanContent.trim());
        return `<div class="border-l-4 p-4 my-4 rounded-r ${ALERT_COLORS[type] || ALERT_COLORS.NOTE}"><p class="font-bold uppercase text-xs tracking-wider mb-1">${type}</p><p class="m-0">${rendered}</p></div>`;
    });
}

async function renderSourceSlice(rawMarkdown: string, filePath: string): Promise<string[]> {
    if (!rawMarkdown) return [];
    const md = MATH_SYNTAX.test(rawMarkdown) ? await loadMathMarkdown() : basicMarkdown;
    const processedMd = renderAlerts(rawMarkdown, md);

    const env = {};
    const tokens = md.parse(processedMd, env);
    const codeBlocks = collectCodeBlocks(md, tokens, md === mathMarkdown);
    const highlighted = codeBlocks.length ? await highlightCodeBlocks(codeBlocks) : [];
    const options = { ...md.options, highlight: createHighlightLookup(codeBlocks, highlighted) };

    const chunks: string[] = [];
    const openElements: string[] = [];
    let chunkHtml = '';
    for (const group of groupTopLevelTokens(tokens)) {
        const rendered = md.renderer.render(group, options, env);
        chunkHtml += rendered;
        scanHtmlTags(rendered, openElements);
        if (openElements.length > 0) continue;
        chunks.push(finalizeChunk(chunkHtml, filePath));
        chunkHtml = '';
    }
    if (chunkHtml) chunks.push(finalizeChunk(chunkHtml, filePath));
    return chunks;
}

export async function renderMarkdownChunks(rawMarkdown: string, filePath = ''): Promise<string[]> {
    return renderSourceSlice(rawMarkdown, filePath);
}

export interface MarkdownRenderStream {
    preview: () => Promise<string[]>;
    rest: () => AsyncGenerator<string[]>;
}

function isFenceDelimiter(line: string): boolean {
    return /^\s{0,3}(?:```|~~~)/.test(line);
}

function safeBoundary(source: string, start: number, limit: number): number {
    if (start + limit >= source.length) return source.length;
    const target = start + limit;
    let offset = start;
    let inFence = false;
    let lastSafe = -1;
    while (offset < target) {
        const newline = source.indexOf('\n', offset);
        if (newline < 0) break;
        const line = source.slice(offset, newline);
        if (isFenceDelimiter(line)) inFence = !inFence;
        else if (!inFence && line.trim() === '') lastSafe = newline + 1;
        offset = newline + 1;
    }
    return lastSafe > start ? lastSafe : source.length;
}

export function createMarkdownRenderStream(rawMarkdown: string, filePath = ''): MarkdownRenderStream {
    const firstEnd = safeBoundary(rawMarkdown, 0, PREVIEW_SOURCE_LIMIT);
    let offset = firstEnd;
    return {
        preview: () => renderSourceSlice(rawMarkdown.slice(0, firstEnd), filePath),
        rest: async function* () {
            while (offset < rawMarkdown.length) {
                const end = safeBoundary(rawMarkdown, offset, SLICE_SOURCE_LIMIT);
                const slice = rawMarkdown.slice(offset, end);
                offset = end;
                if (!slice) break;
                yield await renderSourceSlice(slice, filePath);
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
        },
    };
}

export function attachMarkdownLinks(root: HTMLElement) {
    root.addEventListener('click', (event) => {
        const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
        if (!anchor) return;
        const href = anchor.getAttribute('href') ?? '';
        if (!/^(https?:|mailto:)/i.test(href)) return;
        event.preventDefault();
        void window.electronAPI.openExternal(href);
    });
}
