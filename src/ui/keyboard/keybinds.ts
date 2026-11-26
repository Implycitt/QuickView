import { handleGlobalShortcut, isTypingTarget } from "./shortcuts.js";

import { stepPdfPage } from "../../rendering/pdf/renderer.js";
import { DOM, getScrollMode } from "../core/dom.js";
import { scrollInstantly } from "../core/scroll.js";

const DEFAULT_FREE_SCROLL_AMOUNT = 240;
const MIN_FREE_SCROLL_AMOUNT = 60;
const MAX_FREE_SCROLL_AMOUNT = 720;
const FREE_SCROLL_AMOUNT_KEY = "quickview.free-scroll-amount.v1";
// One knob drives free-mode scrolling: the amount is the distance of a single tap, and a held
// key scrolls at this multiple of it per second (240px taps scroll at 4200px/s).
const FREE_SCROLL_TAP_RATE_PER_SECOND = 17.5;
const FREE_SCROLL_HOLD_DELAY_MS = 120;
const SNAP_SCROLL_REPEAT_DELAY_MS = 220;
const SNAP_SCROLL_REPEAT_INTERVAL_MS = 220;
const MAX_HELD_FRAME_MS = 50;

let freeScrollAmount = readFreeScrollAmount();
let pendingFreeScroll: { key: string; timeoutId: number } | null = null;
let activeFreeScroll: { key: string; frameId: number } | null = null;
let activeSnapScroll: {
    key: string;
    direction: number;
    container: HTMLElement;
    timeoutId: number | null;
    intervalId: number | null;
} | null = null;

export function initKeybinds() {
    document.addEventListener("keydown", event => {
        if (isTypingTarget(event.target) || handleGlobalShortcut(event)) return;
        const key = event.key.toLowerCase();
        const direction = key === "j" || key === "arrowdown" ? 1 : key === "k" || key === "arrowup" ? -1 : 0;
        if (direction === 0) return;
        event.preventDefault();
        handleScrollKeyDown(event, direction);
    });

    document.addEventListener("keyup", event => {
        const key = event.key.toLowerCase();
        stopHeldSnapScroll(key);
        stopHeldFreeScroll(key);
    });
    window.addEventListener("blur", () => {
        stopHeldSnapScroll();
        stopHeldFreeScroll();
    });
    initFreeScrollAmountControl();
}

function readFreeScrollAmount(): number {
    try {
        const stored = Number(localStorage.getItem(FREE_SCROLL_AMOUNT_KEY));
        return Number.isFinite(stored) && stored >= MIN_FREE_SCROLL_AMOUNT && stored <= MAX_FREE_SCROLL_AMOUNT
            ? stored
            : DEFAULT_FREE_SCROLL_AMOUNT;
    } catch {
        return DEFAULT_FREE_SCROLL_AMOUNT;
    }
}

function initFreeScrollAmountControl() {
    const slider = document.getElementById("free-scroll-amount") as HTMLInputElement | null;
    if (!slider) return;
    slider.value = String(freeScrollAmount);
    slider.addEventListener("input", () => {
        freeScrollAmount = Math.min(MAX_FREE_SCROLL_AMOUNT, Math.max(MIN_FREE_SCROLL_AMOUNT, Number(slider.value)));
        try {
            localStorage.setItem(FREE_SCROLL_AMOUNT_KEY, String(freeScrollAmount));
        } catch {
            // The setting still applies for this session if storage is unavailable.
        }
    });
}

function isSnapContainer(container: HTMLElement | null): boolean {
    return getScrollMode(container) === "snap";
}

function heldScrollSpeed(): number {
    return freeScrollAmount * FREE_SCROLL_TAP_RATE_PER_SECOND;
}

function handleScrollKeyDown(event: KeyboardEvent, direction: number) {
    const container = document.getElementById("pdf-scroll-container");
    const snapMode = isSnapContainer(container);
    if (!container || snapMode) {
        if (event.repeat) return;
        stopHeldSnapScroll();
        stopHeldFreeScroll();
        performScroll(direction);
        if (container && snapMode) startHeldSnapScroll(event.key.toLowerCase(), direction, container);
        return;
    }
    if (event.repeat) return;

    stopHeldFreeScroll();
    // Step on key down so a tap lands at once, then keep scrolling only if the key is still down
    // after the hold delay.
    performScroll(direction);
    const key = event.key.toLowerCase();
    const timeoutId = window.setTimeout(() => {
        if (pendingFreeScroll?.key !== key) return;
        pendingFreeScroll = null;
        let lastFrameTime = performance.now();
        const scrollFrame = (frameTime: number) => {
            if (activeFreeScroll?.key !== key) return;
            const activeContainer = document.getElementById("pdf-scroll-container");
            if (!activeContainer || activeContainer !== container || isSnapContainer(activeContainer)) {
                stopHeldFreeScroll();
                return;
            }
            const elapsed = Math.min(frameTime - lastFrameTime, MAX_HELD_FRAME_MS);
            lastFrameTime = frameTime;
            activeContainer.scrollTop += (direction * heldScrollSpeed() * elapsed) / 1000;
            activeFreeScroll.frameId = window.requestAnimationFrame(scrollFrame);
        };
        activeFreeScroll = { key, frameId: window.requestAnimationFrame(scrollFrame) };
    }, FREE_SCROLL_HOLD_DELAY_MS);
    pendingFreeScroll = { key, timeoutId };
}

function startHeldSnapScroll(key: string, direction: number, container: HTMLElement) {
    const repeat = { key, direction, container, timeoutId: null as number | null, intervalId: null as number | null };
    activeSnapScroll = repeat;
    repeat.timeoutId = window.setTimeout(() => {
        if (activeSnapScroll !== repeat) return;
        repeat.timeoutId = null;
        repeatSnapScroll(repeat);
        if (activeSnapScroll === repeat) {
            repeat.intervalId = window.setInterval(() => repeatSnapScroll(repeat), SNAP_SCROLL_REPEAT_INTERVAL_MS);
        }
    }, SNAP_SCROLL_REPEAT_DELAY_MS);
}

function repeatSnapScroll(repeat: NonNullable<typeof activeSnapScroll>) {
    if (activeSnapScroll !== repeat) return;
    const container = document.getElementById("pdf-scroll-container");
    if (!repeat.container.isConnected || container !== repeat.container || !isSnapContainer(repeat.container)) {
        stopHeldSnapScroll(repeat.key);
        return;
    }
    performScroll(repeat.direction);
}

function stopHeldSnapScroll(key?: string) {
    if (!activeSnapScroll || (key && activeSnapScroll.key !== key)) return;
    const repeat = activeSnapScroll;
    activeSnapScroll = null;
    if (repeat.timeoutId !== null) window.clearTimeout(repeat.timeoutId);
    if (repeat.intervalId !== null) window.clearInterval(repeat.intervalId);
}

function stopHeldFreeScroll(key?: string) {
    if (pendingFreeScroll && (!key || pendingFreeScroll.key === key)) {
        window.clearTimeout(pendingFreeScroll.timeoutId);
        pendingFreeScroll = null;
    }
    if (activeFreeScroll && (!key || activeFreeScroll.key === key)) {
        window.cancelAnimationFrame(activeFreeScroll.frameId);
        activeFreeScroll = null;
    }
}

function performScroll(direction: number) {
    const container = document.getElementById("pdf-scroll-container") || DOM.mainContentNode;
    if (!container) return;
    if (isSnapContainer(container)) {
        stepPdfPage(direction);
        return;
    }
    // Free mode steps instantly: an animated scroll is merged or cancelled by the next tap and by
    // the viewer's own layout passes, which loses steps or drags the view backwards.
    scrollInstantly(container, container.scrollTop + freeScrollAmount * direction);
}
