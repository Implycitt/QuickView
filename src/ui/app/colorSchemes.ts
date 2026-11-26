import type { ColorScheme } from "../../types/types.d.ts";

const SELECTED_SCHEME_KEY = "quickview-color-scheme";
const COLOR_VARIABLES: Record<keyof Omit<ColorScheme, "name">, string> = {
    background: "--qv-background",
    panel: "--qv-panel",
    stage: "--qv-stage",
    border: "--qv-border",
    text: "--qv-text",
    muted: "--qv-muted",
    accent: "--qv-accent",
    action: "--qv-action"
};

const themePicker = () => document.getElementById("theme-picker-modal") as HTMLDialogElement;
const themeOptions = () => document.getElementById("color-scheme-options")!;
let schemesLoaded = false;

function relativeLuminance(color: string): number {
    const hex = color.slice(1);
    const normalized = hex.length === 3 ? [...hex].map(channel => channel.repeat(2)).join("") : hex;
    const channels = [0, 2, 4].map(offset => parseInt(normalized.slice(offset, offset + 2), 16) / 255);
    const [red, green, blue] = channels.map(channel =>
        channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    );
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function applyColorScheme(scheme: ColorScheme) {
    const root = document.documentElement;
    for (const [key, variable] of Object.entries(COLOR_VARIABLES) as [keyof typeof COLOR_VARIABLES, string][]) {
        root.style.setProperty(variable, scheme[key]);
    }

    root.style.setProperty("--color-gray-100", scheme.text);
    root.style.setProperty("--color-gray-200", `color-mix(in srgb, ${scheme.text} 88%, ${scheme.muted})`);
    root.style.setProperty("--color-gray-300", `color-mix(in srgb, ${scheme.text} 72%, ${scheme.muted})`);
    root.style.setProperty("--color-gray-400", scheme.muted);
    root.style.setProperty("--color-gray-500", scheme.muted);
    root.style.setProperty("--color-gray-600", scheme.border);
    root.style.setProperty("--color-gray-700", scheme.border);
    root.style.setProperty("--color-gray-800", scheme.panel);
    root.style.setProperty("--color-gray-900", scheme.background);
    root.style.setProperty("--color-lavender-400", scheme.accent);
    root.style.setProperty("--color-lavender-500", scheme.action);
    root.style.setProperty("--color-lavender-600", scheme.action);
    const schemeMode = relativeLuminance(scheme.background) > 0.42 ? "light" : "dark";
    root.style.colorScheme = schemeMode;
    root.dataset.qvScheme = schemeMode;
    root.style.setProperty("--qv-action-text", relativeLuminance(scheme.action) > 0.179 ? "#191B22" : "#FFFFFF");
    try {
        localStorage.setItem(SELECTED_SCHEME_KEY, scheme.name);
    } catch {}
}

function setStatus(message: string) {
    const status = document.getElementById("color-scheme-status");
    if (status) status.textContent = message;
}

async function populateSchemes(announceReload = false) {
    let previous: string | null = null;
    try {
        previous = localStorage.getItem(SELECTED_SCHEME_KEY);
    } catch {}
    const result = await window.electronAPI.getColorSchemes();
    const pickerPath = document.getElementById("theme-picker-file-path");
    if (pickerPath) pickerPath.textContent = result.path;
    const schemes = result.schemes;
    schemesLoaded = schemes.length > 0;
    const options = themeOptions();
    options.replaceChildren();

    const selected = schemes.find(scheme => scheme.name.toLowerCase() === previous?.toLowerCase()) ?? schemes[0];
    if (!selected) {
        setStatus("No valid color schemes found. Check colors.ini.");
        return;
    }

    const fragment = document.createDocumentFragment();
    for (const scheme of schemes) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "theme-option";
        button.dataset.scheme = scheme.name;
        button.setAttribute("role", "radio");
        button.setAttribute("aria-checked", String(scheme.name === selected.name));
        button.setAttribute("aria-label", scheme.name);
        button.tabIndex = scheme.name === selected.name ? 0 : -1;
        button.addEventListener("click", () => selectColorScheme(scheme));

        const swatches = document.createElement("span");
        swatches.className = "theme-option-swatches";
        for (const color of [scheme.background, scheme.panel, scheme.stage, scheme.accent, scheme.action]) {
            const swatch = document.createElement("span");
            swatch.className = "theme-option-swatch";
            swatch.style.backgroundColor = color;
            swatches.append(swatch);
        }

        const description = document.createElement("span");
        description.className = "theme-option-description";
        const name = document.createElement("span");
        name.className = "theme-option-name";
        name.textContent = scheme.name;
        const detail = document.createElement("span");
        detail.className = "theme-option-detail";
        detail.textContent = scheme.name === selected.name ? "Current theme" : "Apply theme";
        description.append(name, detail);
        button.append(swatches, description);
        fragment.append(button);
    }
    options.append(fragment);
    selectColorScheme(selected);
    if (result.usingDefaults) setStatus("No valid schemes found. Using built-in colors.");
    else setStatus(announceReload ? "Color schemes reloaded." : "");
}

function selectColorScheme(scheme: ColorScheme) {
    for (const option of themeOptions().querySelectorAll<HTMLButtonElement>(".theme-option")) {
        const active = option.dataset.scheme === scheme.name;
        option.setAttribute("aria-checked", String(active));
        option.tabIndex = active ? 0 : -1;
        const detail = option.querySelector<HTMLElement>(".theme-option-detail");
        if (detail) detail.textContent = active ? "Current theme" : "Apply theme";
    }
    applyColorScheme(scheme);
    setStatus(`${scheme.name} theme selected.`);
}

export function openThemePicker() {
    const picker = themePicker();
    if (picker.open) return;
    if (!schemesLoaded) {
        setStatus("Themes are still loading. Try again in a moment.");
        return;
    }
    picker.showModal();
    const options = themeOptions().querySelectorAll<HTMLButtonElement>(".theme-option");
    const selected = options ? [...options].find(option => option.getAttribute("aria-checked") === "true") : null;
    (selected ?? options?.[0])?.focus();
}

export function closeThemePicker() {
    const picker = themePicker();
    if (picker.open) picker.close();
}

function handleThemePickerKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeThemePicker();
        return;
    }

    const direction =
        event.key === "ArrowRight" || event.key === "ArrowDown"
            ? 1
            : event.key === "ArrowLeft" || event.key === "ArrowUp"
              ? -1
              : 0;
    if (!direction) return;
    const options = themeOptions().querySelectorAll<HTMLButtonElement>(".theme-option");
    if (!options?.length || !(event.target instanceof HTMLButtonElement)) return;
    const active = [...options].findIndex(option => option === event.target);
    if (active < 0) return;
    const next = (active + direction + options.length) % options.length;
    event.preventDefault();
    options[active].tabIndex = -1;
    options[next].tabIndex = 0;
    options[next].focus();
    options[next].click();
}

export function initColorSchemes() {
    const open = document.getElementById("open-theme-picker");
    const close = document.getElementById("close-theme-picker");
    const reload = document.getElementById("reload-color-schemes");
    const edit = document.getElementById("edit-color-schemes");

    open?.addEventListener("click", openThemePicker);
    close?.addEventListener("click", closeThemePicker);
    const picker = themePicker();
    picker.addEventListener("click", event => {
        if (event.target === picker) closeThemePicker();
    });
    picker.addEventListener("keydown", handleThemePickerKeydown);
    reload?.addEventListener("click", () => {
        void populateSchemes(true).catch((error: unknown) => {
            console.error("Could not reload color schemes:", error);
            setStatus("Could not read colors.ini.");
        });
    });
    edit?.addEventListener("click", () => {
        void window.electronAPI
            .openColorSchemes()
            .then(error => {
                setStatus(error ? `Could not open colors.ini: ${error}` : "Opened colors.ini.");
            })
            .catch((error: unknown) => {
                console.error("Could not open colors.ini:", error);
                setStatus("Could not open colors.ini.");
            });
    });

    void populateSchemes().catch((error: unknown) => {
        console.error("Could not load color schemes:", error);
        setStatus("Could not load colors.ini. The default appearance will be used.");
    });
}
