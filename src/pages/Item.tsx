import { useQuery } from "@tanstack/react-query";
import { itemDetail } from "../lib/api";
import { rbx } from "../lib/ipc";
import { ItemDetails, ItemMedia, ItemSocialRow } from "../components/ItemPreview";
import { SkeletonGrid } from "../components/ui";
import { ItemRow } from "./People";
import { isLimited, ResaleSection } from "../components/Resale";
import { LimitedStats } from "../components/LimitedStats";
import { FriendsWhoOwn, RecentlyViewed } from "../components/ItemExtras";


type Card = { id: number; name: string; price: number | null; itemType: "Asset" | "Bundle" };

async function details(ids: number[]): Promise<Card[]> {
  if (!ids.length) return [];
  const r = await rbx<{ data: { id: number; name: string; itemType: "Asset" | "Bundle"; price?: number; lowestPrice?: number }[] }>(
    "https://catalog.roblox.com/v1/catalog/items/details",
    { method: "POST", body: { items: ids.map((id) => ({ itemType: "Asset", id })) } },
  );
  return (r.data ?? []).map((x) => ({ id: x.id, name: x.name, itemType: x.itemType, price: x.lowestPrice ?? x.price ?? null }));
}

/** "Recommended" (catalog's own recommendations for this item type). */
async function recommended(assetType: number, id: number): Promise<Card[]> {
  const r = await rbx<{ data: number[] }>(`https://catalog.roblox.com/v2/recommendations/assets?assetTypeId=${assetType}&contextAssetId=${id}&numItems=15`);
  return details((r.data ?? []).filter((x) => x !== id));
}

/** "More from this creator": newest items they sell. */
async function moreFrom(creatorType: string, creatorId: number, skip: number): Promise<Card[]> {
  const q = new URLSearchParams({ limit: "30", salesTypeFilter: "1", creatorTargetId: String(creatorId), creatorType, sortType: "3" });
  const r = await rbx<{ data: { id: number; name: string; itemType: "Asset" | "Bundle"; price?: number; lowestPrice?: number }[] }>(
    `https://catalog.roblox.com/v2/search/items/details?${q}`,
  );
  return (r.data ?? []).filter((x) => x.id !== skip).map((x) => ({ id: x.id, name: x.name, itemType: x.itemType, price: x.lowestPrice ?? x.price ?? null }));
}

export function ItemPage({ itemType, id }: { itemType: "Asset" | "Bundle"; id: number }) {
  const detail = useQuery({ queryKey: ["itemDetail", itemType, id], queryFn: () => itemDetail(itemType, id) });
  const d = detail.data as (typeof detail.data & { assetType?: number }) | undefined;
  const recs = useQuery({
    queryKey: ["itemRecs", id],
    queryFn: () => recommended(d!.assetType!, id),
    enabled: itemType === "Asset" && !!d?.assetType,
    staleTime: 10 * 60_000,
  });
  const more = useQuery({
    queryKey: ["itemMore", d?.creatorType, d?.creatorTargetId],
    queryFn: () => moreFrom(d!.creatorType ?? "User", d!.creatorTargetId!, id),
    enabled: !!d?.creatorTargetId,
    staleTime: 10 * 60_000,
  });

  return (
    <div className="page item-page">
      <div className="item-layout">
        <div className="ip-media item-hero-media">
          <ItemMedia item={{ itemType, id }} />
          <ItemSocialRow itemType={itemType} id={id} />
        </div>
        <ItemDetails itemType={itemType} id={id} />
      </div>
      {d && isLimited(d as never) && itemType === "Asset" ? <LimitedStats assetId={id} /> : null}
      {d && isLimited(d as never) ? <ResaleSection item={{ ...(d as never as object), id, itemType } as never} /> : null}
      {d ? <FriendsWhoOwn itemType={itemType} id={id} /> : null}
      {more.isLoading ? (
        <SkeletonGrid count={6} />
      ) : more.data?.length ? (
        <section className="shelf">
          <h2 className="sub-title">More from {d?.creatorName ?? "this creator"}</h2>
          <ItemRow items={more.data} />
        </section>
      ) : null}
      <RecentlyViewed exclude={id} />
      {recs.data?.length ? (
        <section className="shelf">
          <h2 className="sub-title">Recommended</h2>
          <ItemRow items={recs.data} />
        </section>
      ) : null}
    </div>
  );
}
