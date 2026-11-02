export type ColorScheme = {
    name: string;
    background: string;
    panel: string;
    stage: string;
    border: string;
    text: string;
    muted: string;
    accent: string;
    action: string;
};

export type FileResponse = {
    name: string;
    path: string;
} & (
    | { data: Uint8Array; content?: never; length?: never }
    | { content: string; data?: never; length?: never }
    | { length: number; data?: never; content?: never }
);

declare global {
    interface Window {
        electronAPI: {
            platform: string;
            getColorSchemes: () => Promise<{ path: string; schemes: ColorScheme[]; usingDefaults: boolean }>;
            openColorSchemes: () => Promise<string>;
            pickAndReadFile: () => Promise<FileResponse | null>;
            readFile: (path: string) => Promise<FileResponse>;
            readFileRange: (path: string, begin: number, end: number) => Promise<Uint8Array>;
            getLaunchPath: () => Promise<string | null>;
            onFileUpdated: (callback: (data: FileResponse) => void) => void;
            onFileUnavailable: (callback: (path: string) => void) => void;
            openExternal: (url: string) => Promise<void>;
            minimize: () => void;
            toggleMaximize: () => void;
            closeWindow: () => void;
            getWindowState: () => Promise<{ maximized: boolean }>;
            onWindowState: (callback: (state: { maximized: boolean }) => void) => void;
        };
    }
}
