import { loadNotifyPrefs, saveNotifyPrefs, type NotifyPrefs } from "../app/DesktopNotify";
import { call } from "../lib/ipc";
import { useState, type ReactNode } from "react";
import { win } from "../lib/ipc";
import { AGE_CHECK_URL, BAND_LABEL, PARENTAL_URL, TIER_LABEL, useAccountType } from "../lib/accountType";
import { useMe } from "../app/store";
import { useQuery } from "@tanstack/react-query";
import { profileHeader } from "../lib/social";
import { Icon } from "./ui";
import { fmtDate, t } from "../lib/i18n";

/**
 * Shown instead of a feature this account can't use (chat without an age check, chat on
 * Roblox Kids, trading under 13), with the fix and a way to continue anyway.
 */
export function AccountGate({ feature, children }: { feature: "chat" | "trade"; children: ReactNode }) {
  const acct = useAccountType();
  const [anyway, setAnyway] = useState(false);
  const a = acct.data;
  if (!a || anyway) return <>{children}</>;
  let title = "";
  let body = "";
  let fix: { label: string; url: string } | null = null;
  if (feature === "chat" && a.tier === "kids") {
    title = t("Chat is off on Roblox Kids accounts");
    body = t("Roblox turns chat off for players under 9. A parent can allow in-game chat from a linked account after an age check.");
    fix = { label: t("Parental controls"), url: PARENTAL_URL };
  } else if (feature === "chat" && !a.checked) {
    title = t("Chat needs an age check");
    body = t("Roblox requires a quick age check (a face estimate or ID) before you can chat. It's done once, in the Roblox app or on roblox.com.");
    fix = { label: t("Do the age check"), url: AGE_CHECK_URL };
  } else if (feature === "trade" && !a.canTrade) {
    title = t("Trading isn't available on this account");
    body = t("Roblox only allows trading for players 13 and over.");
  } else {
    return <>{children}</>;
  }
  return (
    <div className="page acct-gate">
      <Icon name="lock" size={34} />
      <h2>{title}</h2>
      <p className="muted">{body}</p>
      <div className="acct-gate-actions">
        {fix ? (
          <button className="btn btn-primary" onClick={() => win.showRobloxPage(fix!.url, fix!.label)}>
            {fix.label}
          </button>
        ) : null}
        <button className="btn btn-secondary" onClick={() => setAnyway(true)}>
          {t("Continue anyway")}
        </button>
      </div>
    </div>
  );
}

/** Settings card: what kind of account this is and what that means in Ruby. */
export function AccountTypeCard() {
  const me = useMe();
  const acct = useAccountType();
  const plus = useQuery({ queryKey: ["profileHeader", me.id], queryFn: () => profileHeader(me.id!), enabled: !!me.id, staleTime: 10 * 60_000, select: (h) => h.isRobloxPlus });
  const a = acct.data;
  const row = (label: string, value: ReactNode, action?: ReactNode) => (
    <div className="dp-row">
      <div>
        <b>{label}</b>
        <div className="muted small">{value}</div>
      </div>
      {action}
    </div>
  );
  return (
    <>
      <h3 className="acct-h3">{t("Account type")}</h3>
      <div className="discord-prefs">
        {row(t("Type"), a ? TIER_LABEL[a.tier] : t("Checking…"))}
        {row(
          t("Age check"),
          a ? (a.checked ? t("Done · {band}", { band: BAND_LABEL[a.band] }) : a.deadline ? t("Needed by {date}", { date: fmtDate(new Date(a.deadline)) }) : t("Not done. Chat stays off until it is.")) : t("Checking…"),
          a && !a.checked ? (
            <button className="btn btn-secondary btn-small" onClick={() => win.showRobloxPage(AGE_CHECK_URL, t("Age check"))}>
              {t("Age check")}
            </button>
          ) : null,
        )}
        {row("Roblox Plus", plus.data == null ? t("Checking…") : plus.data ? t("Active") : t("Not subscribed"))}
        {row(t("Country"), a?.country ?? "—")}
        {a && a.tier !== "standard" ? (
          row(
            t("Parental controls"),
            t("Some features follow a parent's settings on this account."),
            <button className="btn btn-secondary btn-small" onClick={() => win.showRobloxPage(PARENTAL_URL, t("Parental controls"))}>
              {t("Open")}
            </button>,
          )
        ) : null}
      </div>
    </>
  );
}

/** Settings: Ruby's own desktop notifications. */
export function NotificationPrefs() {
  const [p, setP] = useState(loadNotifyPrefs);
  const set = (patch: Partial<NotifyPrefs>) => {
    const next = { ...p, ...patch };
    setP(next);
    saveNotifyPrefs(next);
  };
  const row = (k: keyof NotifyPrefs, label: string, hint: string, disabled = false) => (
    <div className="dp-row">
      <div>
        <b>{label}</b>
        <div className="muted small">{hint}</div>
      </div>
      <input type="checkbox" className="switch" aria-label={label} checked={p[k]} disabled={disabled} onChange={(e) => set({ [k]: e.target.checked } as Partial<NotifyPrefs>)} />
    </div>
  );
  return (
    <>
      <h3 className="acct-h3">{t("Desktop notifications")}</h3>
      <div className="discord-prefs">
        {row("enabled", t("Show notifications"), t("Small cards in the bottom-right corner when Ruby isn't in front, or while you're in a game."))}
        {row("favoritesOnly", t("Only favorite friends"), t("Game and online alerts only for friends you've starred (on their profile)."), !p.enabled)}
        {row("friendGame", t("Friend joins a game"), t("With a Join button."), !p.enabled)}
        {row("friendOnline", t("Friend comes online"), "", !p.enabled)}
        {row("requests", t("Friend requests"), "", !p.enabled)}
        {row("messages", t("Chat messages"), "", !p.enabled)}
        <div className="dp-row">
          <div>
            <b>{t("Preview")}</b>
            <div className="muted small">{t("Shows a sample card now.")}</div>
          </div>
          <button className="btn btn-secondary btn-small" onClick={() => void call("toastPush", { id: `test-${Date.now()}`, kind: "message", title: "Ruby", body: t("This is how notifications look."), actionLabel: t("Open") })}>
            {t("Test")}
          </button>
        </div>
      </div>
    </>
  );
}
