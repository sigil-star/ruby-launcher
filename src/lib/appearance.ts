import { t } from "./i18n";
// Device-only look and feel: mode, accent, background, font, density, motion and text size.
// Everything lives in localStorage on this PC (a custom background file goes in IndexedDB),
// and applyDisplayPrefs() turns it into classes and CSS variables on <html>.

export const ACCENTS = [
  { id: "blue", name: "Blue", color: "#335fff" },
  { id: "red", name: "Red", color: "#e5243b" },
  { id: "purple", name: "Purple", color: "#7c4dff" },
  { id: "green", name: "Green", color: "#1fa055" },
  { id: "pink", name: "Pink", color: "#e5408f" },
  { id: "orange", name: "Orange", color: "#f07c00" },
  { id: "teal", name: "Teal", color: "#0fa3a3" },
  { id: "gold", name: "Gold", color: "#d29a00" },
] as const;

/** UI fonts. Builder Sans comes from the Roblox install; the rest ship with Ruby (OFL, see licenses). */
export const FONTS = [
  { id: "builder", name: "Builder Sans", stack: `"Builder Sans", "Segoe UI", system-ui, sans-serif` },
  { id: "system", name: "Windows (Segoe UI)", stack: `"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif` },
  { id: "inter", name: "Inter", stack: `"Ruby Inter", "Segoe UI", sans-serif` },
  { id: "nunito", name: "Nunito", stack: `"Ruby Nunito", "Segoe UI", sans-serif` },
  { id: "outfit", name: "Outfit", stack: `"Ruby Outfit", "Segoe UI", sans-serif` },
  { id: "lexend", name: "Lexend", stack: `"Ruby Lexend", "Segoe UI", sans-serif` },
  { id: "fredoka", name: "Fredoka", stack: `"Ruby Fredoka", "Segoe UI", sans-serif` },
  { id: "atkinson", name: "Atkinson Hyperlegible", stack: `"Ruby Atkinson", "Segoe UI", sans-serif` },
  { id: "mono", name: "JetBrains Mono", stack: `"Ruby Mono", Consolas, monospace` },
] as const;

export const CORNERS = [
  { id: "square", name: "Square", scale: 0 },
  { id: "subtle", name: "Subtle", scale: 0.5 },
  { id: "default", name: "Default", scale: 1 },
  { id: "round", name: "Round", scale: 1.7 },
] as const;

export const TILE_SIZES = { small: [200, 108], medium: [250, 128], large: [310, 160] } as const;

export type Background = { id: string; name: string; src: string; still: string; thumb: string; animated?: boolean };

/** Ruby no longer bundles backgrounds; you pick them from the wallpaper search or your own files. */
export const BACKGROUNDS: Background[] = [];

export const DEFAULTS = {
  mode: "dark",
  accent: "blue",
  accentCustom: "#ff5ca8",
  bg: "none",
  bgDim: "72",
  bgBlur: "0",
  bgAnimate: "1",
  font: "builder",
  density: "comfortable",
  reduceMotion: "0",
  textSize: "0",
  corners: "default",
  tiles: "medium",
  railLabels: "1",
  railTint: "0",
  startPage: "home",
  streamer: "0",
};
export type PrefKey = keyof typeof DEFAULTS;

export function pref(k: PrefKey): string {
  try {
    return localStorage.getItem(`ruby.${k}`) ?? DEFAULTS[k];
  } catch {
    return DEFAULTS[k];
  }
}

export function setPref(k: PrefKey, v: string) {
  try {
    localStorage.setItem(`ruby.${k}`, v);
  } catch {
    /* preferences are optional */
  }
  applyDisplayPrefs();
}

/** Streamer mode: personal details (balance, username, server ids, links, message previews) are hidden. */
export const streamerMode = () => pref("streamer") === "1";

export function resetAppearance() {
  for (const k of Object.keys(DEFAULTS)) {
    try {
      localStorage.removeItem(`ruby.${k}`);
    } catch {
      /* ignore */
    }
  }
  void clearCustomBackground();
  applyDisplayPrefs();
}

const hexRgb = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (c: [number, number, number], to: number, t: number) => c.map((x) => Math.round(x + (to - x) * t)) as [number, number, number];
const hex = (c: [number, number, number]) => `#${c.map((x) => x.toString(16).padStart(2, "0")).join("")}`;

/** Light mode means "follow Windows" when the mode is "system". */
function resolvedMode(): "dark" | "black" | "light" {
  const m = pref("mode");
  if (m === "system") return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  return m === "black" || m === "light" ? m : "dark";
}

let systemListener = false;

export function applyDisplayPrefs() {
  const root = document.documentElement;
  const cl = root.classList;
  try {
    cl.toggle("reduce-motion", pref("reduceMotion") === "1");
    root.style.setProperty("--text-scale", String(1 + Number(pref("textSize")) * 0.06));
    // The in-game overlay and the toast window sit on top of Roblox, so they always stay dark.
    if (location.hash === "#overlay" || location.hash === "#toasts") return;

    const mode = resolvedMode();
    cl.remove("theme-black", "theme-light", ...ACCENTS.map((a) => `accent-${a.id}`), "accent-custom");
    if (mode !== "dark") cl.add(`theme-${mode}`);

    const accent = pref("accent");
    const custom = accent === "custom" ? hexRgb(pref("accentCustom")) : null;
    for (const p of ["--blue", "--blue-hover", "--blue-rgb", "--blue-soft"]) root.style.removeProperty(p);
    if (custom) {
      cl.add("accent-custom");
      root.style.setProperty("--blue", hex(custom));
      root.style.setProperty("--blue-hover", hex(mix(custom, 255, 0.12)));
      root.style.setProperty("--blue-rgb", custom.join(", "));
      root.style.setProperty("--blue-soft", hex(mode === "light" ? mix(custom, 0, 0.3) : mix(custom, 255, 0.45)));
    } else if (accent !== "blue") cl.add(`accent-${accent}`);

    const font = FONTS.find((x) => x.id === pref("font")) ?? FONTS[0];
    root.style.setProperty("--ui-font", font.stack);
    root.style.setProperty("--round", String((CORNERS.find((x) => x.id === pref("corners")) ?? CORNERS[2]).scale));
    const tiles = TILE_SIZES[pref("tiles") as keyof typeof TILE_SIZES] ?? TILE_SIZES.medium;
    root.style.setProperty("--tile-game", `${tiles[0]}px`);
    root.style.setProperty("--tile-small", `${tiles[1]}px`);
    cl.toggle("rail-no-labels", pref("railLabels") === "0");
    cl.toggle("rail-tint", pref("railTint") === "1");
    cl.toggle("streamer", pref("streamer") === "1");
    cl.toggle("density-compact", pref("density") === "compact");

    // Older versions offered bundled pictures; those ids now mean no background.
    const bg = pref("bg") === "custom" ? "custom" : "none";
    cl.toggle("has-bg", bg !== "none");
    root.style.setProperty("--bg-dim", String(Math.min(95, Math.max(30, Number(pref("bgDim")))) / 100));
    root.style.setProperty("--bg-blur", `${Math.min(30, Math.max(0, Number(pref("bgBlur"))))}px`);

    if (!systemListener && window.matchMedia) {
      systemListener = true;
      window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => pref("mode") === "system" && applyDisplayPrefs());
    }
  } catch {
    /* preferences are optional */
  } finally {
    window.dispatchEvent(new Event("ruby:prefs"));
  }
}

const DB = "ruby-appearance";
const STORE = "files";
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = fn(d.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const MAX_BACKGROUND_BYTES = 40 * 1024 * 1024;
export const BACKGROUND_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/webm"];

let customVersion = 0;
/** Changes whenever a new custom file is saved, so the background reloads it. */
export const customBackgroundVersion = () => customVersion;

export async function saveCustomBackground(file: File) {
  if (!BACKGROUND_TYPES.includes(file.type)) throw new Error(t("Use a PNG, JPG, WebP, GIF, MP4 or WebM file."));
  if (file.size > MAX_BACKGROUND_BYTES) throw new Error(t("That file is over 40 MB."));
  await tx("readwrite", (s) => s.put(file, "bg"));
  customVersion++;
  setPref("bg", "custom");
}

export async function loadCustomBackground(): Promise<Blob | null> {
  try {
    return ((await tx("readonly", (s) => s.get("bg"))) as Blob | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function clearCustomBackground() {
  try {
    await tx("readwrite", (s) => s.delete("bg"));
  } catch {
    /* nothing saved */
  }
}

let fontsLoaded = false;
/** Registers Builder Sans from Roblox's own files. Until then (or without Roblox) Segoe UI shows. */
export async function loadUiFont(retry = true) {
  if (fontsLoaded) return;
  try {
    const { call } = await import("./ipc");
    const { faces } = await call<{ faces: { weight: number; url: string }[] }>("uiFonts");
    if (!faces.length) {
      // Roblox may still be installing on first run; look again in a minute.
      if (retry) setTimeout(() => void loadUiFont(true), 60_000);
      return;
    }
    await Promise.all(
      faces.map(async (f) => {
        const face = new FontFace("Builder Sans", `url(${f.url})`, { weight: String(f.weight) });
        await face.load();
        document.fonts.add(face);
      }),
    );
    fontsLoaded = true;
  } catch {
    /* the fallback font is fine */
  }
}

/* ── Recent backgrounds: the last few you picked, kept on this PC for one-click switching ── */

export type RecentBackground = { id: string; title: string; thumb: string | null; video: boolean; credit?: unknown };
const RECENTS_KEY = "ruby.bgRecents";
const MAX_RECENTS = 8;

export function recentBackgrounds(): RecentBackground[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(v) ? v.slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}
function writeRecents(list: RecentBackground[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    /* recents are optional */
  }
  window.dispatchEvent(new Event("ruby:prefs"));
}

/** A small preview for an uploaded picture (videos show their name instead). */
async function smallThumb(file: Blob): Promise<string | null> {
  if (!file.type.startsWith("image/")) return null;
  try {
    const bmp = await createImageBitmap(file);
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 180;
    const ctx = c.getContext("2d")!;
    const s = Math.max(c.width / bmp.width, c.height / bmp.height);
    ctx.drawImage(bmp, (c.width - bmp.width * s) / 2, (c.height - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
    return c.toDataURL("image/jpeg", 0.8);
  } catch {
    return null;
  }
}

/** Save the file as the background and put it first in recents. */
export async function setBackgroundFile(file: File, meta: { id?: string; title?: string; thumb?: string | null; credit?: unknown } = {}) {
  await saveCustomBackground(file);
  const id = meta.id ?? `file-${Date.now()}`;
  await tx("readwrite", (s) => s.put(file, `recent:${id}`)).catch(() => undefined);
  const entry: RecentBackground = { id, title: meta.title ?? file.name.replace(/\.[^.]+$/, ""), thumb: meta.thumb ?? (await smallThumb(file)), video: file.type.startsWith("video/"), credit: meta.credit };
  const list = [entry, ...recentBackgrounds().filter((r) => r.id !== id)];
  for (const old of list.slice(MAX_RECENTS)) await tx("readwrite", (s) => s.delete(`recent:${old.id}`)).catch(() => undefined);
  writeRecents(list.slice(0, MAX_RECENTS));
  try {
    localStorage.setItem("ruby.bgCurrent", id);
  } catch {
    /* highlight only */
  }
}

export const currentRecentId = () => {
  try {
    return localStorage.getItem("ruby.bgCurrent");
  } catch {
    return null;
  }
};

/** Switch back to a recent background. */
export async function applyRecentBackground(id: string): Promise<boolean> {
  const blob = (await tx("readonly", (s) => s.get(`recent:${id}`)).catch(() => null)) as Blob | null;
  if (!blob) {
    removeRecentBackground(id);
    return false;
  }
  await tx("readwrite", (s) => s.put(blob, "bg"));
  customVersion++;
  const r = recentBackgrounds().find((x) => x.id === id);
  try {
    localStorage.setItem("ruby.bgCurrent", id);
    if (r?.credit) localStorage.setItem("ruby.bgCredit", JSON.stringify(r.credit));
    else localStorage.removeItem("ruby.bgCredit");
  } catch {
    /* credit display only */
  }
  setPref("bg", "custom");
  return true;
}

export function removeRecentBackground(id: string) {
  void tx("readwrite", (s) => s.delete(`recent:${id}`)).catch(() => undefined);
  writeRecents(recentBackgrounds().filter((r) => r.id !== id));
}
