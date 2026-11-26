declare module "*.css";
declare module "*?url" {
    const url: string;
    export default url;
}
declare module "*.html?raw" {
    const content: string;
    export default content;
}
declare module "*?worker&inline" {
    const WorkerFactory: new () => Worker;
    export default WorkerFactory;
}
declare module "markdown-it-texmath";
declare module "highlight.js/lib/languages/*" {
    const language: import("highlight.js").LanguageFn;
    export default language;
}
