import { call, rbx } from "./ipc";
import { t } from "./i18n";

export type Resale = {
  key: string;
  sellerId: number;
  sellerName: string;
  price: number;
  serial: number | null;
  /** Limited 2.0 */
  collectibleItemInstanceId?: string;
  collectibleProductId?: string;
  /** Legacy Limited */
  userAssetId?: number;
};

export async function resellers(opts: { assetId: number; collectibleItemId?: string | null }): Promise<Resale[]> {
  if (opts.collectibleItemId) {
    const r = await rbx<{
      data: { collectibleProductId: string; collectibleItemInstanceId: string; seller: { sellerId: number; name?: string; sellerType?: string }; price: number; serialNumber?: number | null }[];
    }>(`https://apis.roblox.com/marketplace-sales/v1/item/${opts.collectibleItemId}/resellers?limit=30`);
    return (r.data ?? []).map((d) => ({
      key: d.collectibleItemInstanceId,
      sellerId: d.seller.sellerId,
      sellerName: d.seller.name ?? "",
      price: d.price,
      serial: d.serialNumber ?? null,
      collectibleItemInstanceId: d.collectibleItemInstanceId,
      collectibleProductId: d.collectibleProductId,
    }));
  }
  const r = await rbx<{ data: { userAssetId: number; seller: { id: number; name: string }; price: number; serialNumber?: number | null }[] }>(
    `https://economy.roblox.com/v1/assets/${opts.assetId}/resellers?limit=30`,
  );
  return (r.data ?? []).map((d) => ({ key: String(d.userAssetId), sellerId: d.seller.id, sellerName: d.seller.name, price: d.price, serial: d.serialNumber ?? null, userAssetId: d.userAssetId }));
}

/** Buy one resale copy. Throws with Roblox's reason if it fails (sold already, price changed…). */
export async function buyResale(r: Resale, item: { collectibleItemId?: string | null; productId?: number | null }, meId: number): Promise<void> {
  if (item.collectibleItemId && r.collectibleItemInstanceId) {
    const res = await rbx<{ purchased?: boolean; errorMessage?: string; purchaseResult?: string }>(
      `https://apis.roblox.com/marketplace-sales/v1/item/${item.collectibleItemId}/purchase-resale`,
      {
        method: "POST",
        body: {
          collectibleItemId: item.collectibleItemId,
          collectibleItemInstanceId: r.collectibleItemInstanceId,
          collectibleProductId: r.collectibleProductId,
          expectedCurrency: 1,
          expectedPrice: r.price,
          expectedPurchaserId: meId,
          expectedPurchaserType: "User",
          expectedSellerId: r.sellerId,
          expectedSellerType: "User",
          idempotencyKey: crypto.randomUUID(),
        },
      },
    );
    if (res.purchased === false) throw new Error(res.errorMessage || res.purchaseResult || t("Purchase failed."));
    return;
  }
  if (!item.productId || !r.userAssetId) throw new Error(t("This copy can't be bought here."));
  const res = await rbx<{ purchased?: boolean; reason?: string; errorMsg?: string }>(`https://economy.roblox.com/v1/purchases/products/${item.productId}`, {
    method: "POST",
    body: { expectedCurrency: 1, expectedPrice: r.price, expectedSellerId: r.sellerId, userAssetId: r.userAssetId },
  });
  if (res.purchased === false) throw new Error(res.errorMsg || res.reason || t("Purchase failed."));
}

/** Saves what you're wearing now as a new outfit (avatar editor → Create outfit). */
export async function saveCurrentOutfit(name: string): Promise<void> {
  const a = await rbx<{
    assets: { id: number; meta?: unknown }[];
    bodyColor3s: unknown;
    scales: unknown;
    playerAvatarType: string;
  }>("https://avatar.roblox.com/v2/avatar/avatar");
  await rbx("https://avatar.roblox.com/v2/outfits/create", {
    method: "POST",
    body: {
      name,
      bodyColor3s: a.bodyColor3s,
      assets: a.assets.map((x) => (x.meta ? { id: x.id, meta: x.meta } : { id: x.id })),
      scale: a.scales,
      playerAvatarType: a.playerAvatarType,
      outfitType: "Avatar",
    },
  });
}

export async function peopleYouMayKnow(): Promise<number[]> {
  const r = await rbx<{ contentMetadata?: { RecommendedFriend?: Record<string, unknown> }; sorts?: { recommendationList?: { contentType: string; contentId: number }[] }[] }>(
    "https://apis.roblox.com/discovery-api/omni-recommendation",
    { method: "POST", body: { pageType: "Home", sessionId: crypto.randomUUID(), supportedTreatmentTypes: ["FriendCarousel", "SortlessGrid", "Carousel"] } },
  );
  const ids = new Set<number>();
  for (const k of Object.keys(r.contentMetadata?.RecommendedFriend ?? {})) if (Number(k)) ids.add(Number(k));
  for (const s of r.sorts ?? []) for (const x of s.recommendationList ?? []) if (x.contentType === "RecommendedFriend") ids.add(x.contentId);
  return [...ids];
}

export type Capture = { path: string; name: string; modified: number; preview: string | null };
export const captures = () => call<{ captures: Capture[]; folder: string | null }>("listCaptures");
export const openCapture = (p: string) => call("openCapture", p);
export const revealCapture = (p: string) => call("revealCapture", p);
export const deleteCapture = (p: string) => call("deleteCapture", p);
