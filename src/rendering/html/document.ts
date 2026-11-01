import { DOM, toggleSidebar } from '../../ui/core/dom.js';
import { setBreadcrumbPath } from '../../ui/core/breadcrumb.js';
import { clearMdBreadcrumb } from '../markdown/breadcrumb.js';
import { resetPdfState } from '../pdf/renderer.js';
import { resetSearchState } from '../search/controller.js';
import { htmlDocumentUrl, htmlUrlToPath } from './media.js';
import type { FileResponse } from '../../types/types.d.ts';

const HTML_LAYOUT_CLASSES = ['pt-8', 'px-8', 'pb-20'];
const HTML_CONTENT_POLICY = [
    "default-src 'none'",
    "script-src 'none'",
    "connect-src 'none'",
    'img-src data: blob: quickview-asset: https: http:',
    "style-src 'unsafe-inline' quickview-asset: https: http:",
    'font-src data: quickview-asset: https: http:',
    'media-src data: blob: quickview-asset: https: http:',
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    'base-uri quickview-asset:',
].join('; ');

function prepareHtmlDocument(source: string, filePath: string): string {
    const parsed = new DOMParser().parseFromString(source, 'text/html');
    parsed
        .querySelectorAll(
            'script, base, iframe, frame, object, embed, applet, portal, fencedframe, form, meta[http-equiv="refresh"]',
        )
        .forEach((element) => element.remove());
    for (const element of parsed.querySelectorAll('*')) {
        const attributes = element.attributes;
        for (let index = attributes.length - 1; index >= 0; index--) {
            const attribute = attributes[index];
            const name = attribute.name.toLowerCase();
            if (
                name.startsWith('on') ||
                name === 'srcdoc' ||
                name === 'formaction' ||
                name === 'action' ||
                name === 'ping' ||
                ((name === 'src' || name === 'poster') &&
                    /^\s*(?:javascript|file|filesystem|chrome|data):/i.test(attribute.value)) ||
                (name === 'srcset' &&
                    attribute.value.split(',').some((candidate) => {
                        const url = candidate.trim().split(/\s+/)[0];
                        return !!url && /^(?:file|javascript|filesystem|chrome|vbscript):/i.test(url);
                    })) ||
                ((name === 'href' || name === 'xlink:href') &&
                    /^\s*(?:javascript|data|file|filesystem|chrome):/i.test(attribute.value))
            ) {
                element.removeAttribute(attribute.name);
            }
        }
    }

    const baseUrl = htmlDocumentUrl(filePath);
    const base = parsed.createElement('base');
    base.href = baseUrl;
    parsed.head.prepend(base);
    const policy = parsed.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy';
    policy.content = HTML_CONTENT_POLICY;
    parsed.head.prepend(policy);
    return `<!doctype html>${parsed.documentElement.outerHTML}`;
}

export function renderHtmlDocument(
    content: FileResponse,
    reopening: boolean,
    isStale: () => boolean,
    openDocumentPath: (path: string) => Promise<void>,
): boolean {
    if (isStale()) return false;
    const previousFrame = DOM.mainContentNode.querySelector<HTMLIFrameElement>('.qv-html-frame');
    const previousScrollTop = previousFrame?.contentWindow?.scrollY ?? 0;
    if (!reopening) resetPdfState();
    clearMdBreadcrumb();
    resetSearchState();
    if (DOM.pdfTools) DOM.pdfTools.classList.add('hidden');
    DOM.sidebarTabs?.classList.add('hidden');
    DOM.sidebarPreviews.innerHTML = '';
    DOM.sidebarSections.innerHTML = '';
    if (!reopening) toggleSidebar('closed');

    DOM.mainContentNode.classList.remove(...HTML_LAYOUT_CLASSES);
    DOM.mainContentNode.classList.add('qv-html-viewer');
    DOM.mainContentNode.scrollTop = 0;
    setBreadcrumbPath(content.name);

    const iframe = document.createElement('iframe');
    iframe.className = 'qv-html-frame';
    iframe.title = content.name;
    iframe.setAttribute('sandbox', 'allow-same-origin');
    iframe.referrerPolicy = 'no-referrer';
    iframe.srcdoc = prepareHtmlDocument(typeof content.content === 'string' ? content.content : '', content.path);
    iframe.addEventListener('load', () => {
        const frameDocument = iframe.contentDocument;
        if (!frameDocument) return;
        const savedScrollTop = iframe.dataset.restoreScrollTop;
        if (savedScrollTop) iframe.contentWindow?.scrollTo(0, Number(savedScrollTop));
        iframe.contentWindow?.addEventListener('scroll', () => window.dispatchEvent(new Event('qv:html-scroll')), {
            passive: true,
        });
        frameDocument.addEventListener('click', (event) => {
            const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
            if (!anchor) return;
            const href = anchor.getAttribute('href') ?? '';
            if (href.startsWith('#')) return;
            let target: URL;
            try {
                target = new URL(href, frameDocument.baseURI);
            } catch {
                event.preventDefault();
                return;
            }
            if (target.protocol === 'quickview-asset:') {
                const pagePath = htmlUrlToPath(target);
                const extension = pagePath?.split('.').pop()?.toLowerCase();
                if (!pagePath || !['html', 'htm', 'md', 'pdf'].includes(extension ?? '')) {
                    event.preventDefault();
                    return;
                }
                event.preventDefault();
                void openDocumentPath(pagePath);
                return;
            }
            event.preventDefault();
            if (/^(?:https?:|mailto:)$/.test(target.protocol)) void window.electronAPI.openExternal(target.href);
        });
    });
    if (reopening && previousScrollTop > 0) iframe.dataset.restoreScrollTop = String(previousScrollTop);
    DOM.mainContentNode.replaceChildren(iframe);
    return true;
}
