import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { rbx } from "../lib/ipc";
import { useItemPreview } from "./ItemPreview";
import { Icon, Robux, Skel, Thumb } from "./ui";
import { t } from "../lib/i18n";

/**
 * A profile's inventory, laid out like roblox.com's: a category list (with flyout
 * sub-categories), a breadcrumb, and a paged grid of items with creator and price.
 */

type Leaf = { label: string; types: number[]; bundles?: boolean };
type Cat = { label: string; types?: number[]; bundles?: boolean; children?: Leaf[] };

const CATEGORIES: Cat[] = [
  {
    label: "Accessories",
    children: [
      { label: "Head", types: [8] },
      { label: "Face", types: [42] },
      { label: "Neck", types: [43] },
      { label: "Shoulder", types: [44] },
      { label: "Front", types: [45] },
      { label: "Back", types: [46] },
      { label: "Waist", types: [47] },
      { label: "Gear", types: [19] },
    ],
  },
  { label: "Animations", types: [24] },
  { label: "Audio", types: [3] },
  {
    label: "Avatar Animations",
    children: [
      { label: "Run", types: [53] },
      { label: "Walk", types: [55] },
      { label: "Fall", types: [50] },
      { label: "Jump", types: [52] },
      { label: "Idle", types: [51] },
      { label: "Swim", types: [54] },
      { label: "Climb", types: [48] },
    ],
  },
  { label: "Backgrounds", types: [92] },
  {
    label: "Bottoms",
    children: [
      { label: "Pants", types: [66] },
      { label: "Shorts", types: [69] },
      { label: "Skirts", types: [72] },
    ],
  },
  { label: "Bundles", bundles: true },
  {
    label: "Classic Clothing",
    children: [
      { label: "Classic T-shirts", types: [2] },
      { label: "Classic Shirts", types: [11] },
      { label: "Classic Pants", types: [12] },
    ],
  },
  { label: "Decals", types: [13] },
  { label: "Emotes", types: [61] },
  { label: "Hair", types: [41] },
  { label: "Heads", types: [17, 79] },
  {
    label: "Makeup",
    children: [
      { label: "Eyes", types: [90] },
      { label: "Lips", types: [89] },
      { label: "Faces", types: [18] },
      { label: "Eyelash Accessory", types: [77] },
      { label: "Eyebrow Accessory", types: [76] },
    ],
  },
  { label: "Meshes", types: [40] },
  { label: "Models & Packages", types: [10] },
  { label: "Passes", types: [34] },
  { label: "Places", types: [9] },
  { label: "Plugins", types: [38] },
  {
    label: "Shoes",
    children: [
      { label: "Left Shoe", types: [70] },
      { label: "Right Shoe", types: [71] },
    ],
  },
  {
    label: "Tops",
    children: [
      { label: "T-shirts", types: [64] },
      { label: "Shirts", types: [65] },
      { label: "Sweaters", types: [68] },
      { label: "Jackets", types: [67] },
    ],
  },
  { label: "Video", types: [62] },
];

/** Display names for the category labels above (labels stay English: they're used as ids). */
const LABELS: Record<string, () => string> = {
  "Accessories": () => t("Accessories"),
  "Head": () => t("Head"),
  "Face": () => t("Face"),
  "Neck": () => t("Neck"),
  "Shoulder": () => t("Shoulder"),
  "Front": () => t("Front"),
  "Back": () => t("Back"),
  "Waist": () => t("Waist"),
  "Gear": () => t("Gear"),
  "Animations": () => t("Animations"),
  "Audio": () => t("Audio"),
  "Avatar Animations": () => t("Avatar Animations"),
  "Run": () => t("Run"),
  "Walk": () => t("Walk"),
  "Fall": () => t("Fall"),
  "Jump": () => t("Jump"),
  "Idle": () => t("Idle"),
  "Swim": () => t("Swim"),
  "Climb": () => t("Climb"),
  "Backgrounds": () => t("Backgrounds"),
  "Bottoms": () => t("Bottoms"),
  "Pants": () => t("Pants"),
  "Shorts": () => t("Shorts"),
  "Skirts": () => t("Skirts"),
  "Bundles": () => t("Bundles"),
  "Classic Clothing": () => t("Classic Clothing"),
  "Classic T-shirts": () => t("Classic T-shirts"),
  "Classic Shirts": () => t("Classic Shirts"),
  "Classic Pants": () => t("Classic Pants"),
  "Decals": () => t("Decals"),
  "Emotes": () => t("Emotes"),
  "Hair": () => t("Hair"),
  "Heads": () => t("Heads"),
  "Makeup": () => t("Makeup"),
  "Eyes": () => t("Eyes"),
  "Lips": () => t("Lips"),
  "Faces": () => t("Faces"),
  "Eyelash Accessory": () => t("Eyelash Accessory"),
  "Eyebrow Accessory": () => t("Eyebrow Accessory"),
  "Meshes": () => t("Meshes"),
  "Models & Packages": () => t("Models & Packages"),
  "Passes": () => t("Passes"),
  "Places": () => t("Places"),
  "Plugins": () => t("Plugins"),
  "Shoes": () => t("Shoes"),
  "Left Shoe": () => t("Left Shoe"),
  "Right Shoe": () => t("Right Shoe"),
  "Tops": () => t("Tops"),
  "T-shirts": () => t("T-shirts"),
  "Shirts": () => t("Shirts"),
  "Sweaters": () => t("Sweaters"),
  "Jackets": () => t("Jackets"),
  "Video": () => t("Video"),
};
const catName = (label: string) => LABELS[label]?.() ?? label;


const PAGE = 50; // 50 = full rows of 10 or 5 (see .inv-grid)

type Card = { id: number; name: string; itemType: "Asset" | "Bundle"; creator?: string; price?: number | null; offSale?: boolean; limited?: boolean };

/** One page of a category (one asset type at a time; "Heads" walks classic then dynamic). */
async function loadPage(userId: number, leaf: Leaf, cursor: string): Promise<{ items: Card[]; next: string | null }> {
  if (leaf.bundles) {
    const r = await rbx<{ data: { id: number; name: string; creator?: { name: string } }[]; nextPageCursor: string | null }>(
      `https://catalog.roblox.com/v1/users/${userId}/bundles?limit=${PAGE}&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    return { items: (r.data ?? []).map((b) => ({ id: b.id, name: b.name, itemType: "Bundle" as const, creator: b.creator?.name })), next: r.nextPageCursor };
  }
  // cursor = "<typeIndex>|<roblox cursor>" so multi-type categories page through each type.
  const [ti, c] = cursor ? [Number(cursor.split("|")[0]), cursor.slice(cursor.indexOf("|") + 1)] : [0, ""];
  const type = leaf.types[ti];
  const r = await rbx<{ data: { assetId: number; assetName: string }[]; nextPageCursor: string | null }>(
    `https://inventory.roblox.com/v2/users/${userId}/inventory/${type}?limit=${PAGE}&sortOrder=Desc${c ? `&cursor=${encodeURIComponent(c)}` : ""}`,
  );
  const items: Card[] = (r.data ?? []).map((d) => ({ id: d.assetId, name: d.assetName, itemType: "Asset" }));
  // Creator + price for whatever is on the catalog (other assets just show their name).
  if (items.length) {
    const det = await rbx<{ data: { id: number; creatorName?: string; price?: number | null; lowestPrice?: number | null; priceStatus?: string; itemRestrictions?: string[] }[] }>(
      "https://catalog.roblox.com/v1/catalog/items/details",
      { method: "POST", body: { items: items.map((i) => ({ itemType: "Asset", id: i.id })) } },
    ).catch(() => ({ data: [] }));
    const byId = new Map(det.data.map((d) => [d.id, d]));
    for (const it of items) {
      const d = byId.get(it.id);
      if (!d) continue;
      it.creator = d.creatorName;
      it.limited = (d.itemRestrictions ?? []).some((x) => /limited/i.test(x));
      it.offSale = d.priceStatus === "Off Sale" || (d.price == null && d.lowestPrice == null);
      it.price = d.lowestPrice ?? d.price ?? null;
    }
  }
  const next = r.nextPageCursor ? `${ti}|${r.nextPageCursor}` : ti + 1 < leaf.types.length ? `${ti + 1}|` : null;
  return { items, next };
}

function CategoryList({ active, onPick }: { active: { cat: string; leaf: string }; onPick: (cat: Cat, leaf: Leaf) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const closeT = useRef<number>();
  const hover = (label: string | null) => {
    window.clearTimeout(closeT.current);
    if (label) setOpen(label);
    else closeT.current = window.setTimeout(() => setOpen(null), 160);
  };
  return (
    <nav className="inv-cats" aria-label={t("Inventory categories")}>
      <div className="inv-cats-title">{t("Category")}</div>
      {CATEGORIES.map((c) => {
        const on = active.cat === c.label;
        return (
          <div key={c.label} className="inv-cat-wrap" onMouseEnter={() => c.children && hover(c.label)} onMouseLeave={() => c.children && hover(null)}>
            <button
              className={`inv-cat ${on ? "on" : ""} ${open === c.label ? "hover" : ""}`}
              onClick={() => (c.children ? (setOpen(open === c.label ? null : c.label)) : onPick(c, { label: c.label, types: c.types ?? [], bundles: c.bundles }))}
              aria-haspopup={c.children ? "menu" : undefined}
              aria-expanded={c.children ? open === c.label : undefined}
            >
              <span>{catName(c.label)}</span>
              {c.children ? <Icon name="chevron-small-right" size={16} /> : null}
            </button>
            {c.children && open === c.label ? (
              <div className="inv-flyout" role="menu">
                {c.children.map((l) => (
                  <button
                    key={l.label}
                    role="menuitem"
                    className={`inv-sub ${on && active.leaf === l.label ? "on" : ""}`}
                    onClick={() => {
                      onPick(c, l);
                      setOpen(null);
                    }}
                  >
                    {catName(l.label)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

export function InventoryBrowser({ userId }: { userId: number }) {
  const preview = useItemPreview();
  const [sel, setSel] = useState<{ cat: Cat; leaf: Leaf }>(() => ({ cat: CATEGORIES[0], leaf: CATEGORIES[0].children![0] }));
  // Cursor history: index = page number - 1.
  const [cursors, setCursors] = useState<string[]>([""]);
  const page = cursors.length;
  const cursor = cursors[cursors.length - 1];
  useEffect(() => setCursors([""]), [sel.leaf]);

  const q = useQuery({
    queryKey: ["invBrowse", userId, sel.cat.label, sel.leaf.label, cursor],
    queryFn: () => loadPage(userId, sel.leaf, cursor),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  const items = q.data?.items ?? [];
  const isSub = !!sel.cat.children;

  return (
    <div className="inv-browser">
      <CategoryList active={{ cat: sel.cat.label, leaf: sel.leaf.label }} onPick={(cat, leaf) => setSel({ cat, leaf })} />
      <div className="inv-main">
        <div className="inv-crumb">
          {isSub ? (
            <>
              <span>{catName(sel.cat.label)}</span>
              <Icon name="chevron-small-right" size={16} />
              <b>{catName(sel.leaf.label)}</b>
            </>
          ) : (
            <b>{catName(sel.cat.label)}</b>
          )}
        </div>
        {q.isLoading ? (
          <div className="inv-grid">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="inv-card">
                <Skel h={0} r={8} className="inv-thumb-skel" />
                <Skel w="80%" h={12} />
                <Skel w="50%" h={10} />
              </div>
            ))}
          </div>
        ) : q.error ? (
          <p className="muted small inv-empty">{t("Roblox wouldn't show this part of their inventory.")}</p>
        ) : items.length ? (
          <div className={`inv-grid ${q.isFetching ? "fetching" : ""}`}>
            {items.map((it, i) => (
              <button
                key={`${it.itemType}${it.id}`}
                className="inv-card card-in"
                style={{ animationDelay: `${Math.min(i, 20) * 14}ms` }}
                onClick={() => preview({ itemType: it.itemType, id: it.id })}
                title={it.name}
              >
                <div className="inv-thumb">
                  <Thumb type={it.itemType === "Bundle" ? "BundleThumbnail" : "Asset"} id={it.id} className="square" />
                  {it.limited ? <span className="inv-limited">{t("Limited")}</span> : null}
                </div>
                <div className="inv-name two-line">{it.name}</div>
                {it.creator ? (
                  <div className="inv-creator ellipsis">
                    {t("By")} <b>{it.creator}</b>
                  </div>
                ) : null}
                {it.offSale ? (
                  <div className="inv-price muted">{t("Off Sale")}</div>
                ) : it.price != null ? (
                  <div className="inv-price">
                    <Robux amount={it.price} size={13} />
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <p className="muted small inv-empty">{t("Nothing in {category} yet.", { category: catName(sel.leaf.label).toLowerCase() })}</p>
        )}
        {page > 1 || q.data?.next ? (
          <div className="inv-pager">
            <button className="icon-btn" disabled={page <= 1} onClick={() => setCursors((c) => c.slice(0, -1))} aria-label={t("Previous page")}>
              <Icon name="chevron-small-left" size={20} />
            </button>
            <span>{t("Page {n}", { n: page })}</span>
            <button className="icon-btn" disabled={!q.data?.next} onClick={() => q.data?.next && setCursors((c) => [...c, q.data!.next!])} aria-label={t("Next page")}>
              <Icon name="chevron-small-right" size={20} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
