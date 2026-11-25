/**
 * Lightweight i18n. Keys are the English source strings themselves (gettext style), so English needs
 * no file and is always the fallback. Placeholders use {name}: t("Joined {game}", { game }).
 * Locale files live in src/locales/<code>.json and are loaded lazily; only the chosen one is fetched.
 * Roblox-provided content (item/game/user names) is never passed through t().
 */
import { createContext, createElement, Fragment, useContext, useEffect, useState, type ReactNode } from "react";

export type LangCode =
  | "en" | "es" | "pt-BR" | "fr" | "de" | "it" | "ja" | "ko" | "zh-CN" | "zh-TW"
  | "ru" | "id" | "th" | "tr" | "vi" | "pl" | "ar" | "nl" | "uk" | "sv" | "fil";

/** Shown in the Language dropdown in each language's own name. */
export const LANGUAGES: { code: LangCode; name: string }[] = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "pt-BR", name: "Português (Brasil)" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "nl", name: "Nederlands" },
  { code: "pl", name: "Polski" },
  { code: "sv", name: "Svenska" },
  { code: "tr", name: "Türkçe" },
  { code: "ru", name: "Русский" },
  { code: "uk", name: "Українська" },
  { code: "ar", name: "العربية" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "fil", name: "Filipino" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "th", name: "ไทย" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "zh-CN", name: "简体中文" },
  { code: "zh-TW", name: "繁體中文" },
];

const RTL = new Set<LangCode>(["ar"]);
const KEY = "ruby.language";
type Dict = Record<string, string>;
const loaders = import.meta.glob<Dict>("../locales/*.json", { import: "default" });

let current: LangCode = "en";
let dict: Dict = {};
const listeners = new Set<(l: LangCode) => void>();

function systemLang(): LangCode {
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const raw of prefs) {
    const p = (raw || "").toLowerCase();
    if (p.startsWith("zh")) return /tw|hk|mo|hant/.test(p) ? "zh-TW" : "zh-CN";
    if (p.startsWith("pt")) return "pt-BR";
    if (p.startsWith("tl") || p.startsWith("fil")) return "fil";
    const hit = LANGUAGES.find((l) => l.code.toLowerCase() === p || l.code.toLowerCase() === p.split("-")[0]);
    if (hit) return hit.code;
  }
  return "en";
}

function storedLang(): LangCode | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && LANGUAGES.some((l) => l.code === v) ? (v as LangCode) : null;
  } catch {
    return null;
  }
}

export const getLang = () => current;
/** BCP-47 tag for Intl formatting. */
export const locale = () => current;
export const isRtl = () => RTL.has(current);

function applyDocument() {
  const root = document.documentElement;
  root.lang = current;
  root.dir = RTL.has(current) ? "rtl" : "ltr";
}

async function load(code: LangCode): Promise<Dict> {
  if (code === "en") return {};
  const fn = loaders[`../locales/${code}.json`];
  if (!fn) return {};
  try {
    return await fn();
  } catch {
    return {};
  }
}

/** Load the saved (or system) language before the first render. */
export async function initI18n(): Promise<void> {
  current = storedLang() ?? systemLang();
  dict = await load(current);
  applyDocument();
}

export async function setLang(code: LangCode): Promise<void> {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* ignore */
  }
  // Other windows (overlay, toasts) share localStorage and pick it up via the storage event.
  const next = await load(code);
  current = code;
  dict = next;
  applyDocument();
  listeners.forEach((f) => f(code));
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY && e.newValue && e.newValue !== current) void setLang(e.newValue as LangCode);
  });
}

export type Vars = Record<string, string | number | null | undefined>;

/** Translate an English source string. Numbers in vars are formatted for the current locale. */
export function t(text: string, vars?: Vars): string {
  let s = dict[text] || text;
  if (vars)
    s = s.replace(/\{(\w+)\}/g, (m, k: string) => {
      const v = vars[k];
      if (v == null) return m;
      return typeof v === "number" ? fmtNum(v) : String(v);
    });
  return s;
}

export function fmtNum(n: number, opts?: Intl.NumberFormatOptions): string {
  try {
    return new Intl.NumberFormat(current, opts).format(n);
  } catch {
    return String(n);
  }
}

export function fmtDate(d: Date | number | string, opts?: Intl.DateTimeFormatOptions): string {
  const date = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(current, opts).format(date);
  } catch {
    return date.toLocaleString();
  }
}

export function subscribe(f: (l: LangCode) => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}

const LangContext = createContext<LangCode>("en");

/** Re-renders (remounts) the tree under it when the language changes, so every t() call refreshes. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setL] = useState<LangCode>(current);
  useEffect(() => subscribe(setL), []);
  return createElement(LangContext.Provider, { value: lang }, createElement(Fragment, { key: lang }, children));
}

export const useLang = () => useContext(LangContext);
