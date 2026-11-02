import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    platform: typeof process === 'undefined' ? 'unknown' : process.platform,
    getColorSchemes: () => ipcRenderer.invoke('preferences:get-color-schemes'),
    openColorSchemes: () => ipcRenderer.invoke('preferences:open-color-schemes'),
    pickAndReadFile: () => ipcRenderer.invoke('file:pick-and-read'),
    readFile: (path: string) => ipcRenderer.invoke('file:read', path),
    readFileRange: (path: string, begin: number, end: number) =>
        ipcRenderer.invoke('file:read-range', path, begin, end),
    getLaunchPath: () => ipcRenderer.invoke('file:get-launch-path'),
    onFileUpdated: (callback: (data: any) => void) =>
        ipcRenderer.on('file-updated', (_event: IpcRendererEvent, data: any) => callback(data)),
    onFileUnavailable: (callback: (path: string) => void) =>
        ipcRenderer.on('file-unavailable', (_event: IpcRendererEvent, path: string) => callback(path)),
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    closeWindow: () => ipcRenderer.send('window:close'),
    getWindowState: () => ipcRenderer.invoke('window:get-state'),
    onWindowState: (callback: (state: { maximized: boolean }) => void) =>
        ipcRenderer.on('window:state', (_event: IpcRendererEvent, state: { maximized: boolean }) => callback(state)),
});
