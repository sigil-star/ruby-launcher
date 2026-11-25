import { askConfirm } from "./Confirm";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { accountModeration, reactivateAccount, timeLeft, voiceStatus } from "../lib/moderation";
import { longDate } from "../lib/format";
import { win } from "../lib/ipc";
import { useUi } from "../app/store";
import { Icon } from "./ui";
import { fmtDate, t } from "../lib/i18n";

/** Account bans/warnings and voice chat suspensions, shown above every page while they last. */
export function ModerationBanner() {
  const qc = useQueryClient();
  const { toast } = useUi();
  const acct = useQuery({ queryKey: ["accountModeration"], queryFn: accountModeration, refetchInterval: 5 * 60_000, staleTime: 60_000, retry: 1 });
  const voice = useQuery({ queryKey: ["voiceStatus"], queryFn: voiceStatus, refetchInterval: 5 * 60_000, staleTime: 60_000, retry: 1 });
  const [hideVoice, setHideVoice] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const a = acct.data;
  const v = voice.data;

  const reactivate = async () => {
    if (!await askConfirm(t("Agree to Roblox's Community Standards and reactivate your account?"))) return;
    setBusy(true);
    try {
      await reactivateAccount();
      toast(t("Your account is active again."));
      qc.invalidateQueries({ queryKey: ["accountModeration"] });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {a ? (
        <div className={`mod-banner ${a.kind}`}>
          <Icon name="triangle-exclamation" size={22} />
          <div className="mod-text">
            <b>
              {a.kind === "warning" ? t("Your account received a warning") : a.kind === "deleted" ? t("Your account has been deleted") : t("Your account is banned ({label})", { label: a.label })}
            </b>
            <span className="small">
              {a.end && a.kind === "ban" ? (Date.parse(a.end) > Date.now() ? t("Ends in {time} · {date}", { time: timeLeft(a.end), date: longDate(a.end) }) : t("This ban has ended.")) : a.begin ? t("Since {date}", { date: longDate(a.begin) }) : null}
            </span>
            {open ? (
              <div className="mod-details">
                {a.message ? <p>“{a.message}”</p> : null}
                {a.reasons.map((r, i) => (
                  <div key={i} className="mod-reason">
                    <span className="tiny muted">{r.type}</span>
                    {r.text ? <span className="small">{r.text}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="mod-actions">
            <button className="btn btn-secondary btn-small" onClick={() => setOpen((o) => !o)}>
              {open ? t("Hide details") : t("Details")}
            </button>
            <button className="btn btn-secondary btn-small" onClick={() => win.showRobloxPage("https://www.roblox.com/report-appeals", t("Appeals"))}>
              {t("Appeal")}
            </button>
            {a.canReactivate ? (
              <button className="btn btn-primary btn-small" disabled={busy} onClick={reactivate}>
                {t("I agree")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {v?.banned && !hideVoice ? (
        <div className="mod-banner voice">
          <Icon name="speaker-x" size={20} />
          <div className="mod-text">
            <b>{t("Voice chat is suspended")}</b>
            <span className="small">{v.bannedUntil ? t("You can use voice again in {time} ({date}).", { time: timeLeft(v.bannedUntil), date: fmtDate(v.bannedUntil, { dateStyle: "medium", timeStyle: "short" }) }) : t("Roblox turned off voice chat for this account.")}</span>
          </div>
          <div className="mod-actions">
            <button className="btn btn-secondary btn-small" onClick={() => win.showRobloxPage("https://www.roblox.com/report-appeals", t("Appeals"))}>
              {t("Appeal")}
            </button>
            <button className="icon-btn" aria-label={t("Dismiss")} onClick={() => setHideVoice(true)}>
              <Icon name="x-small" size={16} />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
