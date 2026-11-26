import type { HighlightBlock } from "./syntaxHighlight.worker.js";

export type FenceCodeBlock = HighlightBlock;

type WorkerClient = typeof import("./syntaxHighlightWorkerClient.js");

let workerClient: Promise<WorkerClient> | null = null;
let loadFailureLogged = false;

function plainResults(count: number): string[] {
    return new Array<string>(count).fill("");
}

export function isMathFenceLanguage(language: string): boolean {
    const name = language.toLowerCase();
    return name === "latex" || name === "math";
}

export async function highlightCodeBlocks(blocks: FenceCodeBlock[]): Promise<string[]> {
    if (!blocks.length) return [];
    try {
        workerClient ??= import("./syntaxHighlightWorkerClient.js");
        const client = await workerClient;
        return await client.highlightCodeBlocks(blocks);
    } catch (error) {
        workerClient = null;
        if (!loadFailureLogged) {
            loadFailureLogged = true;
            console.error("Could not load the syntax highlighting worker:", error);
        }
        return plainResults(blocks.length);
    }
}
