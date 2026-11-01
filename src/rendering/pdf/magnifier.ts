import { DOM, updateMagnifierClasses } from '../../ui/core/dom.js';
import { isTypingTarget } from '../../ui/keyboard/shortcuts.js';
import { PdfState } from './state.js';

const LENS_SIZE = 240;
const DEFAULT_LENS_FACTOR_STEPS = 8;
const MIN_LENS_FACTOR_STEPS = 5;
const MAX_LENS_FACTOR_STEPS = 16;
const LENS_FACTOR_STEP = 0.25;
const LENS_FACTOR_STORAGE_KEY = 'quickview.magnifier-factor.v1';
const LENS_CURSOR_OFFSET = 20;
const LENS_EDGE_MARGIN = 16;
const MAX_LENS_SCALE = 2.5;
const LENS_VIGNETTE = 'rgba(8, 9, 13, 0.16)';
const FACTOR_BADGE_DURATION_MS = 1100;
const WHEEL_STEP_DISTANCE = 40;
const WHEEL_GESTURE_TIMEOUT_MS = 250;
const SHARP_CROP_SCALE = 2;
const SHARP_RENDER_INTERVAL_MS = 80;
const SHARP_COVERAGE_EPSILON = 0.75;
const MOMENTARY_KEY = 'c';
const PDF_SCROLL_CONTAINER_ID = 'pdf-scroll-container';
const PAGE_CONTAINER_SELECTOR = '.pdf-page-container';

function readLensFactorSteps(): number {
    try {
        const stored = Number(localStorage.getItem(LENS_FACTOR_STORAGE_KEY));
        if (!Number.isFinite(stored) || stored <= 0) return DEFAULT_LENS_FACTOR_STEPS;
        return Math.min(MAX_LENS_FACTOR_STEPS, Math.max(MIN_LENS_FACTOR_STEPS, Math.round(stored / LENS_FACTOR_STEP)));
    } catch {
        return DEFAULT_LENS_FACTOR_STEPS;
    }
}

function formatLensFactor(steps: number): string {
    return `${(steps * LENS_FACTOR_STEP).toFixed(2).replace(/\.?0+$/, '')}×`;
}

interface MagnifierPage {
    canvas: HTMLCanvasElement;
    pageNumber: number;
    rect: DOMRect;
}

interface SharpCrop {
    canvas: HTMLCanvasElement;
    pageCanvas: HTMLCanvasElement;
    factorSteps: number;
    pageWidth: number;
    pageHeight: number;
    originX: number;
    originY: number;
    width: number;
    height: number;
    pixelsPerCssX: number;
    pixelsPerCssY: number;
}

export function installPdfMagnifier() {
    let enabled = false;
    let momentary = false;
    let lens: HTMLDivElement | null = null;
    let scrim: HTMLDivElement | null = null;
    let lensCanvas: HTMLCanvasElement | null = null;
    let lensContext: CanvasRenderingContext2D | null = null;
    let factorBadge: HTMLSpanElement | null = null;
    let factorBadgeTimer: number | null = null;
    let lensFactorSteps = readLensFactorSteps();
    let wheelAccumulator = 0;
    let wheelLastEventAt = 0;
    let sharpCanvas: HTMLCanvasElement | null = null;
    let sharpCrop: SharpCrop | null = null;
    let sharpTask: { cancel: () => void } | null = null;
    let sharpRenderToken = 0;
    let sharpRendering = false;
    let sharpLastRequestAt = 0;
    let frame: number | null = null;
    let hasPointer = false;
    let pointerX = 0;
    let pointerY = 0;

    const isActive = () => enabled || momentary;

    function createOverlay() {
        const scale = Math.min(window.devicePixelRatio || 1, MAX_LENS_SCALE);
        scrim = document.createElement('div');
        scrim.className = 'pdf-magnifier-scrim';
        scrim.setAttribute('aria-hidden', 'true');
        scrim.style.width = `${LENS_SIZE}px`;
        scrim.style.height = `${LENS_SIZE}px`;
        lens = document.createElement('div');
        lens.className = 'pdf-magnifier';
        lens.setAttribute('aria-hidden', 'true');
        lens.style.width = `${LENS_SIZE}px`;
        lens.style.height = `${LENS_SIZE}px`;
        lensCanvas = document.createElement('canvas');
        lensCanvas.width = Math.round(LENS_SIZE * scale);
        lensCanvas.height = Math.round(LENS_SIZE * scale);
        lensContext = lensCanvas.getContext('2d');
        factorBadge = document.createElement('span');
        factorBadge.className = 'pdf-magnifier-factor';
        factorBadge.textContent = formatLensFactor(lensFactorSteps);
        lens.append(lensCanvas, factorBadge);
        document.body.append(scrim, lens);
    }

    function hideLens() {
        lens?.removeAttribute('data-visible');
        scrim?.removeAttribute('data-visible');
        factorBadge?.removeAttribute('data-active');
        if (factorBadgeTimer !== null) {
            window.clearTimeout(factorBadgeTimer);
            factorBadgeTimer = null;
        }
    }

    function showLensFactor() {
        if (!factorBadge) return;
        factorBadge.textContent = formatLensFactor(lensFactorSteps);
        factorBadge.setAttribute('data-active', 'true');
        if (factorBadgeTimer !== null) window.clearTimeout(factorBadgeTimer);
        factorBadgeTimer = window.setTimeout(() => {
            factorBadgeTimer = null;
            factorBadge?.removeAttribute('data-active');
        }, FACTOR_BADGE_DURATION_MS);
    }

    function adjustLensFactor(direction: number) {
        const next = Math.min(MAX_LENS_FACTOR_STEPS, Math.max(MIN_LENS_FACTOR_STEPS, lensFactorSteps + direction));
        if (next === lensFactorSteps) return;
        lensFactorSteps = next;
        try {
            localStorage.setItem(LENS_FACTOR_STORAGE_KEY, String(lensFactorSteps * LENS_FACTOR_STEP));
        } catch {
            // The factor still applies for this session if storage is unavailable.
        }
        invalidateSharpCrop();
        if (lens && isActive()) {
            showLensFactor();
            if (hasPointer) schedule();
        }
    }

    function pageUnderPointer(): MagnifierPage | null {
        const scroll = document.getElementById(PDF_SCROLL_CONTAINER_ID);
        if (!scroll || !PdfState.currentPdfDoc) return null;
        const scrollRect = scroll.getBoundingClientRect();
        if (
            pointerX < scrollRect.left ||
            pointerX > scrollRect.right ||
            pointerY < scrollRect.top ||
            pointerY > scrollRect.bottom
        ) {
            return null;
        }
        const hit = document.elementFromPoint(pointerX, pointerY);
        const page = hit instanceof Element ? hit.closest<HTMLElement>(PAGE_CONTAINER_SELECTOR) : null;
        const canvas = page?.querySelector('canvas');
        if (!(canvas instanceof HTMLCanvasElement)) return null;
        const rect = canvas.getBoundingClientRect();
        const pageNumber = Number(page?.dataset.pageNum);
        if (rect.width <= 0 || rect.height <= 0 || !Number.isFinite(pageNumber) || pageNumber < 1) return null;
        return { canvas, pageNumber, rect };
    }

    function positionLens() {
        if (!lens) return;
        const maxLeft = window.innerWidth - LENS_SIZE - LENS_EDGE_MARGIN;
        const maxTop = window.innerHeight - LENS_SIZE - LENS_EDGE_MARGIN;
        const left = Math.max(LENS_EDGE_MARGIN, Math.min(maxLeft, pointerX + LENS_CURSOR_OFFSET));
        const top = Math.max(LENS_EDGE_MARGIN, Math.min(maxTop, pointerY + LENS_CURSOR_OFFSET));
        const translate = `${Math.round(left)}px ${Math.round(top)}px`;
        lens.style.translate = translate;
        lens.setAttribute('data-visible', 'true');
        if (scrim) {
            scrim.style.translate = translate;
            scrim.setAttribute('data-visible', 'true');
        }
    }

    function sampleSize(): number {
        return LENS_SIZE / (lensFactorSteps * LENS_FACTOR_STEP);
    }

    function invalidateSharpCrop() {
        sharpRenderToken++;
        sharpCrop = null;
        try {
            sharpTask?.cancel();
        } catch {
            // A finished or cancelled render task is already inert.
        }
        sharpTask = null;
        sharpRendering = false;
    }

    function paintLens(page: MagnifierPage, crop: SharpCrop | null) {
        if (!lensCanvas || !lensContext) return false;
        const size = sampleSize();
        const windowLeft = pointerX - page.rect.left - size / 2;
        const windowTop = pointerY - page.rect.top - size / 2;
        const imageLeft = crop?.originX ?? 0;
        const imageTop = crop?.originY ?? 0;
        const imageWidth = crop?.width ?? page.rect.width;
        const imageHeight = crop?.height ?? page.rect.height;
        const pixelsPerCssX = crop?.pixelsPerCssX ?? page.canvas.width / page.rect.width;
        const pixelsPerCssY = crop?.pixelsPerCssY ?? page.canvas.height / page.rect.height;
        const left = Math.max(windowLeft, 0, imageLeft);
        const top = Math.max(windowTop, 0, imageTop);
        const right = Math.min(windowLeft + size, page.rect.width, imageLeft + imageWidth);
        const bottom = Math.min(windowTop + size, page.rect.height, imageTop + imageHeight);
        if (right - left < 1 || bottom - top < 1) return false;
        const width = lensCanvas.width;
        const height = lensCanvas.height;
        const scaleX = width / size;
        const scaleY = height / size;
        lensContext.setTransform(1, 0, 0, 1, 0, 0);
        lensContext.fillStyle = '#ffffff';
        lensContext.fillRect(0, 0, width, height);
        lensContext.imageSmoothingEnabled = true;
        lensContext.imageSmoothingQuality = 'high';
        lensContext.drawImage(
            crop?.canvas ?? page.canvas,
            (left - imageLeft) * pixelsPerCssX,
            (top - imageTop) * pixelsPerCssY,
            (right - left) * pixelsPerCssX,
            (bottom - top) * pixelsPerCssY,
            (left - windowLeft) * scaleX,
            (top - windowTop) * scaleY,
            (right - left) * scaleX,
            (bottom - top) * scaleY,
        );
        const radius = width / 2;
        const vignette = lensContext.createRadialGradient(radius, radius, radius * 0.68, radius, radius, radius);
        vignette.addColorStop(0, 'rgba(8, 9, 13, 0)');
        vignette.addColorStop(1, LENS_VIGNETTE);
        lensContext.fillStyle = vignette;
        lensContext.fillRect(0, 0, width, height);
        return true;
    }

    function sharpCropFor(page: MagnifierPage): SharpCrop | null {
        const crop = sharpCrop;
        if (!crop || crop.pageCanvas !== page.canvas || crop.factorSteps !== lensFactorSteps) return null;
        if (
            Math.abs(crop.pageWidth - page.rect.width) > SHARP_COVERAGE_EPSILON ||
            Math.abs(crop.pageHeight - page.rect.height) > SHARP_COVERAGE_EPSILON
        ) {
            return null;
        }
        const size = sampleSize();
        const windowLeft = pointerX - page.rect.left - size / 2;
        const windowTop = pointerY - page.rect.top - size / 2;
        const left = Math.max(0, windowLeft);
        const top = Math.max(0, windowTop);
        const right = Math.min(page.rect.width, windowLeft + size);
        const bottom = Math.min(page.rect.height, windowTop + size);
        const epsilon = SHARP_COVERAGE_EPSILON;
        return crop.originX <= left + epsilon &&
            crop.originY <= top + epsilon &&
            crop.originX + crop.width >= right - epsilon &&
            crop.originY + crop.height >= bottom - epsilon
            ? crop
            : null;
    }

    async function renderSharpCrop(page: MagnifierPage) {
        const doc = PdfState.currentPdfDoc;
        if (!doc || !lensCanvas) return;
        const factorSteps = lensFactorSteps;
        const size = LENS_SIZE / (factorSteps * LENS_FACTOR_STEP);
        const density = lensCanvas.width / size;
        const pageWidth = page.rect.width;
        const pageHeight = page.rect.height;
        const cropWidth = Math.min(pageWidth, size * SHARP_CROP_SCALE);
        const cropHeight = Math.min(pageHeight, size * SHARP_CROP_SCALE);
        if (cropWidth < 1 || cropHeight < 1) return;
        const pointerPageX = pointerX - page.rect.left;
        const pointerPageY = pointerY - page.rect.top;
        const originX = Math.min(Math.max(pointerPageX - cropWidth / 2, 0), pageWidth - cropWidth);
        const originY = Math.min(Math.max(pointerPageY - cropHeight / 2, 0), pageHeight - cropHeight);
        const token = ++sharpRenderToken;
        sharpRendering = true;
        try {
            const pdfPage = await doc.getPage(page.pageNumber);
            if (token !== sharpRenderToken || !isActive() || !lensCanvas || !page.canvas.isConnected) return;
            const viewport = pdfPage.getViewport({ scale: PdfState.currentScale });
            const ratioX = viewport.width / pageWidth;
            const ratioY = viewport.height / pageHeight;
            if (!Number.isFinite(ratioX) || !Number.isFinite(ratioY) || ratioX <= 0 || ratioY <= 0) return;
            const outWidth = Math.max(1, Math.round(cropWidth * density));
            const outHeight = Math.max(1, Math.round(cropHeight * density));
            if (!sharpCanvas) sharpCanvas = document.createElement('canvas');
            sharpCanvas.width = outWidth;
            sharpCanvas.height = outHeight;
            const context = sharpCanvas.getContext('2d');
            if (!context) return;
            const pixelsPerCssX = outWidth / cropWidth;
            const pixelsPerCssY = outHeight / cropHeight;
            const task = pdfPage.render({
                canvasContext: context,
                viewport,
                transform: [
                    pixelsPerCssX / ratioX,
                    0,
                    0,
                    pixelsPerCssY / ratioY,
                    -originX * pixelsPerCssX,
                    -originY * pixelsPerCssY,
                ],
            });
            sharpTask = task;
            try {
                await task.promise;
            } catch {
                return;
            } finally {
                if (sharpTask === task) sharpTask = null;
            }
            if (token !== sharpRenderToken || !isActive() || !page.canvas.isConnected) return;
            sharpCrop = {
                canvas: sharpCanvas,
                pageCanvas: page.canvas,
                factorSteps,
                pageWidth,
                pageHeight,
                originX,
                originY,
                width: cropWidth,
                height: cropHeight,
                pixelsPerCssX,
                pixelsPerCssY,
            };
            schedule();
        } catch {
            // The page may no longer be renderable after a document change.
        } finally {
            sharpRendering = false;
        }
    }

    function maybeRenderSharpCrop(page: MagnifierPage) {
        if (sharpRendering || !isActive()) return;
        const now = performance.now();
        if (now - sharpLastRequestAt < SHARP_RENDER_INTERVAL_MS) return;
        sharpLastRequestAt = now;
        void renderSharpCrop(page);
    }

    function draw() {
        frame = null;
        if (!isActive() || !hasPointer) return hideLens();
        const page = pageUnderPointer();
        if (!page) return hideLens();
        if (!lens || !lensCanvas || !lensContext) createOverlay();
        const crop = sharpCropFor(page);
        if (!paintLens(page, crop)) return hideLens();
        positionLens();
        if (!crop) maybeRenderSharpCrop(page);
    }

    function schedule() {
        if (frame !== null) return;
        frame = requestAnimationFrame(draw);
    }

    function setEnabled(value: boolean) {
        if (enabled === value) return;
        enabled = value;
        updateMagnifierClasses(enabled);
        if (isActive()) {
            schedule();
        } else {
            hideLens();
            invalidateSharpCrop();
        }
    }

    function onPointerMove(event: PointerEvent) {
        pointerX = event.clientX;
        pointerY = event.clientY;
        hasPointer = true;
        if (isActive()) schedule();
    }

    function onPointerLost() {
        hasPointer = false;
        hideLens();
    }

    function onPointerOut(event: PointerEvent) {
        if (!event.relatedTarget) onPointerLost();
    }

    function onScroll() {
        if (isActive() && hasPointer) schedule();
    }

    function resetMomentary() {
        momentary = false;
        if (!enabled) hideLens();
    }

    function onKeyDown(event: KeyboardEvent) {
        const holdingKey =
            event.key.toLowerCase() === MOMENTARY_KEY && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey;
        if (holdingKey && !isTypingTarget(event.target)) {
            momentary = true;
            schedule();
            return;
        }
        if (isTypingTarget(event.target)) return;
        const direction =
            event.key === ']' || event.code === 'BracketRight'
                ? 1
                : event.key === '[' || event.code === 'BracketLeft'
                  ? -1
                  : 0;
        if (direction === 0 || !isActive()) return;
        event.preventDefault();
        adjustLensFactor(direction);
    }

    function isOverScrollArea(x: number, y: number) {
        const scroll = document.getElementById(PDF_SCROLL_CONTAINER_ID);
        if (!scroll) return false;
        const rect = scroll.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }

    function onWheel(event: WheelEvent) {
        if (!isActive() || !(event.ctrlKey || event.metaKey) || event.deltaY === 0) return;
        if (isTypingTarget(event.target) || !isOverScrollArea(event.clientX, event.clientY)) return;
        event.preventDefault();
        const now = performance.now();
        if (now - wheelLastEventAt > WHEEL_GESTURE_TIMEOUT_MS) wheelAccumulator = 0;
        wheelLastEventAt = now;
        const delta =
            event.deltaMode === 1
                ? event.deltaY * 16
                : event.deltaMode === 2
                  ? event.deltaY * window.innerHeight
                  : event.deltaY;
        wheelAccumulator += delta;
        if (Math.abs(wheelAccumulator) < WHEEL_STEP_DISTANCE) return;
        const direction = wheelAccumulator < 0 ? 1 : -1;
        wheelAccumulator = 0;
        adjustLensFactor(direction);
    }

    function onKeyUp(event: KeyboardEvent) {
        if (event.key.toLowerCase() !== MOMENTARY_KEY) return;
        momentary = false;
        if (!enabled) hideLens();
    }

    DOM.magnifierToggleBtn?.addEventListener('click', () => setEnabled(!enabled));
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerout', onPointerOut);
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    document.addEventListener('wheel', onWheel, { capture: true, passive: false });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onPointerLost);
    window.addEventListener('blur', resetMomentary);
    window.addEventListener('resize', onScroll);
}
