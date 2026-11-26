import hljs from "highlight.js/lib/common";
import cmake from "highlight.js/lib/languages/cmake";
import dart from "highlight.js/lib/languages/dart";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import elixir from "highlight.js/lib/languages/elixir";
import gradle from "highlight.js/lib/languages/gradle";
import groovy from "highlight.js/lib/languages/groovy";
import haskell from "highlight.js/lib/languages/haskell";
import http from "highlight.js/lib/languages/http";
import julia from "highlight.js/lib/languages/julia";
import latex from "highlight.js/lib/languages/latex";
import nginx from "highlight.js/lib/languages/nginx";
import nix from "highlight.js/lib/languages/nix";
import ocaml from "highlight.js/lib/languages/ocaml";
import pgsql from "highlight.js/lib/languages/pgsql";
import powershell from "highlight.js/lib/languages/powershell";
import properties from "highlight.js/lib/languages/properties";
import protobuf from "highlight.js/lib/languages/protobuf";
import scala from "highlight.js/lib/languages/scala";
import vim from "highlight.js/lib/languages/vim";

export type HighlightBlock = { language: string; code: string };
export type HighlightRequest = { id: number; blocks: HighlightBlock[] };
export type HighlightResponse = { id: number; results: string[] };

const EXTRA_LANGUAGES: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
    cmake,
    dart,
    dockerfile,
    elixir,
    gradle,
    groovy,
    haskell,
    http,
    julia,
    latex,
    nginx,
    nix,
    ocaml,
    powershell,
    properties,
    protobuf,
    pgsql,
    scala,
    vim
};

for (const [name, language] of Object.entries(EXTRA_LANGUAGES)) {
    hljs.registerLanguage(name, language);
}

const LANGUAGE_ALIASES: Record<string, string> = {
    "c#": "csharp",
    "c++": "cpp",
    "objective-c": "objectivec",
    astro: "xml",
    json5: "json",
    mdx: "markdown",
    svelte: "xml",
    vue: "xml"
};

const MAX_HIGHLIGHT_LENGTH = 200_000;

function normalizeLanguage(language: string): string {
    const name = language.trim().toLowerCase();
    return LANGUAGE_ALIASES[name] ?? name;
}

function highlight({ language, code }: HighlightBlock): string {
    const name = normalizeLanguage(language);
    if (!name || code.length > MAX_HIGHLIGHT_LENGTH || !hljs.getLanguage(name)) return "";
    try {
        return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
    } catch (error) {
        console.error(`Could not highlight ${name} code:`, error);
        return "";
    }
}

const workerScope = self as unknown as {
    addEventListener(type: "message", listener: (event: MessageEvent<HighlightRequest>) => void): void;
    postMessage(message: HighlightResponse): void;
};

workerScope.addEventListener("message", event => {
    const { id, blocks } = event.data;
    workerScope.postMessage({ id, results: blocks.map(highlight) });
});
