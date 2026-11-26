const MIN_SCROLL_DELTA = 0.5;

/**
 * Move a scroll container immediately.
 *
 * Every scroll the viewer makes should be instant: animated scrolls are merged or cancelled by
 * the next request and by the viewer's own layout passes, which loses steps or drags the view
 * backwards. The `scroll-behavior` override keeps a future stylesheet from reintroducing that.
 */
export function scrollInstantly(container: HTMLElement, top: number): void {
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    const target = Math.max(0, Math.min(maxScroll, top));
    if (Math.abs(target - container.scrollTop) < MIN_SCROLL_DELTA) return;
    container.style.scrollBehavior = "auto";
    container.scrollTop = target;
    container.style.removeProperty("scroll-behavior");
}
