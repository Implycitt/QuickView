import { DOM, toggleSidebar } from '../../ui/core/dom.js';
import { clearMarkdownIndex, invalidateMarkdownIndex } from '../search/markdown/index.js';
import { runSearch } from '../search/controller.js';
import { resetPdfState, setCurrentFileName } from '../pdf/renderer.js';
import { insertMarkdownChunks, isLargeMarkdownDocument, updateMarkdownArticle } from './domMorph.js';
import { attachImageFallbacks } from './imageFallback.js';
import {
    attachMarkdownLinks,
    createMarkdownRenderStream,
    initMdBreadcrumb,
    renderMarkdownChunks,
} from './renderer.js';
import type { FileResponse } from '../../types/types.d.ts';
import type { StoredViewerState } from '../../viewer/state.js';

const STREAMING_SOURCE_THRESHOLD = 120_000;

function setMarkdownLayout() {
    DOM.mainContentNode.classList.remove('qv-html-viewer');
    DOM.mainContentNode.classList.add('pt-8', 'px-8', 'pb-20');
}

function ensureArticle(): { article: HTMLElement; isFirstRender: boolean } | null {
    let article = DOM.mainContentNode.querySelector('article');
    if (article) return { article, isFirstRender: false };

    DOM.mainContentNode.innerHTML = `
        <div class="w-full max-w-4xl mx-auto self-start">
            <div class="qv-document-sheet bg-gray-800 p-8 md:p-12 rounded-xl">
                <article
                    class="prose prose-slate prose-invert prose-a:text-lavender-400 max-w-none qv-document-prose"
                ></article>
            </div>
        </div>
    `;
    article = DOM.mainContentNode.querySelector('article');
    return article ? { article, isFirstRender: true } : null;
}

export async function renderMarkdownDocument(
    content: FileResponse,
    viewerState: StoredViewerState | null,
    reopening: boolean,
    isStale: () => boolean,
): Promise<boolean> {
    const previousScrollTop = DOM.mainContentNode.scrollTop;
    if (isStale()) return false;

    const source = content.content || '';
    const filePath = content.path || '';
    const stream = source.length > STREAMING_SOURCE_THRESHOLD ? createMarkdownRenderStream(source, filePath) : null;
    const chunks = await (stream ? stream.preview() : renderMarkdownChunks(source, filePath));
    if (isStale()) return false;

    if (!reopening) resetPdfState();
    if (DOM.pdfTools) DOM.pdfTools.classList.add('hidden');

    setCurrentFileName(content.name);
    if (!reopening) toggleSidebar('closed');
    DOM.sidebarTabs?.classList.add('hidden');
    DOM.sidebarPreviews.innerHTML = '';
    DOM.sidebarSections.innerHTML = '';
    setMarkdownLayout();

    const rendered = ensureArticle();
    if (!rendered) return false;
    const { article } = rendered;

    const targetScrollTop =
        viewerState?.documentType === 'markdown'
            ? (viewerState.markdownScrollTop ?? 0)
            : reopening
              ? previousScrollTop
              : 0;
    const applyScroll = () => {
        DOM.mainContentNode.scrollTop = targetScrollTop;
    };

    if (stream) {
        clearMarkdownIndex();
        if (chunks.length > 0) article.innerHTML = chunks.join('');
        else article.replaceChildren();
    } else if (!reopening && isLargeMarkdownDocument(chunks)) {
        clearMarkdownIndex();
        if (!(await insertMarkdownChunks(article, chunks, isStale))) return false;
    } else {
        updateMarkdownArticle(article, chunks.join(''));
    }

    attachImageFallbacks(article);
    if (rendered.isFirstRender) attachMarkdownLinks(article);
    initMdBreadcrumb(content.name, DOM.mainContentNode);
    applyScroll();

    if (!stream) {
        invalidateMarkdownIndex(DOM.mainContentNode);
        runSearch((document.getElementById('search-input') as HTMLInputElement | null)?.value ?? '');
        applyScroll();
        return true;
    }

    void (async () => {
        for await (const rest of stream.rest()) {
            if (isStale()) return;
            if (rest.length > 0) article.insertAdjacentHTML('beforeend', rest.join(''));
        }
        if (isStale()) return;
        attachImageFallbacks(article);
        invalidateMarkdownIndex(DOM.mainContentNode);
        runSearch((document.getElementById('search-input') as HTMLInputElement | null)?.value ?? '');
        applyScroll();
    })();

    return true;
}
