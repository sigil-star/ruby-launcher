import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { purchaseInfo, purchaseItem } from "../lib/api";
import { PASS_PAGE, buyRoundUp, isRoundUp, roundUpOffer, roundUpOffered } from "../lib/support";
import { win } from "../lib/ipc";
import { useMe, useSession, useUi } from "../app/store";
import { Icon, Robux, Spinner, Thumb, interp } from "./ui";
import { t } from "../lib/i18n";

/** Roblox-style "Buy Item" confirmation. Presentational; the caller does the purchase. */
function PurchaseDialogInner({
  title,
  thumb,
  price,
  sellerName,
  onConfirm,
  onClose,
  roundUp = true,
}: {
  title: string;
  thumb: ReactNode;
  price: number;
  sellerName?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  /** Offer to round the total up to the next 10 Robux for Ruby (off for Ruby's own passes). */
  roundUp?: boolean;
}) {
  const me = useMe();
  const { toast } = useUi();
  const { refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [round, setRound] = useState(false);
  const balance = me.robux ?? 0;
  const free = price === 0;
  const offer = useQuery({
    queryKey: ["roundUpOffer", price, me.id],
    queryFn: () => roundUpOffer(price, me.id),
    enabled: roundUp && !free && roundUpOffered(),
    staleTime: 30_000,
    retry: false,
  });
  const plan = isRoundUp(offer.data) ? offer.data : null;
  const none = offer.data && !isRoundUp(offer.data) ? offer.data : null;
  const extra = round && plan ? plan.extra : 0;
  const short = price + extra - balance;

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      if (extra && plan) {
        try {
          const { paid, stuck } = await buyRoundUp(plan, me.id);
          toast(
            stuck.length
              ? t("Thanks for rounding up! {n} Robux went to Ruby. To round up again later, delete the \"Round Up\" passes from your inventory on roblox.com.", { n: paid })
              : t("Thanks for rounding up! {n} Robux went to Ruby.", { n: paid }),
          );
        } catch (e) {
          toast(e instanceof Error ? t("Bought, but the round-up didn't go through: {error}", { error: e.message }) : t("Bought, but the round-up didn't go through."), "error");
        }
        await refresh().catch(() => undefined);
      }
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("Purchase failed.");
      setError(/challenge|verif/i.test(msg) ? t("Roblox needs extra verification for this purchase. Complete it on roblox.com, then try again.") : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={busy ? undefined : onClose}>
      <div className="buy-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="buy-head">
          <h2>{free ? t("Get Item") : t("Buy Item")}</h2>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label={t("Close")}>
            <Icon name="x-small" size={20} />
          </button>
        </div>
        <div className="buy-body">
          <div className="buy-thumb">{thumb}</div>
          <div className="buy-text">
            {free ? (
              interp(sellerName ? t("Would you like to get {item} from {seller} for free?") : t("Would you like to get {item} for free?"), { item: <b>{title}</b>, seller: sellerName })
            ) : (
              interp(sellerName ? t("Would you like to buy {item} from {seller} for {price}?") : t("Would you like to buy {item} for {price}?"), {
                item: <b>{title}</b>,
                seller: sellerName,
                price: <Robux amount={price} size={14} />,
              })
            )}
          </div>
        </div>
        {plan ? (
          <label className="buy-roundup">
            <input type="checkbox" checked={round} disabled={busy} onChange={(e) => setRound(e.target.checked)} />
            {(price + plan.extra) % 10 === 0 ? (
              <span>
                {interp(t("Round up to {total} and give the extra {extra} to Ruby"), { total: <Robux amount={price + plan.extra} size={13} />, extra: <Robux amount={plan.extra} size={13} /> })}
              </span>
            ) : (
              <span>
                {interp(t("Add {extra} to support Ruby ({total} in total)"), { total: <Robux amount={price + plan.extra} size={13} />, extra: <Robux amount={plan.extra} size={13} /> })}
              </span>
            )}
          </label>
        ) : none?.reason === "creator" ? (
          <div className="buy-roundup off muted small">{t("No round-up offer for you: you own Ruby Crystal, so Roblox counts its Round Up passes as already yours. Other players see it here.")}</div>
        ) : none?.reason === "owned" ? (
          <div className="buy-roundup off muted small">
            {interp(
              none.owned.length === 1
                ? t("Round-up is paused: you still own Ruby's Round Up pass. {link} on roblox.com to round up again.")
                : t("Round-up is paused: you still own Ruby's Round Up passes. {link} on roblox.com to round up again."),
              {
                link: (
                  <button className="link" onClick={() => void win.openExternal(PASS_PAGE(none.owned[0]))}>
                    {none.owned.length === 1 ? t("Delete it from your inventory") : t("Delete them from your inventory")}
                  </button>
                ),
              },
            )}
          </div>
        ) : null}
        {!free && short > 0 ? (
          <div className="buy-short">
            {interp(t("You need {short} more to buy this. Your balance is {balance}."), { short: <Robux amount={short} size={13} />, balance: <Robux amount={balance} size={13} /> })}
          </div>
        ) : null}
        {error ? <div className="error-text buy-error">{error}</div> : null}
        <div className="buy-actions">
          {!free && short > 0 ? (
            <button className="btn btn-primary btn-block" onClick={() => (onClose(), win.showRobloxPage("https://www.roblox.com/upgrades/robux", t("Buy Robux")))}>
              {t("Get Robux")}
            </button>
          ) : (
            <button className="btn btn-primary btn-block" onClick={confirm} disabled={busy}>
              {busy ? <Spinner size={18} /> : free ? t("Get") : t("Buy Now")}
            </button>
          )}
          <button className="btn btn-secondary btn-block" onClick={onClose} disabled={busy}>
            {t("Cancel")}
          </button>
        </div>
        {!free ? (
          <div className="buy-balance muted small">
            {interp(t("Balance after purchase: {balance}"), { balance: <Robux amount={Math.max(0, balance - price - extra)} size={12} /> })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Buy a catalog item (asset or bundle), resolving all purchase data first. */
function BuyItemModalInner({ itemType, id, onClose }: { itemType: "Asset" | "Bundle"; id: number; onClose: () => void }) {
  const me = useMe();
  const { refresh } = useSession();
  const { toast } = useUi();
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ["purchaseInfo", itemType, id], queryFn: () => purchaseInfo(itemType, id, me.id) });

  if (info.isLoading || !info.data) {
    return (
      <div className="modal-scrim" onClick={onClose}>
        <div className="buy-dialog center-fill">{info.error ? <p className="error-text">{(info.error as Error).message}</p> : <Spinner />}</div>
      </div>
    );
  }
  const d = info.data;
  return (
    <PurchaseDialog
      title={d.name}
      sellerName={d.sellerName}
      price={d.price ?? 0}
      thumb={<Thumb type={itemType === "Bundle" ? "BundleThumbnail" : "Asset"} id={id} size="150x150" className="square" />}
      onClose={onClose}
      onConfirm={async () => {
        await purchaseItem(d, me.id);
        toast(t("You now own {name}.", { name: d.name }));
        await refresh();
        qc.invalidateQueries({ queryKey: ["purchaseInfo", itemType, id] });
        qc.invalidateQueries({ queryKey: ["inventory"] });
      }}
    />
  );
}

/*
 * Purchase dialogs render into <body> so they always sit centred over the whole window, even
 * when opened from inside a panel that creates its own positioning context (the avatar preview).
 */
export function PurchaseDialog(props: ComponentProps<typeof PurchaseDialogInner>) {
  return createPortal(<PurchaseDialogInner {...props} />, document.body);
}

export function BuyItemModal(props: ComponentProps<typeof BuyItemModalInner>) {
  return createPortal(<BuyItemModalInner {...props} />, document.body);
}
