import { rbx } from "./ipc";
import { t } from "./i18n";

/** Roblox's trade boxes. "Inactive" holds declined, expired and countered trades. */
export type TradeBox = "Inbound" | "Outbound" | "Completed" | "Inactive";
/** `label` is a thunk so it translates at render time, not import time. */
export const TRADE_BOXES: { id: TradeBox; label: () => string }[] = [
  { id: "Inbound", label: () => t("Inbound") },
  { id: "Outbound", label: () => t("Outbound") },
  { id: "Completed", label: () => t("Completed") },
  { id: "Inactive", label: () => t("Inactive") },
];

export type TradeUser = { id: number; name: string; displayName: string };
export type TradeSummary = { id: number; user: TradeUser; created: string; expiration?: string; isActive: boolean; status: string };

export type TradeItem = {
  userAssetId: number;
  assetId: number;
  name: string;
  serialNumber: number | null;
  rap: number | null;
  originalPrice: number | null;
  stock: number | null;
  onHold?: boolean;
};
export type TradeOffer = { user: TradeUser; items: TradeItem[]; robux: number };
export type TradeDetail = { id: number; status: string; isActive: boolean; created: string; expiration?: string; offers: [TradeOffer, TradeOffer] };

const BASE = "https://trades.roblox.com/v1";

export async function tradeList(box: TradeBox, cursor?: string | null): Promise<{ data: TradeSummary[]; next: string | null }> {
  const r = await rbx<{ data: TradeSummary[]; nextPageCursor: string | null }>(`${BASE}/trades/${box}?limit=25&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
  return { data: r.data ?? [], next: r.nextPageCursor ?? null };
}

export async function tradeCount(box: "Inbound" = "Inbound"): Promise<number> {
  const r = await rbx<{ count: number }>(`${BASE}/trades/${box}/count`);
  return r.count ?? 0;
}

type RawAsset = {
  id?: number;
  userAssetId?: number;
  assetId: number;
  name: string;
  serialNumber?: number | null;
  recentAveragePrice?: number | null;
  originalPrice?: number | null;
  assetStock?: number | null;
  isOnHold?: boolean;
};
const toItem = (a: RawAsset): TradeItem => ({
  userAssetId: a.userAssetId ?? a.id ?? 0,
  assetId: a.assetId,
  name: a.name,
  serialNumber: a.serialNumber ?? null,
  rap: a.recentAveragePrice ?? null,
  originalPrice: a.originalPrice ?? null,
  stock: a.assetStock ?? null,
  onHold: a.isOnHold,
});

export async function tradeDetail(id: number): Promise<TradeDetail> {
  const r = await rbx<{
    id: number;
    status: string;
    isActive: boolean;
    created: string;
    expiration?: string;
    offers: { user: TradeUser; userAssets: RawAsset[]; robux: number }[];
  }>(`${BASE}/trades/${id}`);
  const offers = r.offers.map((o) => ({ user: o.user, items: (o.userAssets ?? []).map(toItem), robux: o.robux ?? 0 }));
  return { id: r.id, status: r.status, isActive: r.isActive, created: r.created, expiration: r.expiration, offers: [offers[0], offers[1]] };
}

/** Value of one side: item RAP plus Robux after Roblox's 30% trade fee. */
export const offerValue = (o: { items: TradeItem[]; robux: number }) => o.items.reduce((n, i) => n + (i.rap ?? 0), 0) + Math.floor(o.robux * 0.7);

/** A user's tradable Limiteds (Roblox only lets Limiteds be traded). */
export async function collectibles(userId: number): Promise<TradeItem[]> {
  const out: TradeItem[] = [];
  let cursor = "";
  for (let page = 0; page < 20; page++) {
    const r = await rbx<{ data: RawAsset[]; nextPageCursor: string | null }>(
      `https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?limit=100&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    out.push(...(r.data ?? []).map(toItem));
    if (!r.nextPageCursor || r.nextPageCursor === cursor) break;
    cursor = r.nextPageCursor;
  }
  return out;
}

export async function canTradeWith(userId: number): Promise<{ canTrade: boolean; status: string }> {
  return rbx(`${BASE}/users/${userId}/can-trade-with`);
}

/** Whether Roblox lets this account trade at all (needs Premium/Plus). */
export async function canTradeSelf(): Promise<boolean> {
  const r = await rbx<{ canTrade?: boolean }>(`${BASE}/users/me/can-trade`).catch(() => null);
  return r?.canTrade ?? true;
}

export type TradeOfferInput = { userId: number; userAssetIds: number[]; robux: number };

export const acceptTrade = (id: number) => rbx(`${BASE}/trades/${id}/accept`, { method: "POST", body: {} });
export const declineTrade = (id: number) => rbx(`${BASE}/trades/${id}/decline`, { method: "POST", body: {} });
export const sendTrade = (offers: [TradeOfferInput, TradeOfferInput]) => rbx<{ id: number }>(`${BASE}/trades/send`, { method: "POST", body: { offers } });
export const counterTrade = (id: number, offers: [TradeOfferInput, TradeOfferInput]) => rbx<{ id: number }>(`${BASE}/trades/${id}/counter`, { method: "POST", body: { offers } });

export const statusLabel = (s: string) =>
  ({ Open: t("Pending"), Pending: t("Pending"), Completed: t("Completed"), Declined: t("Declined"), Expired: t("Expired"), Countered: t("Countered"), RejectedDueToError: t("Failed"), InProgress: t("Processing"), Finished: t("Completed") } as Record<string, string>)[s] ?? s;
