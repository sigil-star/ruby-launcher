import { t, fmtNum, fmtDate } from "./i18n";

export function compact(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "--";
  if (n < 1000) return fmtNum(n);
  return fmtNum(n, { notation: "compact", maximumFractionDigits: 1, roundingMode: "trunc" } as Intl.NumberFormatOptions);
}

export function rating(up?: number, down?: number): string {
  if (up == null || down == null || up + down === 0) return "--";
  return `${Math.round((up / (up + down)) * 100)}%`;
}

export function thousands(n: number | undefined | null): string {
  return n == null ? "--" : fmtNum(n);
}

export function ago(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return t("now");
  if (s < 3600) return t("{n}m", { n: Math.floor(s / 60) });
  if (s < 86400) return t("{n}h", { n: Math.floor(s / 3600) });
  if (s < 86400 * 7) return t("{n}d", { n: Math.floor(s / 86400) });
  return fmtDate(ts, { month: "short", day: "numeric" });
}

export function longDate(iso: string): string {
  const ts = Date.parse(iso);
  return Number.isFinite(ts) ? fmtDate(ts, { year: "numeric", month: "short", day: "numeric" }) : "";
}
