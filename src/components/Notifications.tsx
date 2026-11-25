import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  acceptRequest,
  acceptTrustedFriendRequest,
  clearNotificationsUnread,
  declineRequest,
  friendRequestCount,
  friendRequests,
  notifications,
  trustedFriendRequests,
  type NotifAction,
  type NotifButton,
  type NotifThumb,
} from "../lib/api";
import { useNav, useUi } from "../app/store";
import { Headshot, Icon, SkeletonRows, Thumb } from "./ui";
import { useSuppressEmbed } from "./WebEmbed";
import { t } from "../lib/i18n";

function NotifThumbView({ thumb, onUser }: { thumb?: NotifThumb; onUser?: (id: number) => void }) {
  if (!thumb)
    return (
      <div className="notif-generic">
        <Icon name="bell" size={20} />
      </div>
    );
  if (thumb.kind === "user")
    return (
      <button onClick={() => onUser?.(thumb.id)} aria-label={t("Open profile")}>
        <Headshot userId={thumb.id} size={44} />
      </button>
    );
  if (thumb.kind === "group") return <Thumb type="GroupIcon" id={thumb.id} className="round" />;
  if (thumb.kind === "asset") return <Thumb type="Asset" id={thumb.id} />;
  return <Thumb type="GameIcon" id={thumb.id} />;
}

/** The app always offers an outlined "Dismiss" before a notification's own action. */
function withDismiss(buttons: NotifButton[]): NotifButton[] {
  if (!buttons.length || buttons.some((b) => b.action.kind === "dismiss")) return [...buttons].sort((a, b) => (a.action.kind === "dismiss" ? -1 : b.action.kind === "dismiss" ? 1 : 0));
  return [{ label: t("Dismiss"), primary: false, action: { kind: "dismiss" } }, ...buttons];
}

export function NotificationsPanel({ onClose }: { onClose: () => void }) {
  useSuppressEmbed();
  const { go } = useNav();
  const { play, toast } = useUi();
  const qc = useQueryClient();
  const ref = useRef<HTMLDivElement>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const reqs = useQuery({ queryKey: ["requests"], queryFn: friendRequests });
  const reqCount = useQuery({ queryKey: ["friendRequestCount"], queryFn: friendRequestCount });
  const trusted = useQuery({ queryKey: ["trustedRequests"], queryFn: trustedFriendRequests });
  const stream = useInfiniteQuery({
    queryKey: ["notifications"],
    queryFn: ({ pageParam }) => notifications(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length >= 20 ? all.length * 20 : undefined),
  });
  const [reqsOpen, setReqsOpen] = useState(false);

  // Opening the tray marks everything read: the badge clears at once and the unread highlight fades out.
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    qc.setQueryData(["notifUnread"], 0);
    clearNotificationsUnread().then(() => qc.invalidateQueries({ queryKey: ["notifUnread"] }));
    const tm = window.setTimeout(() => setSeen(true), 1200);
    return () => window.clearTimeout(tm);
  }, [qc]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const runAction = (action: NotifAction) => {
    switch (action.kind) {
      case "profile":
        if (action.userId) go({ name: "profile", userId: action.userId });
        onClose();
        break;
      case "chat":
        if (action.userId) go({ name: "chat", withUserId: action.userId });
        onClose();
        break;
      case "experience":
        if (action.placeId) {
          play(action.placeId, action.name ?? t("experience"));
          onClose();
        }
        break;
      case "community":
        go({ name: "community", groupId: action.groupId });
        onClose();
        break;
      case "item":
        go({ name: "item", itemType: action.itemType, id: action.id });
        onClose();
        break;
      case "game":
        go({ name: "game", universeId: action.universeId });
        onClose();
        break;
      case "dismiss":
      case "none":
        break;
    }
  };

  const acceptTrusted = async (id: number) => {
    try {
      await acceptTrustedFriendRequest(id);
      toast(t("Trusted friend added."));
      qc.invalidateQueries({ queryKey: ["trustedRequests"] });
      qc.invalidateQueries({ queryKey: ["trustedStatus", id] });
    } catch (e) {
      toast(t("Couldn't accept: {error}", { error: (e as Error).message }), "error");
    }
  };

  const act = async (id: number, accept: boolean) => {
    try {
      await (accept ? acceptRequest(id) : declineRequest(id));
      qc.invalidateQueries({ queryKey: ["requests"] });
      qc.invalidateQueries({ queryKey: ["friendRequestCount"] });
      if (accept) qc.invalidateQueries({ queryKey: ["friends"] });
    } catch (e) {
      toast(t("Couldn't update request: {error}", { error: (e as Error).message }), "error");
    }
  };

  const loading = stream.isLoading;
  const streamItems = (stream.data?.pages.flat() ?? []).filter((n) => !dismissed.has(n.id));
  const requestTotal = Math.max(reqCount.data ?? 0, reqs.data?.length ?? 0);
  const empty = !loading && !requestTotal && !trusted.data?.length && !streamItems.length;

  return (
    <div className="notif-panel" ref={ref}>
      <div className="notif-head">{t("Notifications")}</div>
      <div className="notif-list">
        {loading ? (
          <SkeletonRows count={5} avatar={40} />
        ) : null}

        {/* Like the app: friend requests collapse into one row so real notifications stay visible. */}
        {requestTotal > 0 ? (
          <button className="notif-card notif-reqs" onClick={() => setReqsOpen((o) => !o)}>
            <div className="notif-stack">
              {(reqs.data ?? []).slice(0, 3).map((r) => (
                <Headshot key={r.id} userId={r.id} size={32} />
              ))}
            </div>
            <div className="notif-body">
              <div className="notif-title">{t("Friend requests")}</div>
              <div className="notif-text muted">
                {reqs.data?.[0]
                  ? requestTotal > 1
                    ? requestTotal === 2
                      ? t("{name} and 1 other", { name: reqs.data[0].displayName })
                      : t("{name} and {n} others", { name: reqs.data[0].displayName, n: requestTotal - 1 })
                    : reqs.data[0].displayName
                  : t("{n} pending", { n: requestTotal })}
              </div>
            </div>
            <span className="notif-count">{requestTotal > 99 ? "99+" : requestTotal}</span>
            <Icon name={reqsOpen ? "minus-small" : "chevron-small-right"} size={18} />
          </button>
        ) : null}
        {reqsOpen ? (
          <div className="notif-reqs-list">
            <button
              className="link small notif-see-all"
              onClick={() => {
                go({ name: "friends", tab: "requests" });
                onClose();
              }}
            >
              {t("See all requests")}
            </button>
          </div>
        ) : null}

        {(reqsOpen ? (reqs.data ?? []).slice(0, 10) : []).map((r) => (
          <div key={`req-${r.id}`} className="notif-card">
            <button
              className="notif-thumb"
              onClick={() => {
                go({ name: "profile", userId: r.id });
                onClose();
              }}
            >
              <Headshot userId={r.id} size={44} />
            </button>
            <div className="notif-body">
              <div className="notif-text">
                <b>{r.displayName}</b> <span className="muted">@{r.name}</span> {t("sent you a friend request.")}
              </div>
              <div className="notif-buttons">
                <button className="btn btn-primary btn-small" onClick={() => act(r.id, true)}>
                  {t("Accept")}
                </button>
                <button className="btn btn-secondary btn-small" onClick={() => act(r.id, false)}>
                  {t("Ignore")}
                </button>
              </div>
            </div>
          </div>
        ))}

        {(trusted.data ?? []).map((r) => (
          <div key={`trust-${r.id}`} className={`notif-card ${seen ? "" : "unread"}`}>
            <button
              className="notif-thumb"
              onClick={() => {
                go({ name: "profile", userId: r.id });
                onClose();
              }}
            >
              <Headshot userId={r.id} size={44} />
            </button>
            <div className="notif-body">
              <div className="notif-text">
                <b>{r.displayName}</b> <span className="muted">@{r.name}</span> {t("sent you a trusted friend request.")}
              </div>
              <div className="notif-buttons">
                <button className="btn btn-primary btn-small" onClick={() => acceptTrusted(r.id)}>
                  {t("Accept")}
                </button>
              </div>
            </div>
          </div>
        ))}

        {streamItems.map((n) => (
          <div key={n.id} className={`notif-card ${n.interacted || seen ? "" : "unread"}`}>
            <div className="notif-thumb">
              <NotifThumbView thumb={n.thumbnail} onUser={(id) => runAction({ kind: "profile", userId: id })} />
            </div>
            <div
              className={`notif-body ${n.bodyAction.kind !== "none" ? "clickable" : ""}`}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("button")) return;
                runAction(n.bodyAction);
              }}
            >
              {n.title ? <div className="notif-title">{n.title}</div> : null}
              <div className="notif-text">{n.body}</div>
              {withDismiss(n.buttons).length ? (
                <div className="notif-buttons">
                  {withDismiss(n.buttons).map((b: NotifButton, i) => (
                    <button
                      key={i}
                      className={`btn btn-small ${b.action.kind === "dismiss" ? "btn-outline" : b.primary || n.buttons.length === 1 ? "btn-primary" : "btn-secondary"}`}
                      onClick={() => {
                        if (b.action.kind === "dismiss") setDismissed((s) => new Set(s).add(n.id));
                        else runAction(b.action);
                      }}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <span className="notif-time">{n.timestamp}</span>
          </div>
        ))}

        {stream.hasNextPage ? (
          <button className="btn btn-secondary btn-small notif-more" onClick={() => stream.fetchNextPage()} disabled={stream.isFetchingNextPage}>
            {stream.isFetchingNextPage ? t("Loading…") : t("Load more")}
          </button>
        ) : null}
        {empty ? <div className="notif-empty">{t("You're all caught up.")}</div> : null}
      </div>
    </div>
  );
}
