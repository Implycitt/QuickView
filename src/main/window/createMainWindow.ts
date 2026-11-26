import { BrowserWindow, shell } from "electron";

import path from "node:path";

function isDevServerNavigation(targetUrl: string): boolean {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (!devServerUrl) return false;

    try {
        return new URL(targetUrl).origin === new URL(devServerUrl).origin;
    } catch {
        return false;
    }
}

export function createMainWindow(runtimeDir: string) {
    const useCustomTitleBar = process.platform === "linux";
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        autoHideMenuBar: true,
        frame: !useCustomTitleBar,
        backgroundColor: "#191B22",
        webPreferences: {
            preload: path.join(runtimeDir, "../dist-electron/preload.mjs"),
            contextIsolation: true,
            nodeIntegration: false
        },
        icon: path.join(runtimeDir, useCustomTitleBar ? "../assets/icons/icon.png" : "../assets/icons/icon.ico")
    });

    const sendWindowState = () => {
        if (!win.isDestroyed()) win.webContents.send("window:state", { maximized: win.isMaximized() });
    };
    win.on("maximize", sendWindowState);
    win.on("unmaximize", sendWindowState);
    win.on("enter-full-screen", sendWindowState);
    win.on("leave-full-screen", sendWindowState);

    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("http:") || url.startsWith("https:")) void shell.openExternal(url);
        return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, url) => {
        if (isDevServerNavigation(url)) return;
        event.preventDefault();
        if (url.startsWith("http:") || url.startsWith("https:")) void shell.openExternal(url);
    });

    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (devServerUrl) win.loadURL(`${devServerUrl}src/ui/index.html`);
    else win.loadFile(path.join(runtimeDir, "../dist/src/ui/index.html"));
    return win;
}
