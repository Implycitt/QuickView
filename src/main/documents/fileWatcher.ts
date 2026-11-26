import fs from "node:fs";

interface ActiveWatcher {
    sender: Electron.WebContents;
    listener: (curr: fs.Stats, prev: fs.Stats) => void;
    debounceTimer: ReturnType<typeof setTimeout> | null;
    revision: number;
    latestStats: fs.Stats | null;
    destroyedListener: () => void;
}

let activeWatchedPath: string | null = null;
let activeWatcher: ActiveWatcher | null = null;

function stopActiveWatcher() {
    const watcher = activeWatcher;
    if (!watcher) return;
    activeWatcher = null;
    const watchedPath = activeWatchedPath;
    activeWatchedPath = null;
    if (watchedPath) fs.unwatchFile(watchedPath, watcher.listener);
    if (watcher.debounceTimer) clearTimeout(watcher.debounceTimer);
    watcher.sender.removeListener("destroyed", watcher.destroyedListener);
}

function sameFileVersion(left: fs.Stats, right: fs.Stats): boolean {
    return (
        left.mtimeMs === right.mtimeMs &&
        left.ctimeMs === right.ctimeMs &&
        left.size === right.size &&
        left.ino === right.ino &&
        left.dev === right.dev
    );
}

export function watchDocument(targetPath: string, sender: Electron.WebContents, readPayload: () => Promise<unknown>) {
    stopActiveWatcher();
    activeWatchedPath = targetPath;
    const watcher: ActiveWatcher = {
        sender,
        listener: () => {},
        debounceTimer: null,
        revision: 0,
        latestStats: null,
        destroyedListener: () => {}
    };

    const scheduleReload = () => {
        if (watcher.debounceTimer) clearTimeout(watcher.debounceTimer);
        const revision = watcher.revision;
        watcher.debounceTimer = setTimeout(async () => {
            watcher.debounceTimer = null;
            if (activeWatcher !== watcher || revision !== watcher.revision || sender.isDestroyed()) return;

            try {
                const beforeRead = await fs.promises.stat(targetPath);
                if (activeWatcher !== watcher || revision !== watcher.revision || sender.isDestroyed()) return;
                if (watcher.latestStats && !sameFileVersion(beforeRead, watcher.latestStats)) {
                    watcher.latestStats = beforeRead;
                    watcher.revision++;
                    scheduleReload();
                    return;
                }

                const payload = await readPayload();
                if (activeWatcher !== watcher || revision !== watcher.revision || sender.isDestroyed()) return;
                const afterRead = await fs.promises.stat(targetPath);
                if (!sameFileVersion(beforeRead, afterRead)) {
                    watcher.latestStats = afterRead;
                    watcher.revision++;
                    scheduleReload();
                    return;
                }
                if (activeWatcher !== watcher || revision !== watcher.revision || sender.isDestroyed()) return;
                sender.send("file-updated", payload);
            } catch (error) {
                if (activeWatcher !== watcher || revision !== watcher.revision) return;
                if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                    if (!sender.isDestroyed()) sender.send("file-unavailable", targetPath);
                    stopActiveWatcher();
                    return;
                }
                console.error("[Main] Error re-reading file on update:", error);
            }
        }, 200);
    };

    watcher.listener = (curr, prev) => {
        if (sameFileVersion(curr, prev) || sender.isDestroyed()) return;
        watcher.latestStats = curr;
        watcher.revision++;
        scheduleReload();
    };

    watcher.destroyedListener = () => {
        if (activeWatcher === watcher) stopActiveWatcher();
    };
    activeWatcher = watcher;
    sender.once("destroyed", watcher.destroyedListener);
    fs.watchFile(targetPath, { interval: 100 }, watcher.listener);
}
