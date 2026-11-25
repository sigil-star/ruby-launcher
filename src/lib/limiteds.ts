import { rbx } from "./ipc";

/**
 * Limited ("collectible") facts from Roblox's own APIs:
 * - kind: "Limited U" (fixed number of serialized copies), "Limited" (classic: copies were sold
 *   until it went limited, no serials), or "UGC Limited" (made by a creator, serialized, fixed quantity).
 * - copies: how many exist (known for Limited U and UGC Limiteds), remaining from the original sale.
 * - history: Roblox's daily average sale price and volume. Roblox stopped updating this public
 *   history in early 2025, so `historyEnds` is shown alongside it.
 */
export type LimitedKind = "Limited U" | "Limited" | "UGC Limited";

export type LimitedInfo = {
  kind: LimitedKind;
  rap: number | null;
  originalPrice: number | null;
  copies: number | null;
  remaining: number | null;
  sales: number | null;
  lowestResale: number | null;
  points: { date: number; price: number; volume: number }[];
  historyEnds: number | null;
};

type Details = {
  IsLimited?: boolean;
  IsLimitedUnique?: boolean;
  Remaining?: number | null;
  PriceInRobux?: number | null;
  CollectiblesItemDetails?: { IsLimited?: boolean; TotalQuantity?: number | null; CollectibleLowestResalePrice?: number | null } | null;
};
type Resale = {
  assetStock?: number | null;
  sales?: number | null;
  numberRemaining?: number | null;
  recentAveragePrice?: number | null;
  originalPrice?: number | null;
  priceDataPoints?: { value: number; date: string }[];
  volumeDataPoints?: { value: number; date: string }[];
};

export const limitedKind = (d: Details): LimitedKind | null =>
  d.IsLimitedUnique ? "Limited U" : d.IsLimited ? "Limited" : d.CollectiblesItemDetails?.IsLimited ? "UGC Limited" : null;

/** Limited badge text from catalog search's `itemRestrictions`. */
export function restrictionsKind(r?: string[]): LimitedKind | null {
  const s = r ?? [];
  if (s.includes("LimitedUnique")) return "Limited U";
  if (s.includes("Limited")) return "Limited";
  if (s.includes("Collectible")) return "UGC Limited";
  return null;
}

/**
 * Roblox's history has glitch days (an average of 1 Robux, or a single wild sale). Drop points
 * more than 4x away from the median of the two weeks around them, so the chart shows the market.
 */
function withoutGlitches<T extends { price: number }>(pts: T[]): T[] {
  return pts.filter((p, i) => {
    const near = pts.slice(Math.max(0, i - 7), i + 8).map((q) => q.price).sort((a, b) => a - b);
    const median = near[Math.floor(near.length / 2)];
    return p.price >= median / 4 && p.price <= median * 4;
  });
}

export async function limitedInfo(assetId: number): Promise<LimitedInfo | null> {
  const [d, r] = await Promise.all([
    rbx<Details>(`https://economy.roblox.com/v2/assets/${assetId}/details`),
    rbx<Resale>(`https://economy.roblox.com/v1/assets/${assetId}/resale-data`).catch(() => null),
  ]);
  const kind = limitedKind(d);
  if (!kind) return null;

  const volume = new Map((r?.volumeDataPoints ?? []).map((v) => [v.date, v.value]));
  const raw = (r?.priceDataPoints ?? [])
    .map((p) => ({ date: Date.parse(p.date), price: p.value, volume: volume.get(p.date) ?? 0 }))
    .filter((p) => Number.isFinite(p.date) && p.price > 0)
    .sort((a, b) => a.date - b.date);
  const points = withoutGlitches(raw);

  return {
    kind,
    rap: r?.recentAveragePrice ?? null,
    originalPrice: r?.originalPrice ?? d.PriceInRobux ?? null,
    copies: r?.assetStock ?? d.CollectiblesItemDetails?.TotalQuantity ?? null,
    remaining: r?.numberRemaining ?? d.Remaining ?? null,
    sales: r?.sales ?? null,
    lowestResale: d.CollectiblesItemDetails?.CollectibleLowestResalePrice ?? null,
    points,
    historyEnds: points.length ? points[points.length - 1].date : null,
  };
}
