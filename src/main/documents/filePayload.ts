import fs from 'node:fs';
import path from 'node:path';
import type { FileResponse } from '../../types/types.d.ts';

export async function readFilePayload(targetPath: string): Promise<FileResponse> {
    const fileName = path.basename(targetPath);
    const extension = path.extname(fileName).toLowerCase();
    if (extension === '.md' || extension === '.html' || extension === '.htm') {
        const content = await fs.promises.readFile(targetPath, 'utf-8');
        return { name: fileName, path: targetPath, content };
    }

    if (extension === '.pdf') {
        const { size } = await fs.promises.stat(targetPath);
        return { name: fileName, path: targetPath, length: size };
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
