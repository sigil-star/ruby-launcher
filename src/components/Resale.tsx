import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { buyResale, resellers, type Resale } from "../lib/extras";
import { noteBought } from "../lib/bought";
import { win } from "../lib/ipc";
import { useMe, useNav, useUi } from "../app/store";
import { Headshot, Robux, Skel, Spinner } from "./ui";
import { t } from "../lib/i18n";

type Item = { id: number; name: string; itemType: "Asset" | "Bundle"; itemRestrictions?: string[]; collectibleItemId?: string | null; productId?: number | null };

export const isLimited = (d: Item) => (d.itemRestrictions ?? []).some((r) => /limited|collectible/i.test(r));

/** Resellers for a Limited (cheapest first) with Buy, plus listing your own copy on Roblox's page. */
export function ResaleSection({ item }: { item: Item }) {
  const me = useMe();
  const qc = useQueryClient();
  const { toast } = useUi();
  const { go } = useNav();
  const [confirm, setConfirm] = useState<Resale | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const list = useQuery({ queryKey: ["resellers", item.id], queryFn: () => resellers({ assetId: item.id, collectibleItemId: item.collectibleItemId }), staleTime: 30_000, retry: false });
  const robuxPage = `https://www.roblox.com/catalog/${item.id}`;

  const buy = async () => {
    if (!confirm || !me.id) return;
    setBusy(true);
    try {
      await buyResale(confirm, item, me.id);
      if (item.itemType === "Asset") noteBought(item.id);
      toast(t("You bought {name}.", { name: item.name }));
      qc.invalidateQueries({ queryKey: ["resellers", item.id] });
      qc.invalidateQueries({ queryKey: ["robux"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      setConfirm(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="shelf resale">
      <div className="resale-head">
        <h2 className="sub-title">{t("Resellers")}</h2>
        <span style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-small" onClick={() => win.showRobloxPage(robuxPage, t("Sell {name}", { name: item.name }))} title={t("List your copy for sale on Roblox's item page")}>
          {t("Sell")}
        </button>
      </div>
      {list.isLoading ? (
        <Skel h={160} r={12} />
      ) : list.error ? (
        <div className="muted small">{t("Couldn't load resellers.")}</div>
      ) : !list.data?.length ? (
        <div className="muted small">{t("No one is selling this right now.")}</div>
      ) : (
        <div className="resale-list">
          {(showAll ? list.data : list.data.slice(0, 10)).map((r) => (
            <div key={r.key} className="resale-row">
              <button className="resale-seller" onClick={() => go({ name: "profile", userId: r.sellerId })}>
                <Headshot userId={r.sellerId} size={36} />
                <span className="ellipsis">{r.sellerName || t("User {id}", { id: r.sellerId })}</span>
              </button>
              <span className="muted small">{r.serial ? `#${r.serial}` : ""}</span>
              <Robux amount={r.price} size={14} />
              <button
                className={`btn btn-small ${r.price > (me.robux ?? 0) && r.sellerId !== me.id ? "btn-secondary" : "btn-primary"}`}
                disabled={r.sellerId === me.id}
                title={r.price > (me.robux ?? 0) ? t("You need {n} more Robux", { n: r.price - (me.robux ?? 0) }) : undefined}
                onClick={() => setConfirm(r)}
              >
                {r.sellerId === me.id ? t("Yours") : t("Buy")}
              </button>
            </div>
          ))}
          {!showAll && list.data.length > 10 ? (
            <button className="btn btn-secondary btn-small" onClick={() => setShowAll(true)}>
              {t("Show all {n} sellers", { n: list.data.length })}
            </button>
          ) : null}
        </div>
      )}
      {confirm ? (
        <div className="modal-scrim" onClick={() => !busy && setConfirm(null)}>
          <div className="buy-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("Buy from reseller")}>
            <div className="buy-head">
              <h2>{t("Buy Item")}</h2>
            </div>
            <div>
              {t("Would you like to buy")} <b>{item.name}</b>
              {confirm.serial ? ` #${confirm.serial}` : ""} {t("from {seller} for", { seller: confirm.sellerName || t("this seller") })} <Robux amount={confirm.price} size={14} />?
            </div>
            {confirm.price > (me.robux ?? 0) ? (
              <div className="buy-short">
                {t("You need")} <Robux amount={confirm.price - (me.robux ?? 0)} size={13} /> {t("more to buy this. Your balance is")} <Robux amount={me.robux ?? 0} size={13} />.
              </div>
            ) : null}
            <div className="buy-actions">
              {confirm.price > (me.robux ?? 0) ? (
                <button className="btn btn-primary btn-block" onClick={() => (setConfirm(null), win.showRobloxPage("https://www.roblox.com/upgrades/robux", t("Buy Robux")))}>
                  {t("Get Robux")}
                </button>
              ) : (
                <button className="btn btn-primary btn-block" onClick={buy} disabled={busy}>
                  {busy ? <Spinner size={18} /> : t("Buy Now")}
                </button>
              )}
              <button className="btn btn-secondary btn-block" onClick={() => setConfirm(null)} disabled={busy}>
                {t("Cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
