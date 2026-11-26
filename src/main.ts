process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";

import { app, Menu } from "electron";

import path from "node:path";
import { fileURLToPath } from "node:url";

import { registerIpcHandlers } from "./main/ipc/handlers.js";
import { registerAssetProtocol, registerAssetScheme } from "./main/protocol/assetProtocol.js";
import { createMainWindow } from "./main/window/createMainWindow.js";

import "./main/preferences/discordRPC.js";

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(app.isPackaged ? 1 : 2);
const launchPath = args[0] && !args[0].startsWith("--") ? args[0] : null;

registerAssetScheme();
registerIpcHandlers(launchPath);

app.whenReady().then(() => {
    registerAssetProtocol();
    Menu.setApplicationMenu(null);
    if (process.platform === "linux" && app.isPackaged) app.setDesktopName("quickview.desktop");
    createMainWindow(runtimeDir);
});
