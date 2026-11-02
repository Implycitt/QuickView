import { net, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ASSET_CONTENT_TYPES: Record<string, string> = {
    '.aac': 'audio/aac',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.css': 'text/css; charset=utf-8',
    '.eot': 'application/vnd.ms-fontobject',
    '.flac': 'audio/flac',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.m4a': 'audio/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.oga': 'audio/ogg',
    '.ogg': 'audio/ogg',
    '.ogv': 'video/ogg',
    '.otf': 'font/otf',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.wav': 'audio/wav',
    '.webm': 'video/webm',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

let allowedAssetRoot: string | null = null;

export async function setAllowedAssetRoot(filePath: string | null) {
    allowedAssetRoot = filePath ? await fs.promises.realpath(path.dirname(filePath)) : null;
}

export function registerAssetScheme() {
    protocol.registerSchemesAsPrivileged([
        {
            scheme: 'quickview-asset',
            privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
        },
    ]);
}

function pathFromRequest(requestUrl: URL): string | null {
    const queryPath = requestUrl.searchParams.get('path');
    if (queryPath) return path.isAbsolute(queryPath) ? queryPath : null;

    const parts = requestUrl.pathname
        .split('/')
        .filter(Boolean)
        .map((part) => decodeURIComponent(part));
    if (parts[0] === '_unc') {
        const [host, ...rest] = parts.slice(1);
        return host && rest.length ? `//${host}${path.sep}${rest.join(path.sep)}` : null;
    }
    if (parts[0] === '_abs') return path.join(path.parse(process.cwd()).root, ...parts.slice(1));
    if (/^[a-z]:$/i.test(parts[0] ?? '')) {
        const [drive, ...rest] = parts;
        return `${drive}${path.sep}${rest.join(path.sep)}`;
    }
    return path.join(allowedAssetRoot ?? path.parse(process.cwd()).root, ...parts);
}

function parseRange(header: string | null, size: number): { start: number; end: number } | 'invalid' | null {
    if (!header) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match || (match[1] === '' && match[2] === '')) return 'invalid';
    let start: number;
    let end: number;
    if (match[1] === '') {
        const suffix = Number(match[2]);
        start = Math.max(0, size - suffix);
        end = size - 1;
    } else {
        start = Number(match[1]);
        end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
    }
    if (size === 0 || start >= size || start > end) return 'invalid';
    return { start, end };
}

function isWithinRoot(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return (
        relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
    );
}

export function registerAssetProtocol() {
    protocol.handle('quickview-asset', async (request) => {
        try {
            const requestUrl = new URL(request.url);
            if (requestUrl.hostname !== 'media' || !allowedAssetRoot) {
                return new Response('Not found', { status: 404 });
            }
            const requestedPath = pathFromRequest(requestUrl);
            if (!requestedPath) return new Response('Invalid media path', { status: 400 });
            const extension = path.extname(requestedPath).toLowerCase();
            const contentType = ASSET_CONTENT_TYPES[extension];
            const isHtml = extension === '.html' || extension === '.htm';
            if (!contentType) return new Response('Unsupported media type', { status: 415 });
            if (
                isHtml &&
                requestUrl.searchParams.get('document') !== '1' &&
                request.headers.get('sec-fetch-dest') !== 'document'
            ) {
                return new Response('HTML subresources are not allowed', { status: 415 });
            }

            const resolvedPath = await fs.promises.realpath(requestedPath);
            if (!isWithinRoot(allowedAssetRoot, resolvedPath)) {
                return new Response('Asset is outside the document folder', { status: 403 });
            }
            const stats = await fs.promises.stat(resolvedPath);
            if (!stats.isFile()) return new Response('Media not found', { status: 404 });
            await fs.promises.access(resolvedPath, fs.constants.R_OK);
            const range = parseRange(request.headers.get('range'), stats.size);
            if (range === 'invalid') {
                return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stats.size}` } });
            }
            if (range) {
                const length = range.end - range.start + 1;
                const handle = await fs.promises.open(resolvedPath, 'r');
                try {
                    const buffer = Buffer.alloc(length);
                    await handle.read(buffer, 0, length, range.start);
                    const headers = new Headers({
                        'Content-Type': contentType,
                        'Content-Length': String(length),
                        'Content-Range': `bytes ${range.start}-${range.end}/${stats.size}`,
                        'Accept-Ranges': 'bytes',
                        'X-Content-Type-Options': 'nosniff',
                    });
                    return new Response(buffer, { status: 206, headers });
                } finally {
                    await handle.close();
                }
            }
            const file = await net.fetch(pathToFileURL(resolvedPath).href);
            const headers = new Headers(file.headers);
            headers.set('Content-Type', contentType);
            headers.set('X-Content-Type-Options', 'nosniff');
            if (isHtml) {
                headers.set(
                    'Content-Security-Policy',
                    "default-src 'none'; script-src 'none'; connect-src 'none'; img-src data: blob: quickview-asset: https: http:; style-src 'unsafe-inline' quickview-asset: https: http:; font-src data: quickview-asset: https: http:; media-src data: blob: quickview-asset: https: http:; frame-src 'none'; object-src 'none'; form-action 'none';",
                );
            }
            return new Response(file.body, { status: file.status, headers });
        } catch {
            return new Response('Media not found', { status: 404 });
        }
    });
}
