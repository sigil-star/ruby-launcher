import { askText } from "../components/Confirm";
import { createPortal } from "react-dom";
import { BODY_PARTS, BuildPanel, MAKEUP_FILTERS, MAKEUP_LAYER_TYPES, SLOTS, SkinPanel, SlotBar } from "../components/CustomizeSlots";
import { boughtFirst } from "../lib/bought";
import { ItemDetails, ItemMedia, ItemSocialRow } from "../components/ItemPreview";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { communities, DEFAULT_FILTERS, filtersActive, type MarketFilters,
  profileBackground,
} from "../lib/api";
import { saveCurrentOutfit } from "../lib/extras";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  currentlyWearing,
  equipEmote,
  renderTryOn,
  unequipEmote,
  type MyAvatar,
  followerCount,
  followingCount,
  friendCount,
  inventory,
  marketCategories,
  marketRecommended,
  marketSearch,
  myAvatar,
  outfits,
  purchaseInfo,
  redrawAvatar,

  setAvatarBackground,
  setAvatarType,
  setWearing,
  updateDescription,
  user,
  userGames,
  userStore,

  wearOutfit,
  type CatalogItem,
  type MarketCategory,
  type MarketSub,
  type WornAsset,
  needsR15,
  ANIMATION_TYPES,
} from "../lib/api";
import { compact } from "../lib/format";
import { rbx } from "../lib/ipc";
import { invalidateAvatar } from "../lib/thumbs";
import { useMe, useNav, useUi } from "../app/store";
import { Select, Empty, ErrorState, Headshot, Icon, Robux, SectionHeader, Skel, SkeletonGrid, Spinner, Thumb, Verified } from "../components/ui";
import { TileRow } from "../components/games";
import { AvatarRig, useBackdrop } from "../components/Avatar3DLazy";
import { BuyItemModal } from "../components/Purchase";
import { LimitedBadge } from "../components/LimitedStats";
import { RecentlyViewed } from "../components/ItemExtras";
import { restrictionsKind } from "../lib/limiteds";
import { friendlyError, ItemRow } from "./People";
import { t } from "../lib/i18n";

/* Roblox asset type ids (verified against the user's inventory + catalog). */
const BACKGROUND_TYPE = 92;
const CUSTOMIZE_TABS = {
  Body: [27, 28, 29, 30, 31, 41, 17, 79, 18],
  Clothing: [64, 65, 67, 68, 66, 69, 72, 70, 71, 11, 12, 2],
  Accessories: [8, 42, 43, 46, 47, 44, 45, 19],
  Backgrounds: [BACKGROUND_TYPE],
  Animations: [48, 50, 51, 52, 53, 54, 55],
  Emotes: [61, 78],
  Makeup: [88, 89, 90, 76, 77],
} as const;
type CustomizeTab = "Avatars" | keyof typeof CUSTOMIZE_TABS;
/** Tab labels, translated at render time. */
const CUSTOMIZE_LABELS: Record<CustomizeTab, () => string> = {
  Avatars: () => t("Avatars"),
  Body: () => t("Body"),
  Clothing: () => t("Clothing"),
  Accessories: () => t("Accessories"),
  Backgrounds: () => t("Backgrounds"),
  Animations: () => t("Animations"),
  Emotes: () => t("Emotes"),
  Makeup: () => t("Makeup"),
};
const CUSTOMIZE_ORDER: CustomizeTab[] = ["Avatars", "Body", "Clothing", "Accessories", "Backgrounds", "Animations", "Emotes", "Makeup"];

/** Types where only one can be worn at a time. */
const SINGLE_SLOT = new Set([2, 11, 12, 17, 18, 27, 28, 29, 30, 31, 48, 50, 51, 52, 53, 54, 55, 76, 77, 79]);


type Selected = { id: number; itemType: "Asset" | "Bundle"; assetType?: number } | null;
const EMOTE_TYPE = 61;
type Changed = () => void;

type ItemDetails = {
  id: number;
  itemType: string;
  name: string;
  description?: string;
  creatorName?: string;
  creatorHasVerifiedBadge?: boolean;
  price?: number;
  lowestPrice?: number;
  priceStatus?: string;
  favoriteCount?: number;
  assetType?: number;
};

function useItemDetails(sel: Selected) {
  return useQuery({
    queryKey: ["itemDetails", sel?.itemType, sel?.id],
    enabled: !!sel,
    queryFn: async () => {
      const res = await rbx<{ data: ItemDetails[] }>("https://catalog.roblox.com/v1/catalog/items/details", {
        method: "POST",
        body: { items: [{ itemType: sel!.itemType, id: sel!.id }] },
      });
      return res.data[0];
    },
  });
}

function priceLabel(d: { price?: number; lowestPrice?: number; priceStatus?: string }) {
  const p = d.lowestPrice ?? d.price;
  if (d.priceStatus === "Off Sale") return <span className="muted">{t("Off Sale")}</span>;
  if (p === 0 || d.priceStatus === "Free") return <span>{t("Free")}</span>;
  if (p == null) return <span className="muted">--</span>;
  return <Robux amount={p} size={14} />;
}

/**
 * Item details beside the preview. Owned items can be worn/removed; unowned items
 * can be bought right here — no trip to the website.
 */
function DetailsPanel({ sel, onClose, worn, onToggle }: { sel: Selected; onClose: () => void; worn?: boolean; onToggle?: () => void }) {
  const q = useItemDetails(sel);
  // One call to action: the try-on price bar hides while the sheet is up.
  useEffect(() => {
    document.body.classList.add("details-open");
    return () => document.body.classList.remove("details-open");
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  // The sheet lives over the 3D avatar pane only, so the list stays visible beside it.
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => setHost(document.querySelector(".preview")), []);
  if (!sel) return null;
  const item = { itemType: sel.itemType, id: sel.id };
  const sheet = (
    <>
      <div className="details-scrim" onClick={onClose} />
      <div className="details sheet" role="dialog" aria-label={t("Item details")}>
        <span className="sheet-grip" aria-hidden />
        <button className="icon-btn details-close" onClick={onClose} aria-label={t("Close")}>
          <Icon name="x-small" size={24} />
        </button>
        <div className="sheet-grid">
          <div className="ip-media">
            <ItemMedia item={item} key={sel.id} />
            <ItemSocialRow {...item} />
          </div>
          <div className="sheet-info">
            <ItemDetails
              {...item}
              key={sel.id}
              onNavigate={onClose}
              cta={
                onToggle ? (
                  <button className="btn btn-primary btn-block" onClick={onToggle}>
                    {q.data?.assetType === EMOTE_TYPE ? (worn ? "Unequip" : "Equip") : worn ? "Remove" : "Wear"}
                  </button>
                ) : undefined
              }
            />
          </div>
        </div>
      </div>
    </>
  );
  return host ? createPortal(sheet, host) : sheet;
}

/** Show `item` on the avatar without saving: Roblox renders it (avatar/render), we display it. */
function useTryOn(item: Selected, kind: "3d" | "2d", avatar: MyAvatar | undefined) {
  const renderable = !!item && !!avatar && item.assetType !== BACKGROUND_TYPE && item.assetType !== EMOTE_TYPE;
  const worn = !!item && !!avatar?.assets.some((a) => a.id === item.id);
  return useQuery({
    queryKey: ["tryOn", kind, item?.itemType, item?.id, avatar?.assets.map((a) => a.id).join(","), avatar?.playerAvatarType],
    queryFn: () => renderTryOn(avatar!, item!, kind),
    enabled: renderable && !worn,
    staleTime: 10 * 60_000,
    retry: 0,
  });
}

/** Bar under the preview while trying something on: blue price button + "…" menu (as in the app). */
function TryOnBar({ item, busy }: { item: NonNullable<Selected>; busy: boolean }) {
  const me = useMe();
  const { go } = useNav();
  const { toast } = useUi();
  const [buying, setBuying] = useState(false);
  const [menu, setMenu] = useState(false);
  const info = useQuery({
    queryKey: ["purchaseInfo", item.itemType, item.id],
    queryFn: () => purchaseInfo(item.itemType, item.id, me.id),
  });
  const p = info.data;
  const offSale = p?.priceStatus === "Off Sale" || (p && p.price == null);
  const copy = async () => {
    setMenu(false);
    const path = item.itemType === "Bundle" ? "bundles" : "catalog";
    try {
      await navigator.clipboard.writeText(`https://www.roblox.com/${path}/${item.id}`);
      toast("Link copied.");
    } catch {
      toast(t("Couldn't copy the link."), "error");
    }
  };
  return (
    <div className="tryon-bar">
      <button className="btn btn-primary tryon-buy" disabled={!p || p.owned || offSale} onClick={() => setBuying(true)}>
        {busy || info.isLoading ? <Spinner size={18} /> : p?.owned ? t("Owned") : offSale ? t("Off Sale") : p?.price ? <Robux amount={p.price} size={16} /> : t("Get")}
      </button>
      <div className="menu-anchor">
        <button className="square-btn" onClick={() => setMenu((m) => !m)} aria-label={t("More")}>
          <Icon name="dots-horizontal" size={20} />
        </button>
        {menu ? (
          <div className="menu up">
            <button onClick={() => (setMenu(false), go({ name: "item", itemType: item.itemType, id: item.id }))}>
              <Icon name="circle-i" size={18} /> View Details Page
            </button>
            <button onClick={copy}>
              <Icon name="chain-link" size={18} /> Copy Link
            </button>
          </div>
        ) : null}
      </div>
      {buying ? <BuyItemModal itemType={item.itemType} id={item.id} onClose={() => setBuying(false)} /> : null}
    </div>
  );
}

function Preview({
  version,
  tryOn,
  emoteId,
  rigType,
  onClearTryOn,
}: {
  version: number;
  tryOn: Selected;
  emoteId?: number | null;
  rigType?: "R6" | "R15" | null;
  onClearTryOn: () => void;
}) {
  const me = useMe();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"3d" | "2d">(() => {
    try {
      return (localStorage.getItem("ruby.avatarPreview") as "3d" | "2d") || "3d";
    } catch {
      return "3d";
    }
  });
  const avatar = useQuery({ queryKey: ["myAvatar"], queryFn: myAvatar });
  const setPreview = (m: "3d" | "2d") => {
    setMode(m);
    try {
      localStorage.setItem("ruby.avatarPreview", m);
    } catch {
      /* preference only */
    }
  };
  const switchType = async (rig: "R6" | "R15") => {
    await setAvatarType(rig);
    await redrawAvatar();
    qc.invalidateQueries({ queryKey: ["myAvatar"] });
    setTimeout(() => invalidateAvatar(me.id), 1500);
  };
  // 3D tries items on locally in the rigged avatar; 2D asks Roblox to render a picture.
  const render = useTryOn(mode === "2d" ? tryOn : null, "2d", avatar.data);
  const backdrop = useBackdrop(me.id, tryOn?.assetType === BACKGROUND_TYPE ? tryOn.id : undefined);
  const trying = !!tryOn;
  return (
    <div className={`preview ${backdrop ? "has-backdrop" : ""}`} style={backdrop && mode === "2d" ? { backgroundImage: `url("${backdrop}")` } : undefined}>
      {mode === "3d" ? (
        <AvatarRig userId={me.id} self version={version} tryOn={tryOn} emoteId={emoteId} rigType={rigType} backdrop={backdrop} className="preview-3d" />
      ) : render.data ? (
        <img src={render.data} alt="" className="preview-render fade-in" key={render.data} />
      ) : (
        <Thumb type="Avatar" id={me.id} size="720x720" className="preview-render" />
      )}
      {render.error ? <div className="tryon-chip error">{friendlyError(render.error)}</div> : null}
      {trying ? <TryOnBar item={tryOn!} busy={render.isFetching} /> : null}
      <div className="preview-undo">
        {/* The app's Undo reverts the last try-on; Redo has nothing to replay here. */}
        <button className="icon-btn" onClick={onClearTryOn} disabled={!trying} aria-label={t("Undo")} title={t("Undo")}>
          <Icon name="arrow-curl-to-left" size={20} />
        </button>
        <button className="icon-btn" disabled aria-label={t("Redo")} title={t("Redo")}>
          <Icon name="arrow-curl-to-right" size={20} />
        </button>
      </div>
      <div className="preview-tools">
        <div className="segmented small">
          {(["R6", "R15"] as const).map((rig) => (
            <button key={rig} className={avatar.data?.playerAvatarType === rig ? "active" : ""} onClick={() => switchType(rig)}>
              {rig}
            </button>
          ))}
        </div>
        <div className="segmented small">
          {(["3d", "2d"] as const).map((m) => (
            <button key={m} className={mode === m ? "active" : ""} onClick={() => setPreview(m)}>
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="preview-robux">
        <Robux amount={me.robux ?? 0} />
      </div>
    </div>
  );
}

function Customize({
  onSelect,
  selected,
  details,
  onDetails,
  onChanged,
}: {
  onSelect: (s: Selected) => void;
  selected: Selected;
  details: boolean;
  onDetails: (open: boolean) => void;
  onChanged: Changed;
}) {
  const me = useMe();
  const qc = useQueryClient();
  const { toast } = useUi();
  const [tab, setTab] = useState<CustomizeTab>("Clothing");
  const avatar = useQuery({ queryKey: ["myAvatar"], queryFn: myAvatar });
  const wearing = useQuery({ queryKey: ["wearing", me.id], queryFn: () => currentlyWearing(me.id), enabled: tab === "Backgrounds" });
  const items = useQuery({
    queryKey: ["inventory", me.id, tab],
    enabled: tab !== "Avatars",
    queryFn: async () => boughtFirst(await inventory(me.id, [...CUSTOMIZE_TABS[tab as keyof typeof CUSTOMIZE_TABS]])),
  });
  const fits = useQuery({ queryKey: ["outfits", me.id], enabled: tab === "Avatars", queryFn: () => outfits(me.id) });
  // The equipped background (it isn't in the worn-assets list).
  const bg = useQuery({ queryKey: ["profileBackground", me.id], queryFn: () => profileBackground(me.id!), enabled: !!me.id, staleTime: 60_000 });
  const worn = new Set([
    ...(bg.data ? [bg.data] : []),
    ...(avatar.data?.assets ?? []).map((a) => a.id),
    ...(wearing.data ?? []).map((w) => w.id),
    ...(avatar.data?.emotes ?? []).map((e) => e.assetId),
  ]);

  const afterChange = async () => {
    await redrawAvatar();
    await qc.invalidateQueries({ queryKey: ["myAvatar"] });
    qc.invalidateQueries({ queryKey: ["wearing", me.id] });
    setTimeout(() => invalidateAvatar(me.id), 1500);
    onChanged();
  };

  const [slot, setSlot] = useState(1);
  // Which slot tile is open in each tab, the body part shown under Full Body, and the makeup filter.
  const [slotKeys, setSlotKeys] = useState<Record<string, string>>({});
  const [bodyPart, setBodyPart] = useState<number | null>(null);
  const [makeupFilter, setMakeupFilter] = useState(0);
  const tabSlots = SLOTS[tab] ?? [];
  const activeSlot = tabSlots.find((x) => x.key === slotKeys[tab]) ?? tabSlots[0];
  const shownTypes: number[] | null =
    tab === "Makeup"
      ? MAKEUP_FILTERS[makeupFilter].types
      : activeSlot
        ? activeSlot.key === "full" && bodyPart
          ? [bodyPart]
          : activeSlot.types
        : null;
  const shownItems = (items.data ?? []).filter((it) => !shownTypes || shownTypes.includes(it.assetTypeId));
  const wornOf = (types: number[]) => (avatar.data?.assets ?? []).find((a) => types.includes(a.assetType.id))?.id;
  const makeupLayers = (avatar.data?.assets ?? []).filter((a) => MAKEUP_LAYER_TYPES.includes(a.assetType.id));
  const clearTab = async () => {
    const types: number[] = [...(CUSTOMIZE_TABS[tab as keyof typeof CUSTOMIZE_TABS] ?? [])];
    const current: WornAsset[] = avatar.data?.assets ?? [];
    const keep = current.filter((a) => !types.includes(a.assetType.id));
    if (keep.length === current.length) return;
    try {
      await setWearing(keep.map((a) => ({ id: a.id, ...(a.meta ? { meta: a.meta } : {}) })));
      await afterChange();
    } catch (e) {
      toast(t("Couldn't update avatar: {error}", { error: friendlyError(e) }), "error");
    }
  };
  const bodySaved = async () => {
    await qc.invalidateQueries({ queryKey: ["myAvatar"] });
    await afterChange();
  };
  const toggle = async (id: number, assetTypeId: number) => {
    try {
      if (assetTypeId === EMOTE_TYPE) {
        const current = avatar.data?.emotes ?? [];
        await (worn.has(id) ? unequipEmote(current, id) : equipEmote(current, id, slot));
        await qc.invalidateQueries({ queryKey: ["myAvatar"] });
        toast(worn.has(id) ? t("Emote unequipped.") : t("Emote equipped."));
        return;
      }
      if (assetTypeId === BACKGROUND_TYPE) {
        // Backgrounds live outside the worn-assets list (v4 avatar API).
        const next = worn.has(id) ? null : id;
        await setAvatarBackground(next);
        // Show it as equipped right away; Roblox's profile service can lag a few seconds.
        qc.setQueryData(["profileBackground", me.id], next);
        setTimeout(() => qc.invalidateQueries({ queryKey: ["profileBackground", me.id] }), 4000);
      } else {
        const current: WornAsset[] = avatar.data?.assets ?? [];
        let next: { id: number; meta?: unknown }[];
        if (worn.has(id)) next = current.filter((a) => a.id !== id);
        else {
          const keep = SINGLE_SLOT.has(assetTypeId) ? current.filter((a) => a.assetType.id !== assetTypeId) : current;
          next = [...keep, { id }];
        }
        const res = await setWearing(next.map((a) => ({ id: a.id, ...(a.meta ? { meta: a.meta } : {}) })));
        if (res.invalidAssetIds?.length) toast("Roblox rejected that combination of items.", "error");
      }
      await afterChange();
    } catch (e) {
      toast(t("Couldn't update avatar: {error}", { error: friendlyError(e) }), "error");
    }
  };

  const wear = async (outfitId: number) => {
    try {
      await wearOutfit(outfitId);
      await afterChange();
    } catch (e) {
      toast(t("Couldn't wear outfit: {error}", { error: friendlyError(e) }), "error");
    }
  };

  const typeOf = (id: number) => items.data?.find((i) => i.id === id)?.assetTypeId ?? 0;
  const emotes = avatar.data?.emotes ?? [];
  /** Equip an emote straight into the selected slot (the app's Emotes tab behaviour). */
  const equipToSlot = async (id: number) => {
    try {
      await equipEmote(emotes, id, slot);
      await qc.invalidateQueries({ queryKey: ["myAvatar"] });
      toast(t("Emote equipped to slot {slot}.", { slot }));
    } catch (e) {
      toast(t("Couldn't equip emote: {error}", { error: friendlyError(e) }), "error");
    }
  };

  return (
    <>
      <div className="tabs sub">
        {CUSTOMIZE_ORDER.map((ct) => (
          <button key={ct} className={tab === ct ? "active" : ""} onClick={() => setTab(ct)}>
            {CUSTOMIZE_LABELS[ct]()}
          </button>
        ))}
      </div>
      {tabSlots.length ? (
        <SlotBar
          slots={tabSlots}
          active={activeSlot?.key ?? ""}
          onPick={(key) => setSlotKeys((m) => ({ ...m, [tab]: key }))}
          wornOf={wornOf}
          onClear={tab === "Body" ? undefined : () => void clearTab()}
        />
      ) : null}
      {tab === "Makeup" ? (
        <>
          <div className="slot-bar hscroll">
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const a = makeupLayers[i];
              return (
                <button
                  key={i}
                  className="slot-tile"
                  disabled={!a}
                  onClick={() => a && (onSelect({ id: a.id, itemType: "Asset", assetType: a.assetType.id }), onDetails(true))}
                >
                  <span className="slot-art">{a ? <Thumb type="Asset" id={a.id} className="square" /> : <Icon name="plus-small" size={22} />}</span>
                  <span className="slot-label">{t("Layer {n}", { n: i + 1 })}</span>
                </button>
              );
            })}
            {[
              { label: t("Eyelashes"), type: 76, filter: 4 },
              { label: t("Eyebrows"), type: 77, filter: 5 },
            ].map((x) => {
              const id = wornOf([x.type]);
              return (
                <button key={x.type} className="slot-tile" onClick={() => setMakeupFilter(x.filter)}>
                  <span className="slot-art">{id ? <Thumb type="Asset" id={id} className="square" /> : <Icon name="plus-small" size={22} />}</span>
                  <span className="slot-label">{x.label}</span>
                </button>
              );
            })}
            <button className="slot-tile" onClick={() => void clearTab()} title={t("Take off all makeup")}>
              <span className="slot-art">
                <Icon name="arrow-spin-clockwise" size={22} />
              </span>
              <span className="slot-label">{t("Clear")}</span>
            </button>
          </div>
          <div className="pill-row">
            {MAKEUP_FILTERS.map((m, i) => (
              <button key={i} className={`pill ${makeupFilter === i ? "on" : ""}`} onClick={() => setMakeupFilter(i)}>
                {m.label()}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {tab === "Body" && activeSlot?.key === "full" ? (
        <div className="body-parts-row">
          <span className="muted small">{t("Body Parts")}</span>
          <Select
            value={bodyPart ? String(bodyPart) : "all"}
            ariaLabel={t("Body Parts")}
            onChange={(v) => setBodyPart(v === "all" ? null : Number(v))}
            options={[{ value: "all", label: t("Full Body") }, ...BODY_PARTS.map((p) => ({ value: String(p.type), label: p.label() }))]}
          />
        </div>
      ) : null}
      {tab === "Emotes" ? (
        <div className="emote-slots" role="radiogroup" aria-label={t("Emote slots")}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
            const e = emotes.find((x) => x.position === n);
            return (
              <button
                key={n}
                role="radio"
                aria-checked={slot === n}
                className={`emote-slot-btn ${slot === n ? "on" : ""}`}
                onClick={() => {
                  setSlot(n);
                  if (e) onSelect({ id: e.assetId, itemType: "Asset", assetType: EMOTE_TYPE });
                }}
                title={e ? t("Slot {n}: {name}", { n, name: e.assetName }) : t("Slot {n} (empty)", { n })}
              >
                {e ? <Thumb type="Asset" id={e.assetId} className="square" /> : <span className="slot-num">{n}</span>}
              </button>
            );
          })}
        </div>
      ) : null}
      {tab === "Avatars" ? (
        <div className="outfit-bar">
          <button
            className="btn btn-secondary btn-small"
            onClick={async () => {
              const name = (await askText(t("Name this outfit"), t("My outfit")))?.trim();
              if (!name) return;
              try {
                await saveCurrentOutfit(name.slice(0, 50));
                toast(t("Saved \"{name}\".", { name }));
                fits.refetch();
              } catch (e) {
                toast(friendlyError(e), "error");
              }
            }}
          >
            {t("Save current look")}
          </button>
        </div>
      ) : null}
      {tab === "Avatars" ? (
        fits.isLoading ? (
          <SkeletonGrid count={12} />
        ) : fits.error ? (
          <ErrorState error={fits.error} retry={() => fits.refetch()} />
        ) : fits.data?.length ? (
          <div className="item-grid">
            {fits.data.map((o) => (
              <button key={o.id} className="item" onClick={() => wear(o.id)} title={t("Wear this outfit")}>
                <Thumb type="Outfit" id={o.id} className="square" />
                <div className="item-name">{o.name}</div>
              </button>
            ))}
          </div>
        ) : (
          <Empty icon="person-standing">{t("No saved outfits.")}</Empty>
        )
      ) : activeSlot?.panel === "build" ? (
        <BuildPanel avatar={avatar.data} onSaved={() => void bodySaved()} onError={(e) => toast(t("Couldn't update avatar: {error}", { error: friendlyError(e) }), "error")} />
      ) : activeSlot?.panel === "skin" ? (
        <SkinPanel avatar={avatar.data} onSaved={() => void bodySaved()} onError={(e) => toast(t("Couldn't update avatar: {error}", { error: friendlyError(e) }), "error")} />
      ) : items.isLoading ? (
        <SkeletonGrid count={18} />
      ) : items.error ? (
        <ErrorState error={items.error} retry={() => items.refetch()} />
      ) : shownItems.length ? (
        <div className="item-grid">
          {shownItems.map((it, i) => {
            const isSel = selected?.id === it.id;
            const isEmote = it.assetTypeId === EMOTE_TYPE;
            return (
              <div
                key={it.id}
                className={`item card-in ${worn.has(it.id) ? "worn" : ""} ${isSel ? "selected" : ""}`}
                style={{ animationDelay: `${Math.min(i, 24) * 18}ms` }}
              >
                <div className="item-thumb-wrap">
                  <button
                    className="item-hit"
                    onClick={() => {
                      // Wearables equip on tap like the app; emotes just highlight (equip from Details).
                      onSelect({ id: it.id, itemType: "Asset", assetType: it.assetTypeId });
                      onDetails(false);
                      if (!isEmote) toggle(it.id, it.assetTypeId);
                      else if (emotes.find((x) => x.position === slot)?.assetId !== it.id) equipToSlot(it.id);
                    }}
                    title={isEmote ? it.name : worn.has(it.id) ? t("Remove") : t("Wear")}
                  >
                    <Thumb type="Asset" id={it.id} className="square" />
                  </button>
                  {isEmote && worn.has(it.id) ? <span className="emote-slot">{avatar.data?.emotes?.find((e) => e.assetId === it.id)?.position}</span> : null}
                  <button className="item-details" onClick={() => {
                    onSelect({ id: it.id, itemType: "Asset", assetType: it.assetTypeId });
                    onDetails(true);
                  }}>
                    {t("Details")}
                  </button>
                </div>
                {isEmote ? <div className="item-name small">{it.name}</div> : null}
              </div>
            );
          })}
        </div>
      ) : (
        <Empty icon="backpack">{t("Nothing here yet. Find some in the Marketplace.")}</Empty>
      )}
      {selected && details ? (
        <DetailsPanel sel={selected} onClose={() => onDetails(false)} worn={worn.has(selected.id)} onToggle={() => toggle(selected.id, typeOf(selected.id))} />
      ) : null}
    </>
  );
}

/**
 * Marketplace cards behave like the app: tap = try it on (preview updates, card highlights),
 * then the highlighted card's "Details" opens the full item card.
 */
function ItemGrid({
  items,
  selected,
  onSelect,
  onDetails,
}: {
  items: CatalogItem[];
  selected: Selected;
  onSelect: (s: Selected) => void;
  onDetails: (open: boolean) => void;
}) {
  return (
    <div className="item-grid">
      {items.map((it, i) => {
        const sel = { id: it.id, itemType: it.itemType, assetType: it.assetType };
        const isSel = selected?.id === it.id && selected.itemType === it.itemType;
        return (
          <div
            key={`${it.itemType}${it.id}`}
            className={`item card-in ${isSel ? "selected" : ""}`}
            style={{ animationDelay: `${Math.min(i, 24) * 18}ms` }}
          >
            <div className="item-thumb-wrap">
              <button
                className="item-hit"
                onClick={() => {
                  onSelect(isSel ? null : sel);
                  onDetails(false);
                }}
                title={isSel ? t("Stop trying on") : t("Try on")}
              >
                <Thumb type={it.itemType === "Bundle" ? "BundleThumbnail" : "Asset"} id={it.id} className="square" />
                <span className="item-badge">
                  <LimitedBadge kind={restrictionsKind(it.itemRestrictions)} small />
                </span>
              </button>
              <button
                className="item-details"
                onClick={() => {
                  onSelect(sel);
                  onDetails(true);
                }}
              >
                {t("Details")}
              </button>
            </div>
            <div className="item-name">{it.name}</div>
            <div className="item-creator muted">
              {it.creatorName} {it.creatorHasVerifiedBadge ? <Verified size={11} /> : null}
            </div>
            <div className="item-price">{priceLabel(it)}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Marketplace with Roblox's real taxonomy categories (incl. Backgrounds + Makeup). */
const SORT_LABELS = (): [MarketFilters["sort"], string][] => [
  ["relevance", t("Relevance")],
  ["bestselling", t("Best selling")],
  ["favorited", t("Most favorited")],
  ["recent", t("Recently updated")],
  ["priceHigh", t("Price: high to low")],
  ["priceLow", t("Price: low to high")],
];

/** The Filter sheet: sort, price, sale type, off-sale, creator (a username or one of your communities). */
function MarketFilterPanel({ value: f, onChange }: { value: MarketFilters; onChange: (f: MarketFilters) => void }) {
  const me = useMe();
  const groups = useQuery({ queryKey: ["communities", me.id], queryFn: () => communities(me.id), staleTime: 10 * 60_000 });
  const [creatorText, setCreatorText] = useState(f.creator?.type === "User" ? (f.creator.name ?? "") : "");
  const set = (p: Partial<MarketFilters>) => onChange({ ...f, ...p });
  const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.floor(Number(v) || 0)));
  const seg = <K extends keyof MarketFilters>(k: K, opts: [MarketFilters[K], string][]) => (
    <div className="segmented small">
      {opts.map(([v, l]) => (
        <button key={String(v)} className={f[k] === v ? "active" : ""} onClick={() => set({ [k]: v } as Partial<MarketFilters>)}>
          {l}
        </button>
      ))}
    </div>
  );
  return (
    <div className="market-filters card-in">
      <label className="mf-field">
        <span className="muted small">{t("Sort by")}</span>
        <Select value={f.sort} options={SORT_LABELS().map(([v, l]) => ({ value: v, label: l }))} onChange={(v) => set({ sort: v })} />
      </label>
      <div className="mf-field">
        <span className="muted small">{t("Price")}</span>
        <div className="mf-price">
          {seg("price", [["any", t("Any")], ["free", t("Free")]])}
          {f.price === "any" ? (
            <>
              <input className="text-input mf-num" inputMode="numeric" placeholder={t("Min")} value={f.minPrice ?? ""} onChange={(e) => set({ minPrice: num(e.target.value) })} />
              <input className="text-input mf-num" inputMode="numeric" placeholder={t("Max")} value={f.maxPrice ?? ""} onChange={(e) => set({ maxPrice: num(e.target.value) })} />
            </>
          ) : null}
        </div>
      </div>
      <div className="mf-field">
        <span className="muted small">{t("Sales type")}</span>
        {seg("sale", [["all", t("All")], ["limited", t("Limited")]])}
      </div>
      <div className="mf-field">
        <span className="muted small">{t("Off-sale items")}</span>
        {seg("offSale", [["hide", t("Hide")], ["show", t("Show")], ["only", t("Only off-sale")]])}
      </div>
      <div className="mf-field mf-creator">
        <span className="muted small">{t("Creator")}</span>
        <div className="mf-price">
          <input
            className="text-input"
            placeholder={t("Username")}
            value={creatorText}
            onChange={(e) => setCreatorText(e.target.value)}
            onBlur={() => set({ creator: creatorText.trim() ? { type: "User", name: creatorText.trim() } : f.creator?.type === "Group" ? f.creator : null })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          <Select
            value={f.creator?.type === "Group" ? String(f.creator.id) : ""}
            options={[{ value: "", label: t("Any of my communities") }, ...(groups.data ?? []).map((g) => ({
                value: String(g.id),
                label: (
                  <span className="sel-group">
                    <Thumb type="GroupIcon" id={g.id} size="150x150" className="sel-gicon" />
                    <span className="ellipsis">{g.name}</span>
                  </span>
                ),
              })),
            ]}
            onChange={(v) => {
              setCreatorText("");
              const g = groups.data?.find((x) => String(x.id) === v);
              set({ creator: g ? { type: "Group", id: g.id, name: g.name } : null });
            }}
          />
        </div>
      </div>
      <button className="link small" onClick={() => (setCreatorText(""), onChange(DEFAULT_FILTERS))}>
        {t("Reset filters")}
      </button>
    </div>
  );
}

/** The Marketplace's second row of tabs (Shirts, T-Shirts…). Tap the open one again to show all. */
function SubTabs({ items, value, onChange }: { items: MarketSub[]; value: string | null; onChange: (v: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = () => {
    const el = ref.current;
    if (el) setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [items]);
  const nudge = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.6, behavior: "smooth" });
  return (
    <div className="market-subtabs">
      {edges.left ? (
        <button className="subtab-arrow left" onClick={() => nudge(-1)} aria-label={t("Scroll left")}>
          <Icon name="chevron-small-left" size={20} />
        </button>
      ) : null}
      <div className="subtab-track" ref={ref} onScroll={measure}>
        {items.map((x) => (
          <button key={x.taxonomy} className={value === x.taxonomy ? "active" : ""} onClick={() => onChange(value === x.taxonomy ? null : x.taxonomy)}>
            {x.name}
          </button>
        ))}
      </div>
      {edges.right ? (
        <button className="subtab-arrow right" onClick={() => nudge(1)} aria-label={t("Scroll right")}>
          <Icon name="chevron-small-right" size={20} />
        </button>
      ) : null}
    </div>
  );
}

function Marketplace({
  onSelect,
  selected,
  details,
  onDetails,
}: {
  onSelect: (s: Selected) => void;
  selected: Selected;
  details: boolean;
  onDetails: (open: boolean) => void;
}) {
  const cats = useQuery({ queryKey: ["marketCategories"], queryFn: marketCategories, staleTime: 60 * 60_000 });
  const [cat, setCat] = useState<MarketCategory | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [draft, setDraft] = useState("");
  const [trendingAll, setTrendingAll] = useState(false);
  const [filters, setFilters] = useState<MarketFilters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  // The app puts an "Avatars" tab (full bodies) right after All.
  const categories = useMemo(() => {
    const list = cats.data ?? [];
    const full = list.flatMap((c) => c.subcategories).find((x) => /full bod/i.test(x.name));
    if (!list.length || !full) return list;
    return [list[0], { name: "Avatars", taxonomy: full.taxonomy, subcategories: [] }, ...list.slice(1)];
  }, [cats.data]);
  const active = cat ?? categories[0] ?? null;
  const isHome = !!active && active === categories[0] && !keyword && !sub && !trendingAll && !filtersActive(filters);
  const taxonomy = sub ?? active?.taxonomy;

  const recommended = useQuery({ queryKey: ["marketRecommended"], queryFn: marketRecommended, enabled: isHome, staleTime: 10 * 60_000 });
  const trending = useQuery({
    queryKey: ["marketTrending"],
    queryFn: () => marketSearch({ taxonomy: categories[0]?.taxonomy, sort: "trending", limit: 30 }),
    enabled: isHome && !!categories[0],
    staleTime: 10 * 60_000,
  });
  const search = useInfiniteQuery({
    queryKey: ["market", taxonomy, keyword, trendingAll, filters],
    queryFn: ({ pageParam }) => marketSearch({ taxonomy, keyword, cursor: pageParam, filters, ...(trendingAll ? { sort: "trending" as const } : {}) }),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextPageCursor || undefined,
    enabled: !!active && !isHome,
  });
  const items: CatalogItem[] = search.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <>
      <div className="market-bar">
        <div className="tabs sub">
          {categories.map((c) => (
            <button
              key={c.taxonomy}
              className={active?.taxonomy === c.taxonomy ? "active" : ""}
              onClick={() => {
                setCat(c);
                setSub(null);
                setTrendingAll(false);
              }}
            >
              {c.name === "All" ? "All" : c.name}
            </button>
          ))}
        </div>
        <form
          className="filter"
          onSubmit={(e) => {
            e.preventDefault();
            setKeyword(draft.trim());
          }}
        >
          <Icon name="magnifying-glass" size={16} />
          <input placeholder={t("Search marketplace")} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </form>
        <button className={`btn btn-secondary btn-small filter-btn ${filtersActive(filters) ? "on" : ""}`} onClick={() => setShowFilters((v) => !v)}>
          <Icon name="three-sliders-horizontal" size={16} /> Filters
        </button>
      </div>
      {showFilters ? <MarketFilterPanel value={filters} onChange={setFilters} /> : null}
      {active && active.subcategories.length ? (
        <SubTabs items={active.subcategories} value={sub} onChange={setSub} />
      ) : null}
      {cats.isLoading ? (
        <SkeletonGrid count={18} />
      ) : cats.error ? (
        <ErrorState error={cats.error} retry={() => cats.refetch()} />
      ) : isHome ? (
        <>
          <RecentlyViewed />
          <section className="shelf">
            <SectionHeader title={t("Recommended For You")} />
            {recommended.isLoading ? (
              <SkeletonGrid count={14} />
            ) : recommended.error ? (
              <ErrorState error={recommended.error} retry={() => recommended.refetch()} />
            ) : (
              <ItemGrid items={(recommended.data ?? []).slice(0, 14)} selected={selected} onSelect={onSelect} onDetails={onDetails} />
            )}
          </section>
          {trending.data?.data.length ? (
            <section className="shelf">
              <div className="row-between">
                <h2 className="section-title">{t("Trending Items")}</h2>
                <button className="chip see-all" onClick={() => setTrendingAll(true)}>
                  {t("See All")}
                </button>
              </div>
              <div className="item-row hscroll">
                <ItemGrid items={trending.data.data.slice(0, 20)} selected={selected} onSelect={onSelect} onDetails={onDetails} />
              </div>
            </section>
          ) : null}
          {(recommended.data?.length ?? 0) > 14 ? (
            <section className="shelf">
              <SectionHeader title={t("Just For You")} />
              <ItemGrid items={(recommended.data ?? []).slice(14)} selected={selected} onSelect={onSelect} onDetails={onDetails} />
            </section>
          ) : null}
        </>
      ) : search.isLoading ? (
        <SkeletonGrid count={18} />
      ) : search.error ? (
        <ErrorState error={search.error} retry={() => search.refetch()} />
      ) : items.length ? (
        <>
          <ItemGrid items={items} selected={selected} onSelect={onSelect} onDetails={onDetails} />
          {search.hasNextPage ? (
            <button className="btn btn-secondary load-more" onClick={() => search.fetchNextPage()} disabled={search.isFetchingNextPage}>
              {search.isFetchingNextPage ? t("Loading...") : t("Load more")}
            </button>
          ) : null}
        </>
      ) : (
        <Empty icon="magnifying-glass">{t("No items found.")}</Empty>
      )}
      {selected && details ? <DetailsPanel sel={selected} onClose={() => onDetails(false)} /> : null}
    </>
  );
}

function EditBioModal({ initial, onClose }: { initial: string; onClose: () => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const { toast } = useUi();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await updateDescription(text);
      toast("Profile updated.");
      qc.invalidateQueries({ queryKey: ["user", me.id] });
      onClose();
    } catch (e) {
      toast(friendlyError(e), "error");
      setBusy(false);
    }
  };
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="buy-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="buy-head">
          <h2>{t("Edit profile")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("Close")}>
            <Icon name="x-small" size={20} />
          </button>
        </div>
        <label className="muted small">{t("About")}</label>
        <textarea className="bio-input" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} rows={6} />
        <div className="muted small bio-count">{text.length}/1000</div>
        <div className="buy-actions">
          <button className="btn btn-primary btn-block" onClick={save} disabled={busy}>
            {busy ? <Spinner size={18} /> : t("Save")}
          </button>
          <button className="btn btn-secondary btn-block" onClick={onClose} disabled={busy}>
            {t("Cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Share QR Code" (Profile tab → QR): a scannable link to your profile, as in the app. */
function ShareQr({ onBack, onCopy }: { onBack: () => void; onCopy: () => void }) {
  const me = useMe();
  const url = `https://www.roblox.com/users/${me.id}/profile`;
  const qr = useQuery({
    queryKey: ["profileQr", url],
    // The QR encoder is only loaded when this page opens.
    queryFn: async () => (await import("qrcode")).default.toDataURL(url, { errorCorrectionLevel: "H", margin: 1, width: 360, color: { dark: "#000000", light: "#ffffff" } }),
    staleTime: Infinity,
  });
  return (
    <div className="profile-panel share-qr">
      <div className="share-qr-head">
        <button className="icon-btn" onClick={onBack} aria-label={t("Back")}>
          <Icon name="arrow-large-left" size={22} />
        </button>
        <b>{t("Share QR Code")}</b>
      </div>
      <div className="share-qr-body">
        <div className="qr-card">
          <div className="qr-code">
            {qr.data ? <img src={qr.data} alt={t("Profile QR code")} /> : <Skel w={180} h={180} r={8} />}
            <span className="qr-face">
              <Headshot userId={me.id} size={44} />
            </span>
          </div>
          <b>{me.displayName}</b>
          <span className="muted small">@{me.name}</span>
        </div>
        <p className="muted small qr-note">{t("Let others scan your QR code to connect on Roblox.")}</p>
        <button className="btn btn-light btn-block" onClick={onCopy}>
          <Icon name="chain-link" size={18} /> Copy Profile Link
        </button>
      </div>
    </div>
  );
}

function ProfilePanel() {
  const me = useMe();
  const { go } = useNav();
  const { toast } = useUi();
  const [bioOpen, setBioOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [qr, setQr] = useState(false);
  const info = useQuery({ queryKey: ["user", me.id], queryFn: () => user(me.id) });
  const counts = useQuery({
    queryKey: ["counts", me.id],
    queryFn: async () => {
      const [f, fo, fi] = await Promise.all([
        friendCount(me.id),
        followerCount(me.id).catch(() => null),
        followingCount(me.id).catch(() => null),
      ]);
      return { friends: f, followers: fo, following: fi };
    },
  });
  const wearing = useQuery({ queryKey: ["wearing", me.id], queryFn: () => currentlyWearing(me.id) });
  const store = useQuery({ queryKey: ["userStore", me.id], queryFn: () => userStore(me.id) });
  const games = useQuery({ queryKey: ["userGames", me.id], queryFn: () => userGames(me.id) });
  const u = info.data;
  const bioLong = (u?.description || "").length > 140;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`https://www.roblox.com/users/${me.id}/profile`);
      toast(t("Profile link copied."));
    } catch {
      toast("Couldn't copy the link.", "error");
    }
  };

  if (qr) return <ShareQr onBack={() => setQr(false)} onCopy={copyLink} />;

  return (
    <div className="profile-panel">
      <div className="profile-panel-head">
        <Headshot userId={me.id} size={96} />
        <div className="profile-panel-id">
          <h1>
            {me.displayName} {me.hasVerifiedBadge ? <Verified size={16} /> : null}
          </h1>
          <div className="muted">@{me.name}</div>
        </div>
      </div>
      <div className="profile-panel-actions">
        <button className="btn btn-primary" onClick={() => go({ name: "avatar", tab: "customize" })}>
          {t("Edit appearance")}
        </button>
        <button className="btn btn-secondary" onClick={() => setEditing(true)}>
          {t("Edit profile")}
        </button>
        <button className="icon-btn more-btn" onClick={() => setQr(true)} aria-label={t("Share QR code")} title={t("Share QR code")}>
          <Icon name="squares-grid-qr" size={20} />
        </button>
      </div>
      <div className="count-pills">
        <button className="count-pill" onClick={() => go({ name: "connections", userId: me.id, kind: "friends" })}>
          <b>{compact(counts.data?.friends)}</b> {t("Friends")}
        </button>
        <button className="count-pill" onClick={() => go({ name: "connections", userId: me.id, kind: "followers" })}>
          <b>{compact(counts.data?.followers)}</b> {t("Followers")}
        </button>
        <button className="count-pill" onClick={() => go({ name: "connections", userId: me.id, kind: "following" })}>
          <b>{compact(counts.data?.following)}</b> {t("Following")}
        </button>
      </div>
      {u?.description ? (
        <div className="profile-bio">
          <p className={`description ${bioOpen || !bioLong ? "" : "clamp"}`}>{u.description}</p>
          {bioLong ? (
            <button className="link more-toggle" onClick={() => setBioOpen((o) => !o)}>
              {bioOpen ? "less" : "more"}
            </button>
          ) : null}
        </div>
      ) : null}
      {wearing.data?.length ? (
        <section className="shelf">
          <SectionHeader title={t("Currently Wearing")} />
          <ItemRow items={wearing.data} />
        </section>
      ) : null}
      {store.data?.length ? (
        <section className="shelf">
          <SectionHeader title={t("Store")} />
          <ItemRow items={store.data.map((s) => ({ id: s.id, name: s.name, price: s.lowestPrice ?? s.price ?? null, itemType: s.itemType }))} />
        </section>
      ) : null}
      {games.data?.length ? (
        <section className="shelf">
          <SectionHeader title={t("Games")} />
          <TileRow games={games.data} />
        </section>
      ) : null}
      {editing ? <EditBioModal initial={u?.description ?? ""} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}

export function Avatar({ tab = "customize" }: { tab?: "marketplace" | "customize" | "profile" }) {
  const qc = useQueryClient();
  const me = useMe();
  const [selected, setSelectedRaw] = useState<Selected>(null);
  const [details, setDetails] = useState(false);
  // R6 can't show emotes, animations, layered clothing or R15 bodies: ask before previewing.
  const [ask, setAsk] = useState<Exclude<Selected, null> | null>(null);
  const [rig, setRig] = useState<"R15" | null>(null);
  const [switching, setSwitching] = useState(false);
  const avatarData = useQuery({ queryKey: ["myAvatar"], queryFn: myAvatar });
  const isR6 = avatarData.data?.playerAvatarType === "R6";
  const setSelected = (sel: Selected) => {
    if (!sel) {
      setSelectedRaw(null);
      setRig(null);
      return;
    }
    setSelectedRaw(sel);
    if (isR6 && !rig) {
      needsR15(sel).then((need) => {
        if (need) setAsk(sel);
      });
    }
  };
  const previewAsR15 = () => {
    setRig("R15");
    setAsk(null);
  };
  const switchToR15 = async () => {
    setSwitching(true);
    try {
      await setAvatarType("R15");
      await redrawAvatar();
      await qc.invalidateQueries({ queryKey: ["myAvatar"] });
      setTimeout(() => invalidateAvatar(me.id), 1500);
      setRig(null);
      setAsk(null);
    } finally {
      setSwitching(false);
    }
  };
  const [version, setVersion] = useState(0);
  // Roblox needs a moment to re-render the 3D model after a change.
  const onChanged = () => setTimeout(() => setVersion((v) => v + 1), 1800);
  // Switching tabs drops the selection (and any try-on).
  useEffect(() => {
    setSelectedRaw(null);
    setRig(null);
    setAsk(null);
    setDetails(false);
  }, [tab]);
  return (
    <div className="avatar-page">
      <div className="avatar-left">
        {tab === "marketplace" ? (
          <Marketplace key="m" onSelect={setSelected} selected={selected} details={details} onDetails={setDetails} />
        ) : tab === "profile" ? (
          <ProfilePanel key="p" />
        ) : (
          <Customize key="c" onSelect={setSelected} selected={selected} details={details} onDetails={setDetails} onChanged={onChanged} />
        )}
      </div>
      {ask ? (
        <div className="modal-scrim" onClick={() => setAsk(null)}>
          <div className="buy-dialog r15-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("This item needs R15")}>
            <div className="buy-head">
              <h2>{t("Switch to R15?")}</h2>
              <button className="icon-btn" onClick={() => setAsk(null)} aria-label={t("Close")}>
                <Icon name="x-small" size={20} />
              </button>
            </div>
            <p className="muted">
              Your avatar is R6, which can't {ask.assetType != null && ANIMATION_TYPES.has(ask.assetType) ? "play animations or emotes" : "show this item"}. Preview it on an R15 body, or switch your avatar to R15.
            </p>
            <div className="buy-actions r15-actions">
              <button className="btn btn-primary btn-block" onClick={previewAsR15} disabled={switching}>
                {t("Preview as R15")}
              </button>
              <button className="btn btn-secondary btn-block" onClick={switchToR15} disabled={switching}>
                {switching ? <Spinner size={18} /> : t("Switch my avatar to R15")}
              </button>
              <button className="link small" onClick={() => setAsk(null)}>
                {t("Not now")}
              </button>
            </div>
            <p className="muted small">{t("Previewing doesn't change your avatar. Switching does, and you can switch back anytime.")}</p>
          </div>
        </div>
      ) : null}
      <div className="avatar-right">
        <Preview
          version={version}
          tryOn={tab === "marketplace" ? selected : null}
          emoteId={tab === "customize" && selected?.assetType === EMOTE_TYPE ? selected.id : 0}
          rigType={rig}
          onClearTryOn={() => {
            setSelected(null);
            setDetails(false);
          }}
        />
        {rig ? <div className="tryon-chip rig-chip">{t("Previewing as R15 · not saved")}</div> : null}
      </div>
    </div>
  );
}
