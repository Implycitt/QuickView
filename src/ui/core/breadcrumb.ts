import { DOM } from "./dom.js";

export const BREADCRUMB_SEPARATOR = " > ";
const ELISION_MARKER = "...";
const FIT_TOLERANCE_PX = 1;

let currentTrail = "";
let refitScheduled = false;

function sections(trail: string): string[] {
    return trail.split(BREADCRUMB_SEPARATOR).slice(1);
}

function candidateTrails(segments: string[]): string[] {
    const deepest = segments[segments.length - 1];
    const options = [segments.join(BREADCRUMB_SEPARATOR)];
    if (segments.length > 2) {
        options.push([segments[0], ELISION_MARKER, deepest].join(BREADCRUMB_SEPARATOR));
    }
    if (segments.length > 1) {
        options.push([ELISION_MARKER, deepest].join(BREADCRUMB_SEPARATOR));
    }
    if (options[options.length - 1] !== deepest) options.push(deepest);
    return options;
}

function widestFittingTrail(element: HTMLElement, options: string[]): string {
    element.textContent = options[0];
    const allowance = element.clientWidth;
    if (allowance <= FIT_TOLERANCE_PX) return options[options.length - 1];
    if (element.scrollWidth <= allowance + FIT_TOLERANCE_PX) return options[0];
    for (const option of options.slice(1)) {
        element.textContent = option;
        if (element.scrollWidth <= allowance + FIT_TOLERANCE_PX) return option;
    }
    return options[options.length - 1];
}

function renderTrail(element: HTMLElement, trail: string): void {
    const segments = trail ? sections(trail) : [];
    element.classList.toggle("hidden", segments.length === 0);
    if (segments.length === 0) {
        if (element.textContent) element.textContent = "";
        return;
    }
    const fitted = widestFittingTrail(element, candidateTrails(segments));
    if (element.textContent !== fitted) element.textContent = fitted;
}

function scheduleRefit(): void {
    if (refitScheduled) return;
    refitScheduled = true;
    requestAnimationFrame(() => {
        refitScheduled = false;
        const element = DOM.breadcrumb;
        if (!element || !currentTrail) return;
        renderTrail(element, currentTrail);
    });
}

window.addEventListener("resize", scheduleRefit);

export function setBreadcrumbPath(path: string | null) {
    const element = DOM.breadcrumb;
    if (!element) return;

    const trail = path ?? "";
    if (element.title !== trail) element.title = trail;
    if (trail === currentTrail) return;

    currentTrail = trail;
    renderTrail(element, trail);
}
