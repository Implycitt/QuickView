import { initDOM, initSidebarResizer } from '../core/dom.js';
import { initKeybinds } from '../keyboard/keybinds.js';
import { initWindowChrome } from '../window/chrome.js';
import { initSearch } from '../../rendering/search/controller.js';
import { createDocumentController } from './documentController.js';
import { bindViewerControls } from './viewerControls.js';
import { installViewerResizeHandlers } from './viewerResize.js';
import { installPdfMagnifier } from '../../rendering/pdf/magnifier.js';
import { renderApplicationShell } from './shell.js';
import { initColorSchemes } from './colorSchemes.js';

export async function startApplication() {
    const root = document.getElementById('application-root');
    if (!root) throw new Error('QuickView shell root #application-root was not found.');
    root.innerHTML = renderApplicationShell();
    initDOM();
    initSidebarResizer();
    initKeybinds();
    initSearch();
    initWindowChrome();
    initColorSchemes();
    installPdfMagnifier();

    const warmPdfEngine = () => {
        void import('../../rendering/pdf/pdfjs.js').then((module) => module.loadPdfjs()).catch(() => {});
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(warmPdfEngine, { timeout: 4000 });
    else setTimeout(warmPdfEngine, 1200);

    const documents = createDocumentController();
    documents.attachViewerStateListeners();
    bindViewerControls({ openDocument: documents.openDocument, onStateChanged: documents.scheduleViewerStateSave });

    window.electronAPI.onFileUpdated((content) => {
        void documents.openDocument(content).catch((error) => console.error('Failed to reload document:', error));
    });
    window.electronAPI.onFileUnavailable((path) => {
        if (documents.getLastDocumentPath() === path) documents.setLastDocumentPath(null);
        console.warn(`Could not restore missing QuickView document: ${path}`);
    });

    const launchPath = await window.electronAPI.getLaunchPath();
    const documentPath = launchPath || documents.getLastDocumentPath();
    if (documentPath) {
        try {
            await documents.openDocument(await window.electronAPI.readFile(documentPath));
        } catch (error) {
            console.warn('Could not open the QuickView document:', error);
            documents.setLastDocumentPath(null);
        }
    }

    installViewerResizeHandlers({ scheduleViewerStateSave: documents.scheduleViewerStateSave });
}
