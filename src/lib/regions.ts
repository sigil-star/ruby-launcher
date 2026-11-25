import { call } from "./ipc";
import { t } from "./i18n";

export type ServerLocation = { city?: string; country?: string };
type Answer = { ok: boolean; location?: ServerLocation | null; busy?: boolean; why?: string };

// Two lookups at a time with a short gap, so a long server list doesn't trip Roblox's rate limit.
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    await new Promise((r) => setTimeout(r, 350));
    active--;
    waiting.shift()?.();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Where a public server is (city and country), found before joining. Backs off when Roblox is busy. */
export async function serverRegion(placeId: number, jobId: string): Promise<ServerLocation | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await slot(() => call<Answer>("serverRegion", placeId, jobId));
    if (r.ok) return r.location ?? null;
    if (!r.busy) throw new Error(r.why || t("Roblox didn't say where this server is."));
    await sleep(4000 * (attempt + 1));
  }
  throw new Error(t("Roblox is busy. Try Refresh in a minute."));
}

export const regionLabel = (l?: ServerLocation | null) => (l ? [l.city, l.country].filter(Boolean).join(", ") : "");
