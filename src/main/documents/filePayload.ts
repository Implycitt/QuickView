import fs from 'node:fs';
import path from 'node:path';
import type { FileResponse } from '../../types/types.d.ts';

const PDF_CACHE_LIMIT = 3;
const pdfCache = new Map<string, { size: number; mtimeMs: number; data: Buffer }>();

async function readPdfCached(targetPath: string): Promise<Buffer> {
    const stat = await fs.promises.stat(targetPath);
    const cached = pdfCache.get(targetPath);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
        pdfCache.delete(targetPath);
        pdfCache.set(targetPath, cached);
        return cached.data;
    }
    const data = await fs.promises.readFile(targetPath);
    pdfCache.delete(targetPath);
    pdfCache.set(targetPath, { size: stat.size, mtimeMs: stat.mtimeMs, data });
    while (pdfCache.size > PDF_CACHE_LIMIT) {
        const oldest = pdfCache.keys().next().value;
        if (oldest === undefined) break;
        pdfCache.delete(oldest);
    }
    return data;
}

export async function readFilePayload(targetPath: string): Promise<FileResponse> {
    const fileName = path.basename(targetPath);
    const extension = path.extname(fileName).toLowerCase();
    if (extension === '.md' || extension === '.html' || extension === '.htm') {
        const content = await fs.promises.readFile(targetPath, 'utf-8');
        return { name: fileName, path: targetPath, content };
    }

    if (extension === '.pdf') {
        const data = await readPdfCached(targetPath);
        return { name: fileName, path: targetPath, data };
    }

    const data = await fs.promises.readFile(targetPath);
    return { name: fileName, path: targetPath, data };
}

export async function validateDocumentPath(targetPath: unknown): Promise<string> {
    if (typeof targetPath !== 'string' || !path.isAbsolute(targetPath)) {
        throw new Error('A valid absolute file path is required.');
    }

    const extension = path.extname(targetPath).toLowerCase();
    if (!['.md', '.pdf', '.html', '.htm'].includes(extension)) {
        throw new Error('QuickView only opens Markdown, PDF, and HTML documents.');
    }

    await fs.promises.access(targetPath, fs.constants.R_OK);
    return targetPath;
}
