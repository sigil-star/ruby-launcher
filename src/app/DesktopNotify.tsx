import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { call, on } from "../lib/ipc";
import { chatThreads, friendRequestCount, type Friend } from "../lib/api";
import { useFriends } from "../pages/Home";
import { useMe, useNav, useUi } from "./store";
import { streamerMode } from "../lib/appearance";
import { loadFavorites } from "../lib/friendsExtra";
import { t } from "../lib/i18n";

/*
 * Ruby's desktop notifications (bottom-right cards, drawn by Ruby itself). They only appear
 * when Ruby isn't the window you're looking at (in the tray, minimised, behind something) or
 * while you're in a game. Each kind can be turned off in Settings.
 */

export type NotifyPrefs = { enabled: boolean; friendOnline: boolean; friendGame: boolean; requests: boolean; messages: boolean; favoritesOnly: boolean };
const DEFAULTS: NotifyPrefs = { enabled: true, friendOnline: true, friendGame: true, requests: true, messages: true, favoritesOnly: true };
const KEY = "ruby.notify";

export function loadNotifyPrefs(): NotifyPrefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}
export function saveNotifyPrefs(p: NotifyPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* preference only */
  }
}

export type ToastTarget =
  | { action: "profile"; userId: number }
  | { action: "join"; placeId: number; jobId?: string | null; name: string }
  | { action: "chat"; conversationId: string }
  | { action: "requests" };

export type ToastPayload = { id: string; kind: "online" | "game" | "request" | "message"; title: string; body: string; userId?: number; target?: ToastTarget; actionLabel?: string };

let seq = 0;

/** Watches friends, requests and chats from the main window and raises cards when it should. */
export function DesktopNotifyWatcher() {
  const me = useMe();
  const { go } = useNav();
  const { playing, play } = useUi();
  const friends = useFriends(me.id ?? 0);
  const requests = useQuery({ queryKey: ["friendRequestCount"], queryFn: friendRequestCount, refetchInterval: 60_000, enabled: !!me.id });
  const chats = useQuery({ queryKey: ["notifyChats"], queryFn: () => chatThreads(), refetchInterval: 30_000, enabled: !!me.id, retry: false });
  const prevFriends = useRef<Map<number, Friend> | null>(null);
  const prevRequests = useRef<number | null>(null);
  const prevChats = useRef<Map<string, string> | null>(null);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const push = async (p: Omit<ToastPayload, "id">) => {
    const prefs = loadNotifyPrefs();
    if (!prefs.enabled) return;
    const kindOn = { online: prefs.friendOnline, game: prefs.friendGame, request: prefs.requests, message: prefs.messages }[p.kind];
    if (!kindOn) return;
    // Only when Ruby isn't what you're looking at, or you're in a game.
    const focused = await call<boolean>("mainFocused").catch(() => document.hasFocus());
    if (focused && !playingRef.current) return;
    void call("toastPush", { ...p, id: `t${Date.now()}-${++seq}` });
  };

  // Friends coming online / joining a game.
  useEffect(() => {
    const list = friends.data;
    if (!list) return;
    const now = new Map(list.map((f) => [f.id, f]));
    const before = prevFriends.current;
    prevFriends.current = now;
    if (!before) return; // first load: just remember
    let online = 0;
    // Friend activity is noisy with hundreds of friends: by default only favorites notify.
    const onlyFavs = loadNotifyPrefs().favoritesOnly;
    const favs = me.id ? loadFavorites(me.id) : new Set<number>();
    for (const f of list) {
      if (onlyFavs && !favs.has(f.id)) continue;
      const was = before.get(f.id)?.presence?.userPresenceType ?? 0;
      const is = f.presence?.userPresenceType ?? 0;
      if (is === 2 && was !== 2 && f.presence?.lastLocation) {
        const placeId = f.presence.placeId || f.presence.rootPlaceId || 0;
        void push({
          kind: "game",
          title: f.displayName,
          body: t("Joined {game}", { game: f.presence.lastLocation }),
          userId: f.id,
          target: placeId ? { action: "join", placeId, jobId: f.presence.gameId, name: f.presence.lastLocation } : { action: "profile", userId: f.id },
          actionLabel: placeId ? t("Join") : undefined,
        });
      } else if (was === 0 && is === 1 && online++ < 3) {
        void push({ kind: "online", title: f.displayName, body: t("Is now online"), userId: f.id, target: { action: "profile", userId: f.id } });
      }
    }
  }, [friends.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // New friend requests.
  useEffect(() => {
    const n = requests.data;
    if (n == null) return;
    const before = prevRequests.current;
    prevRequests.current = n;
    if (before != null && n > before) {
      const more = n - before;
      void push({ kind: "request", title: more === 1 ? t("New friend request") : t("{n} new friend requests", { n: more }), body: t("You have {n} pending.", { n }), target: { action: "requests" }, actionLabel: t("View") });
    }
  }, [requests.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // New chat messages (a conversation's last message changed and it's unread).
  useEffect(() => {
    const list = chats.data?.conversations;
    if (!list) return;
    const now = new Map(list.map((c) => [c.id, c.lastMessageAt || c.updatedAt]));
    const before = prevChats.current;
    prevChats.current = now;
    if (!before) return;
    for (const c of list) {
      const was = before.get(c.id);
      if (c.unreadCount > 0 && was && was !== (c.lastMessageAt || c.updatedAt)) {
        const other = c.type === "direct" ? c.participants.find((p) => p !== me.id) : undefined;
        const hide = streamerMode();
        void push({ kind: "message", title: hide ? t("New message") : c.title || t("New message"), body: hide ? t("Open Ruby to read it.") : c.lastMessage || t("Sent a message"), userId: hide ? undefined : other, target: { action: "chat", conversationId: c.id }, actionLabel: t("Reply") });
      }
    }
  }, [chats.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // A card was clicked: go there.
  useEffect(() => {
    const sub = on<ToastTarget>("toast-open", (tg) => {
      if (!tg) return;
      if (tg.action === "profile") go({ name: "profile", userId: tg.userId });
      else if (tg.action === "chat") go({ name: "chat", conversationId: tg.conversationId });
      else if (tg.action === "requests") go({ name: "friends", tab: "requests" });
      else if (tg.action === "join") void play(tg.placeId, tg.name, tg.jobId ?? undefined);
    });
    return () => void sub.then((u) => u());
  }, [go, play]);

  return null;
}
