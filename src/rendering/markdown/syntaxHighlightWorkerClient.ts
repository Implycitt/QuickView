import SyntaxHighlightWorker from "./syntaxHighlight.worker.ts?worker&inline";
import type { HighlightBlock, HighlightRequest, HighlightResponse } from "./syntaxHighlight.worker.js";

let worker: Worker | null = null;
let nextRequestId = 0;
let failureLogged = false;
const pendingRequests = new Map<number, { count: number; resolve: (results: string[]) => void }>();

function plainResults(count: number): string[] {
    return new Array<string>(count).fill("");
}

function releaseWorker(error: unknown) {
    if (!failureLogged) {
        failureLogged = true;
        console.error("The syntax highlighting worker failed:", error);
    }
    for (const request of pendingRequests.values()) request.resolve(plainResults(request.count));
    pendingRequests.clear();
    worker?.terminate();
    worker = null;
}

function getWorker(): Worker | null {
    if (worker) return worker;
    try {
        worker = new SyntaxHighlightWorker();
    } catch (error) {
        if (!failureLogged) {
            failureLogged = true;
            console.error("Could not start the syntax highlighting worker:", error);
        }
        return null;
    }
    worker.addEventListener("message", (event: MessageEvent<HighlightResponse>) => {
        const request = pendingRequests.get(event.data.id);
        if (!request) return;
        pendingRequests.delete(event.data.id);
        request.resolve(event.data.results);
    });
    worker.addEventListener("error", event => releaseWorker(event.message || event));
    return worker;
}

export function highlightCodeBlocks(blocks: HighlightBlock[]): Promise<string[]> {
    if (!blocks.length) return Promise.resolve([]);
    const activeWorker = getWorker();
    if (!activeWorker) return Promise.resolve(plainResults(blocks.length));

    const id = ++nextRequestId;
    return new Promise<string[]>(resolve => {
        pendingRequests.set(id, { count: blocks.length, resolve });
        const request: HighlightRequest = { id, blocks };
        activeWorker.postMessage(request);
    });
}
