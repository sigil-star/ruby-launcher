import { AppBackground } from "../components/AppBackground";
import { usePluginPages } from "../lib/plugins";
import { kindOf, setPresenceMap, type PresenceKind } from "../lib/presenceMap";
import { friends as fetchFriends } from "../lib/api";
import { DesktopNotifyWatcher } from "./DesktopNotify";
import { TrayStatus } from "./TrayStatus";
import { ConfirmHost } from "../components/Confirm";
import { useChatDot } from "./useChatDot";
import { setPref, streamerMode } from "../lib/appearance";
import { profileHeader } from "../lib/social";
import { ChallengeHost } from "../components/Challenge";
import { FocusMode } from "../components/FocusMode";
import { compact } from "../lib/format";
import { UpdateBanner } from "../components/UpdateBanner";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ModerationBanner } from "../components/ModerationBanner";
import { tradeCount } from "../lib/trades";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { friendRequestCount, session, unreadNotifications } from "../lib/api";
import { call, rbx, win } from "../lib/ipc";
import { Headshot, Icon, Robux, Verified, type IconName } from "../components/ui";
import { NotificationsPanel } from "../components/Notifications";
import { LaunchCard } from "../components/LaunchCard";
import { RowArrows } from "../components/RowArrows";
import { useSuppressEmbed } from "../components/WebEmbed";
import { SwitchAccountsModal } from "../pages/Settings";
import { useMe, useNav, useUi, type Route } from "./store";
import { fmtNum, t } from "../lib/i18n";

function WindowControls() {
  return (
    <div className="win-controls">
      <button aria-label={t("Minimize")} onClick={() => win.minimize()}>
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" /></svg>
      </button>
      <button aria-label={t("Maximize")} onClick={() => win.maximize()}>
        <svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" /></svg>
      </button>
      <button aria-label={t("Close")} className="close" onClick={() => win.close()}>
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" /></svg>
      </button>
    </div>
  );
}

function SearchBox() {
  const { go, route } = useNav();
  const [q, setQ] = useState(route.name === "search" ? route.q : "");
  useEffect(() => {
    if (route.name !== "search") setQ("");
  }, [route.name]);
  return (
    <form
      className="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) go({ name: "search", q: q.trim() });
      }}
    >
      <Icon name="magnifying-glass" size={18} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search")} spellCheck={false} />
    </form>
  );
}

function Topbar({ center, showSearch }: { center?: ReactNode; showSearch: boolean }) {
  const me = useMe();
  const plus = useQuery({ queryKey: ["profileHeader", me.id], queryFn: () => profileHeader(me.id!), enabled: !!me.id, staleTime: 10 * 60_000, select: (h) => h.isRobloxPlus });
  const { route, go, back, canBack } = useNav();
  const [notifOpen, setNotifOpen] = useState(false);
  // "Notifications" in the tray menu opens the bell.
  useEffect(() => {
    const open = () => setNotifOpen(true);
    window.addEventListener("ruby:open-notifications", open);
    return () => window.removeEventListener("ruby:open-notifications", open);
  }, []);
  // The bell counts unread notifications (like the app); friend requests are badged on Friends.
  const { data: unread = 0 } = useQuery({ queryKey: ["notifUnread"], queryFn: unreadNotifications, refetchInterval: 45_000 });
  const isHome = route.name === "home";
  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="topbar-left" data-tauri-drag-region>
        {showSearch && isHome ? (
          <span className="wordmark" data-tauri-drag-region>RUBY</span>
        ) : canBack && showSearch ? (
          <button className="icon-btn" onClick={back} aria-label={t("Back")}>
            <Icon name="arrow-large-left" size={20} />
          </button>
        ) : null}
      </div>
      <div className="topbar-center" data-tauri-drag-region>
        {center ?? (showSearch ? <SearchBox /> : null)}
      </div>
      <div className="topbar-right">
        {showSearch ? (
          <>
            <button className="me-chip" onClick={() => go({ name: "profile", userId: me.id })}>
              <Headshot userId={me.id} size={32} />
              <span className="me-name pii">{me.displayName}</span>
              {me.hasVerifiedBadge ? <Verified size={14} /> : null}
              {plus.data ? (
                <span className="name-badge plus" title="Roblox Plus">
                  <Icon name="roblox-plus" size={16} />
                </span>
              ) : null}
            </button>
            <button className="robux-chip" title={t("{n} Robux", { n: me.robux ?? 0 })} onClick={() => go({ name: "robux" })}>
              <Icon name="robux" size={20} />
              <span className="pii">{(me.robux ?? 0) >= 100_000 ? compact(me.robux ?? 0) : fmtNum(me.robux ?? 0)}</span>
            </button>
            <div className="notif-anchor">
              <button className="icon-btn badge-host" aria-label={t("Notifications")} onClick={() => setNotifOpen((o) => !o)}>
                <Icon name="bell" size={22} />
                {unread > 0 && !notifOpen ? <span className="count-badge">{unread > 99 ? "99+" : unread}</span> : null}
              </button>
              {notifOpen ? <NotificationsPanel onClose={() => setNotifOpen(false)} /> : null}
            </div>
          </>
        ) : null}
        <WindowControls />
      </div>
    </header>
  );
}

function RailButton({ icon, label, active, onClick, dot, children }: { icon?: IconName; label: string; active: boolean; onClick: () => void; dot?: boolean; children?: ReactNode }) {
  return (
    <button className={`rail-btn badge-host ${active ? "active" : ""}`} onClick={onClick} aria-label={dot ? t("{label} (unread)", { label }) : undefined}>
      {children ?? <Icon name={icon!} size={24} />}
      {dot ? <span className="dot-badge rail-dot" /> : null}
      <span>{label}</span>
    </button>
  );
}

function Drawer({ open, onClose, onSwitchAccounts, newRequests = 0 }: { open: boolean; onClose: () => void; onSwitchAccounts: () => void; newRequests?: number }) {
  useSuppressEmbed(open);
  const me = useMe();
  const { go } = useNav();
  const { data: trades = 0 } = useQuery({ queryKey: ["tradeCount"], queryFn: () => tradeCount(), staleTime: 60_000, retry: false });
  const { data: inbox = 0 } = useQuery({
    queryKey: ["inboxUnread"],
    queryFn: () => rbx<{ count: number }>("https://privatemessages.roblox.com/v1/messages/unread/count").then((r) => r.count ?? 0),
    staleTime: 60_000,
    retry: false,
  });
  const nav = (r: Route) => {
    go(r);
    onClose();
  };
  const ext = (url: string) => {
    win.openExternal(url);
    onClose();
  };
  const items: { icon: IconName; label: string; onClick: () => void; badge?: number; external?: boolean }[] = [
    { icon: "star", label: t("Favorites"), onClick: () => nav({ name: "list", kind: "favorites" }) },
    { icon: "clock", label: t("Continue Playing"), onClick: () => nav({ name: "list", kind: "continue" }) },
    { icon: "two-people", label: t("Friends"), onClick: () => nav({ name: "friends" }), badge: newRequests },
    { icon: "two-folders", label: t("Communities"), onClick: () => nav({ name: "communities" }) },
    { icon: "backpack", label: t("Inventory"), onClick: () => nav({ name: "inventory" }) },
    { icon: "two-arrows-left-right", label: t("Trades"), onClick: () => nav({ name: "trades" }), badge: trades },
    { icon: "envelope", label: t("Inbox"), onClick: () => nav({ name: "inbox" }), badge: inbox },
    { icon: "squares-grid-qr", label: t("Captures"), onClick: () => nav({ name: "captures" }) },
    { icon: "roblox-plus", label: "Roblox Plus", onClick: () => nav({ name: "web", url: "https://www.roblox.com/plus", title: "Roblox Plus" }) },
    { icon: "gear", label: t("Ruby Settings"), onClick: () => nav({ name: "rubySettings" }) },
    { icon: "person", label: t("Account Settings"), onClick: () => nav({ name: "settings" }) },
    { icon: "puzzle", label: t("Plugins"), onClick: () => nav({ name: "plugins" }) },
    { icon: "circle-i", label: t("Help & Safety"), onClick: () => nav({ name: "help" }) },
  ];
  return (
    <>
      <div className={`scrim ${open ? "open" : ""}`} onClick={onClose} />
      <aside className={`drawer ${open ? "open" : ""}`} aria-hidden={!open}>
        <button className="drawer-profile" onClick={() => nav({ name: "profile", userId: me.id })}>
          <Headshot userId={me.id} size={64} />
          <div>
            <div className="drawer-name">
              {me.displayName} {me.hasVerifiedBadge ? <Verified size={14} /> : null}
            </div>
            <div className="muted pii">@{me.name}</div>
          </div>
        </button>
        <div className="drawer-robux">
          <span className="pii">
            <Robux amount={me.robux ?? 0} size={20} />
          </span>
          <button className="btn btn-small btn-secondary" onClick={() => nav({ name: "robux" })}>
            {t("Buy Robux")}
          </button>
        </div>
        <nav className="drawer-list">
          {items.map((it) => (
            <button key={it.label} className="drawer-item" onClick={it.onClick}>
              <Icon name={it.icon} size={22} />
              <span>{it.label}</span>
              {it.badge ? <span className="pill-badge">{it.badge > 99 ? "99+" : it.badge}</span> : null}
            </button>
          ))}
        </nav>
        <div className="drawer-sep" />
        <nav className="drawer-list">
          <button className="drawer-item" onClick={() => nav({ name: "create" })}>
            <Icon name="studio" size={22} />
            <span>{t("Create")}</span>
          </button>
        </nav>
        <div className="drawer-actions">
          <button
            className="btn btn-secondary btn-block"
            onClick={() => {
              onClose();
              onSwitchAccounts();
            }}
          >
            {t("Switch Accounts")}
          </button>
          <button
            className="btn btn-secondary btn-block"
            onClick={() => {
              onClose();
              session.signOut();
            }}
          >
            {t("Log Out")}
          </button>
        </div>
        <div className="drawer-legal">
          <button className="link" onClick={() => ext("https://en.help.roblox.com/hc/articles/115004647846")}>
            {t("Terms")}
          </button>
          <button className="link" onClick={() => ext("https://www.roblox.com/info/privacy")}>
            {t("Privacy")}
          </button>
        </div>
      </aside>
    </>
  );
}

function LaunchOverlay() {
  return <LaunchCard />;
}

function Toasts() {
  const { toasts } = useUi();
  return (
    <div className="toasts">
      {toasts.map((x) => (
        <div key={x.id} className={`toast ${x.kind}`}>
          {x.text}
        </div>
      ))}
    </div>
  );
}

/** Keeps the shared presence map current: friends from the friends list, you from your session. */
function PresenceSync() {
  const me = useMe();
  const { playing } = useUi();
  const fr = useQuery({ queryKey: ["friends", me.id], queryFn: () => fetchFriends(me.id), refetchInterval: 45_000, enabled: !!me.id });
  useEffect(() => {
    const m = new Map<number, PresenceKind>();
    for (const f of fr.data ?? []) m.set(f.id, kindOf(f.presence?.userPresenceType));
    if (me.id) m.set(me.id, playing ? "ingame" : "online");
    setPresenceMap(m);
  }, [fr.data, me.id, playing]);
  return null;
}

export function Shell({ children }: { children: ReactNode }) {
  const me = useMe();
  // Warm up the embedded roblox.com page in the background so opening one is quick.
  useEffect(() => {
    if (!me.id) return;
    const timer = window.setTimeout(() => void call("prewarmEmbed").catch(() => undefined), 6000);
    return () => window.clearTimeout(timer);
  }, [me.id]);
  const { route, go } = useNav();
  const [drawer, setDrawer] = useState(false);
  const [switchAcc, setSwitchAcc] = useState(false);
  const { data: requests = 0 } = useQuery({ queryKey: ["friendRequestCount"], queryFn: friendRequestCount });
  const minimal = route.name === "chat" || route.name === "avatar";
  const pluginPages = usePluginPages();
  const chatDot = useChatDot();
  // The menu dot is for *new* friend requests: once you've opened the menu or the requests
  // page, it stays off until another request arrives.
  const seenKey = `ruby.seenRequests.${me.id ?? 0}`;
  const [seen, setSeen] = useState(() => {
    try {
      return Number(localStorage.getItem(seenKey) ?? "0") || 0;
    } catch {
      return 0;
    }
  });
  const markSeen = (n: number) => {
    setSeen(n);
    try {
      localStorage.setItem(seenKey, String(n));
    } catch {
      /* preference only */
    }
  };
  useEffect(() => {
    // Requests accepted/ignored elsewhere: lower the baseline so the next new one shows.
    if (requests < seen) markSeen(requests);
    if (route.name === "friends" && route.tab === "requests" && requests > seen) markSeen(requests);
  }, [requests, route]); // eslint-disable-line react-hooks/exhaustive-deps
  const newRequests = requests > seen;
  // How many arrived since you last looked, shown on Friends in the menu you just opened.
  const [drawerNew, setDrawerNew] = useState(0);

  const { toast } = useUi();
  // Ctrl+Shift+S: streamer mode on or off from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.shiftKey && e.code === "KeyS")) return;
      e.preventDefault();
      const on = !streamerMode();
      setPref("streamer", on ? "1" : "0");
      toast(on ? t("Streamer mode on: your balance, username and links are hidden.") : t("Streamer mode off."));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const avatarTabs =
    route.name === "avatar" ? (
      <div className="segmented">
        {(["marketplace", "customize", "profile"] as const).map((tab) => (
          <button key={tab} className={(route.tab ?? "customize") === tab ? "active" : ""} onClick={() => go({ name: "avatar", tab })}>
            {tab === "marketplace" ? t("Marketplace") : tab === "customize" ? t("Customize") : t("Profile")}
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div className="shell">
      <AppBackground />
      <aside className="rail" data-tauri-drag-region>
        <button
          className="rail-menu badge-host"
          aria-label={newRequests ? t("Menu (new friend requests)") : t("Menu")}
          onClick={() => {
            setDrawerNew(Math.max(0, requests - seen));
            setDrawer(true);
            markSeen(requests);
          }}
        >
          <Icon name="three-bars-horizontal" size={24} />
          {newRequests ? <span className="dot-badge" /> : null}
        </button>
        <RailButton icon="house" label={t("Home")} active={["home", "game", "search", "list"].includes(route.name)} onClick={() => go({ name: "home" })} />
        <RailButton icon="chat" label={t("Chat")} active={route.name === "chat"} dot={chatDot} onClick={() => go({ name: "chat" })} />
        <RailButton icon="paint-brush" label={t("Customize")} active={route.name === "mods"} onClick={() => go({ name: "mods" })} />
        <RailButton icon="puzzle" label={t("Plugins")} active={route.name === "plugins" || route.name === "plugin"} onClick={() => go({ name: "plugins" })} />
        <RailButton label={t("Me")} active={route.name === "avatar" || (route.name === "profile" && route.userId === me.id)} onClick={() => go({ name: "avatar" })}>
          <Headshot userId={me.id} size={28} />
        </RailButton>
        <div className="rail-spacer" data-tauri-drag-region />
        <RailButton icon="gear" label={t("Settings")} active={route.name === "rubySettings" || route.name === "client"} onClick={() => go({ name: "rubySettings" })} />
        {pluginPages.map((p) => (
          <RailButton
            key={`${p.pluginId}:${p.id}`}
            icon={(p.icon as IconName) ?? "puzzle"}
            label={p.label}
            active={route.name === "plugin" && route.pluginId === p.pluginId && route.pageId === p.id}
            onClick={() => go({ name: "plugin", pluginId: p.pluginId, pageId: p.id })}
          >
            {p.iconUrl ? <img className="rail-plugin-icon" src={p.iconUrl} alt="" draggable={false} /> : undefined}
          </RailButton>
        ))}
        <img className="rail-logo" src={`${import.meta.env.BASE_URL}RubyLauncher.png`} alt="" draggable={false} />
      </aside>
      <div className="main">
        <Topbar showSearch={!minimal} center={avatarTabs} />
        <main className="content">
          <UpdateBanner />
          <ModerationBanner />
          <ErrorBoundary resetKey={JSON.stringify(route)} onHome={() => go({ name: "home" })}>
            {children}
          </ErrorBoundary>
        </main>
      </div>
      <RowArrows />
      <PresenceSync />
      <ChallengeHost />
      <DesktopNotifyWatcher />
      <TrayStatus />
      <ConfirmHost />
      <Drawer newRequests={drawerNew} open={drawer} onClose={() => setDrawer(false)} onSwitchAccounts={() => setSwitchAcc(true)} />
      {switchAcc ? <SwitchAccountsModal onClose={() => setSwitchAcc(false)} /> : null}
      <LaunchOverlay />
      <Toasts />
      <FocusMode />
    </div>
  );
}
