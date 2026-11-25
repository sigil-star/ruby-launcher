import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createPortal } from "react-dom";
import { askParentForTransfer, sendRobux, transferLimit } from "../lib/transfer";
import { profileHeader } from "../lib/social";
import { win } from "../lib/ipc";
import { useMe, useSession, useUi } from "../app/store";
import { Headshot, Icon, Robux, Spinner, interp } from "./ui";
import { t, fmtNum } from "../lib/i18n";

const QUICK = [10, 50, 100, 500, 1000];

type Props = { userId: number; displayName: string; name: string; onClose: () => void };

/** Send Robux to someone, the way Roblox Plus members can on roblox.com. Two steps: amount, then confirm. */
function SendRobuxInner({ userId, displayName, name, onClose }: Props) {
  const me = useMe();
  const { refresh } = useSession();
  const { toast } = useUi();
  const qc = useQueryClient();
  const plus = useQuery({ queryKey: ["profileHeader", me.id], queryFn: () => profileHeader(me.id), staleTime: 10 * 60_000 });
  const limit = useQuery({ queryKey: ["transferLimit"], queryFn: transferLimit, staleTime: 60_000, retry: false, enabled: plus.data?.isRobloxPlus === true });
  const [amount, setAmount] = useState(0);
  const [step, setStep] = useState<"amount" | "confirm" | "parent" | "done">("amount");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [transferId, setTransferId] = useState("");
  const balance = me.robux ?? 0;
  const max = Math.min(balance, limit.data?.perTransferLimit ?? balance);
  const valid = amount >= 1 && amount <= max;

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await sendRobux(userId, amount);
      if (r.ok) {
        setStep("done");
        toast(t("Sent {n} Robux to {name}.", { n: amount, name: displayName }));
        await refresh().catch(() => undefined);
        qc.invalidateQueries({ queryKey: ["transferLimit"] });
      } else if (r.parentConsent) {
        setTransferId(r.transferId);
        setStep("parent");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const askParent = async () => {
    setBusy(true);
    setError("");
    try {
      await askParentForTransfer(transferId, amount);
      toast(t("Asked your parent. The Robux are sent once they approve."));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const tooMuch = amount > balance ? t("That's more than you have.") : amount > max ? t("That's over your transfer limit.") : "";

  return (
    <div className="modal-scrim" onClick={busy ? undefined : onClose}>
      <div className="buy-dialog send-robux" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("Send Robux")}>
        <div className="buy-head">
          <h2>{t("Send Robux")}</h2>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label={t("Close")}>
            <Icon name="x-small" size={20} />
          </button>
        </div>
        <div className="send-robux-to">
          <Headshot userId={userId} size={44} />
          <span className="send-robux-name">
            <b className="ellipsis">{displayName}</b>
            <span className="muted small">@{name}</span>
          </span>
          <span className="muted small send-robux-bal">
            {interp(t("You have {balance}"), { balance: <Robux amount={balance} size={12} /> })}
          </span>
        </div>

        {plus.isLoading ? (
          <Spinner />
        ) : plus.data?.isRobloxPlus !== true ? (
          <>
            <p className="small">{t("Roblox only lets Roblox Plus members send Robux to other people.")}</p>
            <div className="buy-actions">
              <button className="btn btn-primary btn-block" onClick={() => (onClose(), win.showRobloxPage("https://www.roblox.com/premium/membership", "Roblox Plus"))}>
                {t("See Roblox Plus")}
              </button>
            </div>
          </>
        ) : step === "amount" ? (
          <>
            <label className="send-robux-input">
              <Icon name="robux" size={22} />
              <input
                type="number"
                min={1}
                max={max}
                inputMode="numeric"
                placeholder="0"
                value={amount || ""}
                autoFocus
                onChange={(e) => setAmount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              />
            </label>
            <div className="send-robux-quick">
              {QUICK.map((q) => (
                <button key={q} className={`chip ${amount === q ? "on" : ""}`} disabled={q > max} onClick={() => setAmount(q)}>
                  {fmtNum(q)}
                </button>
              ))}
            </div>
            <p className="muted small">
              {limit.data?.perTransferLimit ? t("Up to {n} per transfer.", { n: limit.data.perTransferLimit }) + " " : ""}
              {tooMuch}
            </p>
            <div className="buy-actions">
              <button className="btn btn-primary btn-block" disabled={!valid} onClick={() => setStep("confirm")}>
                {t("Continue")}
              </button>
              <button className="btn btn-secondary btn-block" onClick={onClose}>
                {t("Cancel")}
              </button>
            </div>
          </>
        ) : step === "confirm" ? (
          <>
            <p>
              {interp(t("Send {amount} to {name}? Once sent, Roblox can't take it back."), { amount: <Robux amount={amount} size={14} />, name: <b>{displayName}</b> })}
            </p>
            <p className="muted small">{t("Your balance after: {n}. Roblox may ask you to verify it's you.", { n: balance - amount })}</p>
            {error ? <div className="error-text">{error}</div> : null}
            <div className="buy-actions">
              <button className="btn btn-primary btn-block" disabled={busy} onClick={send}>
                {busy ? <Spinner size={18} /> : t("Send {n} Robux", { n: amount })}
              </button>
              <button className="btn btn-secondary btn-block" disabled={busy} onClick={() => setStep("amount")}>
                {t("Change amount")}
              </button>
            </div>
          </>
        ) : step === "parent" ? (
          <>
            <p>{t("Your account needs a parent's OK to send Robux. Ruby can ask them for you; nothing is sent until they approve.")}</p>
            {error ? <div className="error-text">{error}</div> : null}
            <div className="buy-actions">
              <button className="btn btn-primary btn-block" disabled={busy} onClick={askParent}>
                {busy ? <Spinner size={18} /> : t("Ask my parent")}
              </button>
              <button className="btn btn-secondary btn-block" disabled={busy} onClick={onClose}>
                {t("Not now")}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              {interp(t("Sent {amount} to {name}."), { amount: <Robux amount={amount} size={14} />, name: <b>{displayName}</b> })}
            </p>
            <div className="buy-actions">
              <button className="btn btn-primary btn-block" onClick={onClose}>
                {t("Done")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function SendRobuxDialog(props: Props) {
  return createPortal(<SendRobuxInner {...props} />, document.body);
}
