import { createPdfViewerServices, type PdfViewerState } from "./main/factory.js";
import { createPdfLifecycle } from "./main/lifecycle.js";
import { registerPdfNavigation } from "./state.js";

const state: PdfViewerState = { savedScrollPos: null, pendingRestoreLocation: null, lastKnownPage: 1 };
const services = createPdfViewerServices(state);
const lifecycle = createPdfLifecycle(state, services);

registerPdfNavigation({
    jumpToPage: services.navigation.jumpToPage,
    isViewerBusy: services.viewport.isViewerBusy
});

export const whenMainRenderIdle = services.session.whenMainRenderIdle;
export const isSnapSuspended = services.navigation.isSnapSuspended;
export const getPdfLocation = services.viewport.captureScrollPos;
export const setPdfZoom = services.navigation.setZoom;
export const setPdfSpreadMode = services.session.applySpreadMode;
export const getPdfFitWidth = services.session.getFitWidth;
export const applyPdfViewerSettings = services.navigation.applySettings;
export const setCurrentFileName = services.outline.setFileName;
export const resetPdfState = lifecycle.resetAll;
export const restorePdfPosition = lifecycle.restorePosition;
export const goToPage = services.navigation.goToPage;
export const stepPdfPage = services.navigation.stepPage;
export const toggleSidebarFollow = services.navigation.toggleSidebarFollow;
export const setSidebarFollowSuppressed = services.navigation.setSidebarFollowSuppressed;
export const refreshSidebarSync = services.viewport.refreshSidebarSync;
export const renderOutline = services.outline.render;
export const renderThumbnails = services.thumbnails.render;
export const renderAllMainPages = services.session.renderAllMainPages;
