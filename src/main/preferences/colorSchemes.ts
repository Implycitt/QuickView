import { app } from "electron";

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ColorScheme } from "../../types/types.d.ts";

const COLOR_KEYS = ["background", "panel", "stage", "border", "text", "muted", "accent", "action"] as const;
type ColorKey = (typeof COLOR_KEYS)[number];

const MAX_CONFIG_BYTES = 64 * 1024;
const HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{6})$/i;

export function parseColorSchemes(config: string): ColorScheme[] {
    const schemes: ColorScheme[] = [];
    const seenNames = new Set<string>();
    let currentName: string | null = null;
    let currentValues: Partial<Record<ColorKey, string>> = {};

    const saveCurrent = () => {
        if (!currentName || seenNames.has(currentName.toLowerCase())) return;
        if (!COLOR_KEYS.every(key => currentValues[key] && HEX_COLOR.test(currentValues[key]))) return;
        schemes.push({ name: currentName, ...(currentValues as Record<ColorKey, string>) });
        seenNames.add(currentName.toLowerCase());
    };

    for (const rawLine of config.replace(/^\uFEFF/, "").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith(";") || line.startsWith("#")) continue;
        const section = /^\[([^\]]+)\]$/.exec(line);
        if (section) {
            saveCurrent();
            currentName = section[1].trim().slice(0, 40);
            currentValues = {};
            continue;
        }
        const separator = line.indexOf("=");
        if (!currentName || separator < 0) continue;
        const key = line.slice(0, separator).trim().toLowerCase() as ColorKey;
        const value = line.slice(separator + 1).trim();
        if (COLOR_KEYS.includes(key)) currentValues[key] = value;
    }
    saveCurrent();
    return schemes;
}

function addMissingBuiltInSchemes(config: string, builtInSchemes: ColorScheme[]): string {
    const existingNames = new Set(parseColorSchemes(config).map(scheme => scheme.name.toLowerCase()));
    const missing = builtInSchemes.filter(scheme => !existingNames.has(scheme.name.toLowerCase()));
    if (!missing.length) return config;

    const newline = String.fromCharCode(10);
    const separator = `${newline}${newline}`;
    const additions = missing
        .map(scheme => {
            const colors = COLOR_KEYS.map(key => `${key} = ${scheme[key]}`).join(newline);
            return `[${scheme.name}]${newline}${colors}`;
        })
        .join(separator);
    return `${config.trimEnd()}${separator}${additions}${newline}`;
}

export async function loadColorSchemes(): Promise<{
    path: string;
    schemes: ColorScheme[];
    usingDefaults: boolean;
}> {
    const shippedConfigPath = path.join(app.getAppPath(), "colors.ini");
    const shippedConfig = await readFile(shippedConfigPath, "utf8");
    const builtInSchemes = parseColorSchemes(shippedConfig);
    if (builtInSchemes.length === 0) throw new Error(`No valid color schemes found in ${shippedConfigPath}`);

    const configPath = app.isPackaged ? path.join(app.getPath("userData"), "colors.ini") : shippedConfigPath;
    await mkdir(path.dirname(configPath), { recursive: true });

    let config: string;
    try {
        config = await readFile(configPath, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        config = shippedConfig;
        await writeFile(configPath, config, { encoding: "utf8", flag: "wx" }).catch(async writeError => {
            if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
            config = await readFile(configPath, "utf8");
        });
    }

    if (Buffer.byteLength(config, "utf8") > MAX_CONFIG_BYTES) {
        return { path: configPath, schemes: builtInSchemes, usingDefaults: true };
    }

    const updatedConfig = addMissingBuiltInSchemes(config, builtInSchemes);
    if (updatedConfig !== config && Buffer.byteLength(updatedConfig, "utf8") <= MAX_CONFIG_BYTES) {
        const appendedContent = updatedConfig.slice(config.trimEnd().length);
        await appendFile(configPath, appendedContent, "utf8");
        config = updatedConfig;
    }

    const schemes = parseColorSchemes(config);
    const existingNames = new Set(schemes.map(scheme => scheme.name.toLowerCase()));
    const availableSchemes = [
        ...schemes,
        ...builtInSchemes.filter(scheme => !existingNames.has(scheme.name.toLowerCase()))
    ];
    return {
        path: configPath,
        schemes: availableSchemes.length ? availableSchemes : builtInSchemes,
        usingDefaults: schemes.length === 0
    };
}
