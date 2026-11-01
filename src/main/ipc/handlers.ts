import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { readFilePayload, validateDocumentPath } from '../documents/filePayload.js';
import { watchDocument } from '../documents/fileWatcher.js';
import { loadColorSchemes } from '../preferences/colorSchemes.js';
import { setAllowedAssetRoot } from '../protocol/assetProtocol.js';

export function registerIpcHandlers(launchPath: string | null) {
    let launchPathDelivered = false;

    ipcMain.handle('preferences:get-color-schemes', () => loadColorSchemes());
    ipcMain.handle('preferences:open-color-schemes', async () => {
        const { path: configPath } = await loadColorSchemes();
        const error = await shell.openPath(configPath);
        if (error) shell.showItemInFolder(configPath);
        return error;
    });

    ipcMain.handle('file:get-launch-path', () => {
        if (launchPathDelivered) return null;
        launchPathDelivered = true;
        return launchPath ? path.resolve(launchPath) : null;
    });

    async function readAndWatchDocument(targetPath: string, sender: Electron.WebContents) {
        const validPath = await validateDocumentPath(targetPath);
        const [payload] = await Promise.all([readFilePayload(validPath), setAllowedAssetRoot(validPath)]);
        watchDocument(validPath, sender, () => readFilePayload(validPath));
        return payload;
    }

    ipcMain.handle('file:read', (event, targetPath: string) => readAndWatchDocument(targetPath, event.sender));

    ipcMain.handle('file:pick-and-read', async (event) => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'Documents', extensions: ['md', 'pdf', 'html', 'htm'] }],
        });
        if (canceled || filePaths.length === 0) return null;

        return readAndWatchDocument(filePaths[0], event.sender);
    });

    ipcMain.on('window:minimize', (event) => {
        BrowserWindow.fromWebContents(event.sender)?.minimize();
    });
    ipcMain.on('window:toggle-maximize', (event) => {
        const target = BrowserWindow.fromWebContents(event.sender);
        if (!target) return;
        if (target.isMaximized()) target.unmaximize();
        else target.maximize();
    });
    ipcMain.on('window:close', (event) => {
        BrowserWindow.fromWebContents(event.sender)?.close();
    });
    ipcMain.handle('window:get-state', (event) => {
        const target = BrowserWindow.fromWebContents(event.sender);
        return { maximized: target?.isMaximized() ?? false };
    });

    ipcMain.handle('shell:open-external', async (_event, rawUrl: string) => {
        if (typeof rawUrl !== 'string') return;
        let parsed: URL;
        try {
            parsed = new URL(rawUrl);
        } catch {
            return;
        }
        if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) await shell.openExternal(rawUrl);
    });
}
