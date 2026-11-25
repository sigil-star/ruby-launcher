import { LimitedBadge } from "./LimitedStats";
import { limitedKind } from "../lib/limiteds";
import { rememberItem } from "../lib/recent";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { itemDetail, myAvatar, purchaseInfo, redrawAvatar, removeAsset, wearAsset } from "../lib/api";
import { thousands } from "../lib/format";
import { invalidateAvatar } from "../lib/thumbs";
import { useMe, useNav, useUi } from "../app/store";
import { Icon, Robux, Skel, Thumb, Verified } from "./ui";
import { rbx, win } from "../lib/ipc";
import { Avatar3D, AvatarRig } from "./Avatar3DLazy";
import { BuyItemModal } from "./Purchase";
import { t, fmtDate } from "../lib/i18n";

// Roblox AssetType ids → the names the app shows.
const ASSET_TYPES: Record<number, () => string> = {
  2: () => t("T-Shirt"), 8: () => t("Hat"), 11: () => t("Shirt"), 12: () => t("Pants"), 17: () => t("Head"), 18: () => t("Face"), 24: () => t("Animation"),
  27: () => t("Torso"), 28: () => t("Right Arm"), 29: () => t("Left Arm"), 30: () => t("Left Leg"), 31: () => t("Right Leg"),
  41: () => t("Hair"), 42: () => t("Face Accessory"), 43: () => t("Neck Accessory"), 44: () => t("Shoulder Accessory"), 45: () => t("Front Accessory"),
  46: () => t("Back Accessory"), 47: () => t("Waist Accessory"), 48: () => t("Climb Animation"), 50: () => t("Fall Animation"), 51: () => t("Idle Animation"),
  52: () => t("Jump Animation"), 53: () => t("Run Animation"), 54: () => t("Swim Animation"), 55: () => t("Walk Animation"), 61: () => t("Emote"),
  64: () => t("T-Shirt"), 65: () => t("Shirt"), 66: () => t("Pants"), 67: () => t("Jacket"), 68: () => t("Sweater"), 69: () => t("Shorts"), 70: () => t("Left Shoe"),
  71: () => t("Right Shoe"), 72: () => t("Dress / Skirt"), 76: () => t("Eyebrows"), 77: () => t("Eyelashes"), 78: () => t("Mood"), 79: () => t("Dynamic Head"),
  88: () => t("Face Makeup"), 89: () => t("Lip Makeup"), 90: () => t("Eye Makeup"), 92: () => t("Background"),
};
export const assetTypeName = (ty?: number) => (ty && ASSET_TYPES[ty]?.()) || t("Accessory");

type ItemRef = { itemType: "Asset" | "Bundle"; id: number };

/** Created / updated / tradability (economy details; assets only). */
type AssetFacts = { Sales?: number; Created?: string; Updated?: string; IsLimited?: boolean; IsLimitedUnique?: boolean; CollectibleItemId?: string | null; CollectiblesItemDetails?: { IsLimited?: boolean } | null };

const assetFacts = (id: number) => rbx<AssetFacts>(`https://economy.roblox.com/v2/assets/${id}/details`);

const favPath = (userId: number, r: ItemRef) => `https://catalog.roblox.com/v1/favorites/users/${userId}/${r.itemType === "Bundle" ? "bundles" : "assets"}/${r.id}/favorite`;
async function isItemFavorited(userId: number, r: ItemRef) {
  const v = await rbx<unknown>(favPath(userId, r)).catch(() => null);
  return !!v;
}

const fmtWhen = (iso?: string) =>
  iso ? fmtDate(iso, { month: "short", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

/** Favorite star + count, and Report — the small row under the item image. */
export function ItemSocialRow({ itemType, id }: ItemRef) {
  const me = useMe();
  const { toast } = useUi();
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ["itemDetail", itemType, id], queryFn: () => itemDetail(itemType, id) });
  const fav = useQuery({ queryKey: ["itemFav", itemType, id, me.id], queryFn: () => isItemFavorited(me.id!, { itemType, id }), enabled: !!me.id });
  const [delta, setDelta] = useState(0);
  const on = !!fav.data;
  const toggle = async () => {
    if (!me.id) return;
    const next = !on;
    qc.setQueryData(["itemFav", itemType, id, me.id], next);
    setDelta((d) => d + (next ? 1 : -1));
    try {
      await rbx(favPath(me.id, { itemType, id }), { method: next ? "POST" : "DELETE" });
    } catch (e) {
      qc.setQueryData(["itemFav", itemType, id, me.id], !next);
      setDelta((d) => d - (next ? 1 : -1));
      toast(friendlyChallenge(e, t("Couldn't update favorites.")), "error");
      if (/challenge/i.test(String((e as Error)?.message ?? e)))
        win.showRobloxPage(`https://www.roblox.com/catalog/${id}`, detail.data?.name ?? t("Item"));
    }
  };
  return (
    <div className="ip-social">
      <button className={`ip-fav ${on ? "on" : ""}`} onClick={toggle} title={on ? t("Remove from favorites") : t("Add to favorites")} aria-pressed={on}>
        <Icon name="star" size={18} /> <span>{thousands(Math.max(0, (detail.data?.favoriteCount ?? 0) + delta))}</span>
      </button>
      <button
        className="ip-report"
        onClick={() => win.showRobloxPage(`https://www.roblox.com/abusereport/asset?id=${id}`, t("Report"))}
        title={t("Report this item")}
      >
        <Icon name="triangle-exclamation" size={16} /> {t("Report")}
      </button>
    </div>
  );
}

/** Roblox asks for a captcha-style "challenge" on some writes from outside its site. */
export function friendlyChallenge(e: unknown, fallback: string) {
  const m = e instanceof Error ? e.message : String(e ?? "");
  if (/challenge/i.test(m)) return t("Roblox wants a quick verification for this. Try again from the roblox.com page (opened for you).");
  return m || fallback;
}

/**
 * Name, creator, price, Buy/Get or Owned + Wear, and facts — shared by the full item page and
 * the quick-view popup so both behave the same.
 */
export function ItemDetails({ itemType, id, onNavigate, showDescription = true, cta }: ItemRef & { onNavigate?: () => void; showDescription?: boolean; cta?: ReactNode }) {
  const me = useMe();
  const { go } = useNav();
  const { toast } = useUi();
  const qc = useQueryClient();
  const [buying, setBuying] = useState(false);
  const detail = useQuery({ queryKey: ["itemDetail", itemType, id], queryFn: () => itemDetail(itemType, id) });
  const buy = useQuery({ queryKey: ["purchaseInfo", itemType, id], queryFn: () => purchaseInfo(itemType, id, me.id) });
  const avatar = useQuery({ queryKey: ["myAvatar"], queryFn: myAvatar, enabled: itemType === "Asset" });
  // Body parts (and some accessories) only sell as part of a bundle.
  const bundles = useQuery({
    queryKey: ["assetBundles", id],
    queryFn: () => rbx<{ data: { id: number; name: string }[] }>(`https://catalog.roblox.com/v1/assets/${id}/bundles?limit=10`).then((r) => r.data ?? []),
    enabled: itemType === "Asset",
    staleTime: 30 * 60_000,
    retry: false,
  });
  const preview = useItemPreview();
  const bundle = bundles.data?.[0];
  const facts = useQuery({ queryKey: ["assetFacts", id], queryFn: () => assetFacts(id), enabled: itemType === "Asset", staleTime: 10 * 60_000, retry: false });
  const [more, setMore] = useState(false);
  const loaded = detail.data;
  useEffect(() => {
    if (loaded?.name && me.id) rememberItem(me.id, { id, itemType, name: loaded.name, price: loaded.lowestPrice ?? loaded.price ?? null });
  }, [loaded?.name, id, itemType, me.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (detail.isLoading)
    return (
      <div className="item-details-body">
        <Skel w="80%" h={28} />
        <Skel w="40%" />
        <Skel w="30%" h={24} />
        <Skel h={44} r={10} />
        <Skel w="60%" />
      </div>
    );
  const d = detail.data;
  if (!d) return <p className="muted">{t("Couldn't load this item.")}</p>;
  const p = buy.data;
  const worn = !!avatar.data?.assets.some((a) => a.id === id);
  const price = p?.price ?? d.lowestPrice ?? d.price;
  const free = d.priceStatus === "Free" || price === 0;
  const offSale = d.priceStatus === "Off Sale" || (price == null && !free);

  const toggleWear = async () => {
    try {
      await (worn ? removeAsset(id) : wearAsset(id));
      await redrawAvatar();
      await qc.invalidateQueries({ queryKey: ["myAvatar"] });
      setTimeout(() => invalidateAvatar(me.id), 1500);
      toast(worn ? t("Removed from your avatar.") : t("Now wearing it."));
    } catch (e) {
      toast(t("Couldn't update avatar: {error}", { error: (e as Error).message }), "error");
    }
  };
  const openCreator = () => {
    if (!d.creatorTargetId) return;
    onNavigate?.();
    if (d.creatorType === "Group") go({ name: "community", groupId: d.creatorTargetId });
    else go({ name: "profile", userId: d.creatorTargetId });
  };

  return (
    <div className="item-details-body">
      <h1 className="item-title">{d.name}</h1>
      {facts.data ? <LimitedBadge kind={limitedKind(facts.data)} /> : null}
      <div className="ip-byline">
        <button className="creator link" onClick={openCreator}>
          {t("By")} <b>{d.creatorName}</b> {d.creatorHasVerifiedBadge ? <Verified size={13} /> : null}
        </button>
        {p?.owned ? (
          <span className="ip-owned">
            <Icon name="check" size={14} /> {t("Item Owned")}
          </span>
        ) : null}
      </div>
      <div className="item-price-big">
        {free ? <span>{t("Free")}</span> : offSale ? <span className="muted">{t("Off Sale")}</span> : <Robux amount={price ?? 0} size={22} />}
      </div>
      <div className="item-cta">
        {cta ? cta : p?.owned ? (
          <>
            <button className="btn btn-secondary btn-block" disabled>
              <Icon name="check" size={18} /> {t("Owned")}
            </button>
            {itemType === "Asset" ? (
              <button className="btn btn-primary btn-block" onClick={toggleWear}>
                {worn ? t("Remove") : t("Wear")}
              </button>
            ) : null}
          </>
        ) : (
          offSale && bundle ? (
            <button className="btn btn-primary btn-block" onClick={() => preview({ itemType: "Bundle", id: bundle.id })}>
              {t("Buy the bundle")}
            </button>
          ) : (
            <button className="btn btn-primary btn-block" disabled={offSale || buy.isLoading} onClick={() => setBuying(true)}>
              {free ? t("Get") : offSale ? t("Off Sale") : t("Buy")}
            </button>
          )
        )}
      </div>
      {p?.owned ? <div className="muted small">{t("This item is in your inventory.")}</div> : null}
      {bundle ? (
        <button className="ip-bundle" onClick={() => preview({ itemType: "Bundle", id: bundle.id })}>
          <Thumb type="BundleThumbnail" id={bundle.id} size="150x150" className="ip-bundle-thumb" />
          <span className="ip-bundle-text">
            <span className="muted tiny">{offSale ? t("Only sold as part of") : t("Part of")}</span>
            <b className="ellipsis">{bundle.name}</b>
          </span>
          <span className="link small">{t("View bundle")}</span>
        </button>
      ) : null}
      <dl className="ip-facts">
        <dt>{t("Tradable")}</dt>
        <dd>{facts.data ? (limitedKind(facts.data) ? t("Yes") : t("No")) : itemType === "Bundle" ? t("No") : "—"}</dd>
        <dt>{t("Type")}</dt>
        <dd>{itemType === "Bundle" ? t("Bundle") : assetTypeName((d as { assetType?: number }).assetType)}</dd>
        {itemType === "Asset" ? (
          <>
            <dt>{t("Created")}</dt>
            <dd>{fmtWhen(facts.data?.Created)}</dd>
            <dt>{t("Updated")}</dt>
            <dd>{fmtWhen(facts.data?.Updated)}</dd>
          </>
        ) : null}
        <dt>{t("Favorites")}</dt>
        <dd>{thousands(d.favoriteCount)}</dd>
        {facts.data?.Sales ? (
          <>
            <dt>{t("Sales")}</dt>
            <dd>{thousands(facts.data.Sales)}</dd>
          </>
        ) : null}
        {showDescription && d.description ? (
          <>
            <dt>{t("Description")}</dt>
            <dd className={`ip-desc ${more ? "open" : ""}`}>
              <span>{d.description}</span>
              {d.description.length > 160 ? (
                <button className="link small" onClick={() => setMore((m) => !m)}>
                  {more ? t("Show less") : t("Read more")}
                </button>
              ) : null}
            </dd>
          </>
        ) : null}
      </dl>
      {buying ? <BuyItemModal itemType={itemType} id={id} onClose={() => setBuying(false)} /> : null}
    </div>
  );
}

const ASSET_3D = (id: number) =>
  rbx<{ state: string; imageUrl?: string | null }>(`https://thumbnails.roblox.com/v1/assets-thumbnail-3d?assetId=${id}`).then((r) => (r.state === "Completed" ? (r.imageUrl ?? null) : null));

/** 2D image, a turnable 3D model of the item, or the item tried on your avatar. */
export function ItemMedia({ item }: { item: ItemRef }) {
  const me = useMe();
  const [mode, setMode] = useState<"2d" | "3d" | "try">("2d");
  const detail = useQuery({ queryKey: ["itemDetail", item.itemType, item.id], queryFn: () => itemDetail(item.itemType, item.id) });
  const assetType = (detail.data as { assetType?: number } | undefined)?.assetType;
  const meta = useQuery({ queryKey: ["asset3d", item.id], queryFn: () => ASSET_3D(item.id), enabled: mode === "3d" && item.itemType === "Asset", staleTime: 30 * 60_000 });
  const can3d = item.itemType === "Asset";
  return (
    <div className="ip-stage">
      {mode === "2d" ? (
        <Thumb type={item.itemType === "Bundle" ? "BundleThumbnail" : "Asset"} id={item.id} size="420x420" className="item-preview-image" />
      ) : mode === "3d" ? (
        meta.isLoading ? (
          <div className="item-preview-image ip-wait"><div className="model-loader" aria-busy="true"><span /></div></div>
        ) : meta.data ? (
          <Avatar3D userId={me.id ?? 0} metaUrl={meta.data} className="item-preview-image ip-3d" />
        ) : (
          <div className="item-preview-image ip-wait muted small">{t("Roblox has no 3D model for this item.")}</div>
        )
      ) : me.id ? (
        <AvatarRig userId={me.id} self tryOn={{ id: item.id, itemType: item.itemType, assetType }} className="item-preview-image ip-3d" />
      ) : null}
      <div className="ip-modes">
        {mode !== "try" ? (
          <button className="ip-mode" onClick={() => setMode("try")} title={t("Try it on your avatar")}>
            <Icon name="person-standing" size={16} /> {t("Try On")}
          </button>
        ) : null}
        {can3d && mode !== "3d" ? (
          <button className="ip-mode" onClick={() => setMode("3d")} title={t("Turn the item in 3D")}>
            3D
          </button>
        ) : null}
        {mode !== "2d" ? (
          <button className="ip-mode" onClick={() => setMode("2d")}>
            2D
          </button>
        ) : null}
      </div>
    </div>
  );
}

const PreviewCtx = createContext<(item: ItemRef) => void>(() => undefined);
export const useItemPreview = () => useContext(PreviewCtx);

function ItemPreviewModal({ item, onClose }: { item: ItemRef; onClose: () => void }) {
  const { go } = useNav();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-scrim item-preview-scrim" onClick={onClose}>
      <div className="item-preview" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn item-preview-close" onClick={onClose} aria-label={t("Close")}>
          <Icon name="x-small" size={22} />
        </button>
        <div className="ip-media">
          <ItemMedia item={item} />
          <ItemSocialRow {...item} />
        </div>
        <div className="item-preview-side">
          <ItemDetails {...item} onNavigate={onClose} />
          <button
            className="btn btn-secondary btn-block item-preview-full"
            onClick={() => {
              onClose();
              go({ name: "item", itemType: item.itemType, id: item.id });
            }}
          >
            {t("View full page")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Lets any list open an item as a popup (instead of leaving the page), like the app's item sheet. */
export function ItemPreviewProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<ItemRef | null>(null);
  const { route } = useNav();
  const open = useCallback((i: ItemRef) => setItem(i), []);
  // Navigating anywhere closes the popup.
  useEffect(() => setItem(null), [route]);
  return (
    <PreviewCtx.Provider value={open}>
      {children}
      {item ? <ItemPreviewModal item={item} onClose={() => setItem(null)} /> : null}
    </PreviewCtx.Provider>
  );
}
