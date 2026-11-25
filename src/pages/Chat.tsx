import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addChatMembers,
  chatMessages,
  chatThreads,
  markConversationsRead,
  sendChat,
  sendTrustedFriendRequest,
  sendTyping,
  startConversation,
  startGroupChat,
  trustedStatus,
  usersByIds,
  type ChatMessage,
  type Conversation,
} from "../lib/api";
import { ago } from "../lib/format";
import { useMe, useNav, useUi } from "../app/store";
import { ErrorState, Headshot, Icon, SkeletonMessages, SkeletonRows, Spinner, Verified } from "../components/ui";
import { useFriends } from "./Home";
import { friendlyError } from "./People";
import { fmtDate, t } from "../lib/i18n";

type Names = Map<number, { name: string; displayName: string; hasVerifiedBadge?: boolean }>;

/**
 * Conversations render as soon as they arrive; display names fill in from a separate
 * (cached) lookup instead of holding the whole list back.
 */
function useThreads() {
  const me = useMe();
  const first = useQuery({
    queryKey: ["chatThreads"],
    refetchInterval: 20_000,
    staleTime: 15_000,
    queryFn: () => chatThreads(),
  });
  // Older pages, loaded as you scroll down. The first page keeps refreshing on its own.
  const [older, setOlder] = useState<Conversation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const nextCursor = cursor ?? first.data?.nextCursor ?? "";
  const loadOlder = async () => {
    if (loadingOlder || !nextCursor) return;
    setLoadingOlder(true);
    try {
      const page = await chatThreads(nextCursor);
      setOlder((o) => [...o, ...page.conversations]);
      setCursor(page.nextCursor || "");
    } catch {
      /* try again on the next scroll */
    } finally {
      setLoadingOlder(false);
    }
  };
  const merged = useMemo(() => {
    if (!first.data) return undefined;
    const seen = new Set<string>();
    return [...first.data.conversations, ...older].filter((c) => !seen.has(c.id) && (seen.add(c.id), true));
  }, [first.data, older]);
  const threads = { ...first, data: merged };
  const ids = [...new Set((threads.data ?? []).flatMap((c) => c.participants))].sort((a, b) => a - b);
  const names = useQuery({
    queryKey: ["chatNames", ids.join(",")],
    queryFn: () => usersByIds(ids).catch(() => new Map()) as Promise<Names>,
    enabled: ids.length > 0,
    staleTime: 10 * 60_000,
    placeholderData: (prev) => prev,
  });
  const data = useMemo(
    () => (threads.data ? { conversations: threads.data, names: (names.data ?? new Map()) as Names, me: me.id } : undefined),
    [threads.data, names.data, me.id],
  );
  return { ...threads, data, loadOlder, hasOlder: !!nextCursor, loadingOlder };
}

function otherUser(c: Conversation, me: number) {
  return c.participants.find((p) => p !== me) ?? 0;
}

function title(c: Conversation, names: Names, me: number) {
  if (c.title && c.title !== "Conversation") return c.title;
  const others = c.participants.filter((p) => p !== me).map((p) => names.get(p)?.displayName ?? "");
  return others.filter(Boolean).join(", ") || t("Conversation");
}

function timeLabel(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return fmtDate(new Date(ms), { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** A timestamp divider is shown when messages are >20 min apart or on a new day. */
function bigGap(prevIso: string, iso: string): boolean {
  const a = Date.parse(prevIso);
  const b = Date.parse(iso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return b - a > 20 * 60 * 1000 || new Date(a).toDateString() !== new Date(b).toDateString();
}

/**
 * Parties ("Start party" / "Schedule a Party") are run by the Roblox client itself — there is no
 * web API for them — so Ruby gets you as far as picking friends and then says where to finish.
 */
function PartyDialog({ kind, onClose }: { kind: "start" | "schedule"; onClose: () => void }) {
  const [picked, setPicked] = useState<number[] | null>(null);
  if (!picked)
    return (
      <FriendPicker
        title={kind === "start" ? t("Start party") : t("Schedule a Party")}
        action={t("Next")}
        max={6}
        onDone={async (ids) => setPicked(ids)}
        onClose={onClose}
      />
    );
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="buy-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="buy-head">
          <h2>{kind === "start" ? t("Start party") : t("Schedule a Party")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("Close")}>
            <Icon name="x-small" size={20} />
          </button>
        </div>
        <div className="party-faces">
          {picked.map((id) => (
            <Headshot key={id} userId={id} size={44} />
          ))}
        </div>
        <p className="muted">
          {kind === "start"
            ? t("Parties (voice + joining experiences together) are hosted by the Roblox app itself, and Roblox doesn’t offer a way for other apps to start one. Open Chat in the Roblox app and choose Start party to bring these friends along.")
            : t("Scheduled parties are created inside the Roblox app, and Roblox doesn’t offer a way for other apps to schedule one. Open Chat in the Roblox app and choose + → Schedule a Party.")}
        </p>
        <div className="buy-actions">
          <button className="btn btn-primary btn-block" onClick={onClose}>
            {t("Got it")}
          </button>
        </div>
      </div>
    </div>
  );
}

function FriendPicker({
  title: heading,
  action,
  max,
  exclude = [],
  onDone,
  onClose,
}: {
  title: string;
  action: string;
  max: number;
  exclude?: number[];
  onDone: (ids: number[]) => Promise<void>;
  onClose: () => void;
}) {
  const me = useMe();
  const { toast } = useUi();
  const { data: friends = [] } = useFriends(me.id);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const list = friends.filter(
    (f) => !exclude.includes(f.id) && (!filter || `${f.displayName} ${f.name}`.toLowerCase().includes(filter.toLowerCase())),
  );
  const toggle = (id: number) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= max ? p : [...p, id]));
  const submit = async () => {
    if (!picked.length || busy) return;
    setBusy(true);
    try {
      await onDone(picked);
      onClose();
    } catch (e) {
      toast(friendlyError(e), "error");
      setBusy(false);
    }
  };
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="new-chat" onClick={(e) => e.stopPropagation()}>
        <header className="new-chat-head">
          <button className="icon-btn" onClick={onClose} aria-label={t("Back")}>
            <Icon name="arrow-large-left" size={20} />
          </button>
          <span>{heading}</span>
          <button className="link new-chat-create" disabled={!picked.length || busy} onClick={submit}>
            {busy ? <Spinner size={16} /> : action}
          </button>
        </header>
        <div className="picked-row">
          <span className="picked-count">
            <Icon name="person-plus" size={20} />
            {picked.length}/{max}
          </span>
          {Array.from({ length: max }).map((_, i) =>
            picked[i] ? (
              <button key={i} className="picked-slot filled" onClick={() => toggle(picked[i])} title={t("Remove")}>
                <Headshot userId={picked[i]} size={44} />
              </button>
            ) : (
              <span key={i} className="picked-slot" />
            ),
          )}
        </div>
        <div className="filter">
          <Icon name="magnifying-glass" size={16} />
          <input autoFocus placeholder={t("Search for friends")} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="muted details-section">{t("Suggested")}</div>
        <div className="new-chat-list">
          {list.map((f) => (
            <button key={f.id} className="member-row" onClick={() => toggle(f.id)}>
              <Headshot userId={f.id} size={44} presence={f.presence?.userPresenceType} />
              <div className="member-text">
                <div className="person-name">
                  {f.displayName} {f.hasVerifiedBadge ? <Verified size={12} /> : null}
                </div>
                <div className="muted small ellipsis">
                  {f.presence?.userPresenceType === 2 && f.presence.lastLocation ? f.presence.lastLocation : `@${f.name}`}
                </div>
              </div>
              <span className={`check-box ${picked.includes(f.id) ? "on" : ""}`}>
                {picked.includes(f.id) ? <Icon name="check" size={14} /> : null}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Details({ c, names, onBack }: { c: Conversation; names: Names; onBack: () => void }) {
  const { go } = useNav();
  const me = useMe();
  const qc = useQueryClient();
  const { toast } = useUi();
  const [adding, setAdding] = useState(false);
  const addPeople = async (ids: number[]) => {
    if (c.type === "group") {
      await addChatMembers(c.id, ids);
      toast("Added to the chat.");
      qc.invalidateQueries({ queryKey: ["chatThreads"] });
    } else {
      // Adding people to a 1:1 chat starts a new group, like the Roblox app.
      const members = [otherUser(c, me.id), ...ids];
      const name = members.map((id) => names.get(id)?.displayName ?? "").filter(Boolean).slice(0, 3).join(", ");
      const id = await startGroupChat(name || t("Group chat"), members);
      await qc.invalidateQueries({ queryKey: ["chatThreads"] });
      go({ name: "chat", conversationId: id });
    }
  };
  return (
    <div className="thread">
      <header className="thread-head details-head">
        <button className="icon-btn" onClick={onBack} aria-label={t("Back")}>
          <Icon name="arrow-large-left" size={20} />
        </button>
        <span className="details-title">{t("Details")}</span>
      </header>
      <div className="details-body">
        <div className="chat-members-head">
          <span className="details-section">{t("Members")}</span>
          <span className="muted small">{c.participants.length}</span>
        </div>
        <div className="chat-members">
          <button className="chat-member" onClick={() => setAdding(true)}>
            <span className="chat-member-add">
              <Icon name="plus-small" size={22} />
            </span>
            <span className="chat-member-text">
              <b>{t("Add Friends")}</b>
              <span className="muted small">{t("Up to 5 at a time")}</span>
            </span>
          </button>
          {c.participants.map((pid) => {
            const u = names.get(pid);
            const isMe = pid === me.id;
            return (
              <button key={pid} className="chat-member" onClick={() => go({ name: "profile", userId: pid })}>
                <Headshot userId={pid} size={44} />
                <span className="chat-member-text">
                  <b className="ellipsis">
                    {u?.displayName ?? (isMe ? t("You") : t("User {id}", { id: pid }))} {u?.hasVerifiedBadge ? <Verified size={12} /> : null}
                    {isMe ? <span className="chat-member-you">{t("You")}</span> : null}
                  </b>
                  {u ? <span className="muted small ellipsis">@{u.name}</span> : null}
                </span>
                <Icon name="chevron-small-right" size={18} />
              </button>
            );
          })}
        </div>
      </div>
      {adding ? (
        <FriendPicker title={t("Add Friends")} action={t("Add")} max={5} exclude={c.participants} onDone={addPeople} onClose={() => setAdding(false)} />
      ) : null}
    </div>
  );
}

function ReplyQuote({ target, names, mine }: { target?: ChatMessage; names: Names; mine: boolean }) {
  if (!target) return null;
  const who = names.get(target.senderUserId)?.displayName ?? "message";
  return (
    <div className={`reply-quote ${mine ? "mine" : ""}`}>
      <span className="reply-who">{who}</span>
      <span className="reply-snip">{target.content}</span>
    </div>
  );
}

function Thread({ c, names }: { c: Conversation; names: Names }) {
  const me = useMe();
  const { go } = useNav();
  const { toast } = useUi();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [bannerOff, setBannerOff] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [party, setParty] = useState<"start" | "schedule" | null>(null);
  const lastTyping = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const other = otherUser(c, me.id);
  const otherName = names.get(other);
  const q = useQuery({ queryKey: ["chatMessages", c.id], queryFn: () => chatMessages(c.id), refetchInterval: 5_000 });
  const trusted = useQuery({
    queryKey: ["trustedStatus", other],
    queryFn: () => trustedStatus(other),
    enabled: c.type === "direct" && !!other,
  });
  const messages = useMemo(
    () => [...(q.data?.messages ?? [])].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    [q.data],
  );
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  // Messages present on first load appear at once; only newly arriving ones animate in.
  const seen = useRef(new Set<string>());
  const primed = useRef(false);
  if (!primed.current && q.data) {
    messages.forEach((m) => seen.current.add(m.id));
    primed.current = true;
  }
  useEffect(() => {
    messages.forEach((m) => seen.current.add(m.id));
  }, [messages]);
  // Follow the newest message. Roblox sends a fixed-size page of recent messages, so the count
  // can stay the same when one arrives: key on the newest message instead. Your own messages
  // always scroll into view; someone else's only if you were already reading at the bottom.
  const scrolled = useRef(false);
  const nearBottom = useRef(true);
  const last = messages[messages.length - 1];
  useEffect(() => {
    const list = bottom.current?.parentElement;
    if (!list) return;
    const onScroll = () => (nearBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 120);
    list.addEventListener("scroll", onScroll, { passive: true });
    return () => list.removeEventListener("scroll", onScroll);
  }, [c.id, q.isSuccess]);
  useEffect(() => {
    if (!last) return;
    const mine = last.senderUserId === me.id;
    if (!scrolled.current || mine || nearBottom.current) {
      bottom.current?.scrollIntoView({ block: "end", behavior: scrolled.current ? "smooth" : "auto" });
      nearBottom.current = true;
    }
    scrolled.current = true;
  }, [last?.id, c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new conversation starts at its latest message.
  useEffect(() => {
    scrolled.current = false;
    nearBottom.current = true;
  }, [c.id]);

  // Opening a conversation marks it read, like the Roblox app.
  useEffect(() => {
    if (c.unreadCount > 0) markConversationsRead([c.id]).then(() => qc.invalidateQueries({ queryKey: ["chatThreads"] }));
  }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onType = (v: string) => {
    setDraft(v);
    const now = Date.now();
    if (v && now - lastTyping.current > 3000) {
      lastTyping.current = now;
      sendTyping(c.id);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await sendChat(c.id, text, replyTo?.id);
      setDraft("");
      setReplyTo(null);
      await q.refetch();
      qc.invalidateQueries({ queryKey: ["chatThreads"] });
    } catch (e) {
      toast(t("Message not sent: {error}", { error: friendlyError(e) }), "error");
    } finally {
      setSending(false);
    }
  };

  const addTrusted = async () => {
    try {
      await sendTrustedFriendRequest(other);
      toast("Trusted friend request sent.");
      qc.invalidateQueries({ queryKey: ["trustedStatus", other] });
    } catch (e) {
      toast(friendlyError(e), "error");
    }
  };

  if (showDetails) return <Details c={c} names={names} onBack={() => setShowDetails(false)} />;
  const showTrustedBanner = c.type === "direct" && !bannerOff && trusted.data && trusted.data !== "TrustedFriends";

  return (
    <div className="thread">
      <header className="thread-head">
        {/* As in the app: the header itself opens the Details pane (members, trusted, report). */}
        {c.type === "direct" && other ? (
          <button className="person-id" onClick={() => setShowDetails(true)} title={t("Details")}>
            <Headshot userId={other} size={40} />
            <div>
              <div className="person-name">{otherName?.displayName ?? title(c, names, me.id)}</div>
              {otherName ? <div className="muted">@{otherName.name}</div> : null}
            </div>
          </button>
        ) : (
          <button className="person-id" onClick={() => setShowDetails(true)} title={t("Details")}>
            <div className="group-avatar">
              <Icon name="two-people" size={22} />
            </div>
            <div className="person-name">{title(c, names, me.id)}</div>
          </button>
        )}
        <div className="thread-actions">
          {c.type === "direct" && other ? (
            <button className="icon-btn" onClick={() => go({ name: "profile", userId: other })} title={t("View profile")} aria-label={t("View profile")}>
              <Icon name="person-standing" size={20} />
            </button>
          ) : null}
          <button className="icon-btn" onClick={() => setShowDetails(true)} title={t("Details")} aria-label={t("Details")}>
            <Icon name="circle-i" size={20} />
          </button>
        </div>
      </header>

      {showTrustedBanner ? (
        <div className="trusted-banner">
          <span>{trusted.data === "RequestSent" ? t("Trusted friend request sent") : t("Add trusted friend to chat freely")}</span>
          <div className="trusted-actions">
            {trusted.data === "None" ? (
              <button className="link" onClick={addTrusted}>
                {t("Add")}
              </button>
            ) : null}
            <button className="icon-btn" onClick={() => setBannerOff(true)} aria-label={t("Dismiss")}>
              <Icon name="x-small" size={18} />
            </button>
          </div>
        </div>
      ) : null}

      <div className="messages">
        {q.isLoading ? (
          <SkeletonMessages />
        ) : q.error ? (
          <ErrorState error={q.error} retry={() => q.refetch()} />
        ) : (
          <>
            {!q.data?.nextCursor ? (
              <div className="first-convo">
                <Headshot userId={other} size={56} />
                <div className="first-convo-name">{otherName?.displayName ?? title(c, names, me.id)}</div>
                {otherName ? <div className="muted">@{otherName.name}</div> : null}
                <p className="muted first-convo-note">
                  {t("Be careful when you chat. Don't share personal info or move to another chat app. You can block or report anyone from their profile.")}
                </p>
              </div>
            ) : null}
            {messages.map((m, i) => {
              const mine = m.senderUserId === me.id;
              if (m.type === "system" || !m.senderUserId) {
                return (
                  <div key={m.id} className={seen.current.has(m.id) ? "" : "msg-in"}>
                    {!messages[i - 1] || bigGap(messages[i - 1].createdAt, m.createdAt) ? <div className="day-divider">{timeLabel(m.createdAt)}</div> : null}
                    <div className="system-msg" role="note">
                      <span className="system-msg-icon" aria-hidden="true" />
                      <span>{m.content}</span>
                    </div>
                  </div>
                );
              }
              const prev = messages[i - 1];
              const divider = !prev || bigGap(prev.createdAt, m.createdAt) ? timeLabel(m.createdAt) : null;
              const groupStart = !prev || prev.senderUserId !== m.senderUserId || !!divider || !!m.repliesTo;
              const showSender = !mine && c.type === "group" && groupStart;
              return (
                <div key={m.id} className={seen.current.has(m.id) ? "" : "msg-in"}>
                  {divider ? <div className="day-divider">{divider}</div> : null}
                  <div className={`bubble-row ${mine ? "mine" : ""}`}>
                    {!mine ? (
                      groupStart ? <Headshot userId={m.senderUserId} size={28} className="bubble-avatar" /> : <span className="bubble-avatar-spacer" />
                    ) : null}
                    <div className="bubble-col">
                      {showSender ? <div className="sender">{names.get(m.senderUserId)?.displayName}</div> : null}
                      {m.repliesTo ? <ReplyQuote target={byId.get(m.repliesTo)} names={names} mine={mine} /> : null}
                      <div className="bubble-line">
                        {mine ? (
                          <button
                            className="bubble-action"
                            title={t("Reply")}
                            onClick={() => {
                              setReplyTo(m);
                              input.current?.focus();
                            }}
                          >
                            <Icon name="arrow-curl-to-left" size={16} />
                          </button>
                        ) : null}
                        <div className="bubble" title={fmtDate(new Date(m.createdAt), { dateStyle: "medium", timeStyle: "short" })}>
                          {m.content}
                        </div>
                        {!mine ? (
                          <button
                            className="bubble-action"
                            title={t("Reply")}
                            onClick={() => {
                              setReplyTo(m);
                              input.current?.focus();
                            }}
                          >
                            <Icon name="arrow-curl-to-left" size={16} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
        <div ref={bottom} />
      </div>

      {replyTo ? (
        <div className="reply-bar">
          <Headshot userId={replyTo.senderUserId} size={32} />
          <div className="reply-bar-body">
            <div className="muted small">
              {replyTo.senderUserId === me.id ? "You" : (names.get(replyTo.senderUserId)?.displayName ?? "Someone")} said...
            </div>
            <div className="reply-bar-text ellipsis">{replyTo.content}</div>
          </div>
          <button className="icon-btn" onClick={() => setReplyTo(null)} aria-label={t("Cancel reply")}>
            <Icon name="x-small" size={18} />
          </button>
        </div>
      ) : null}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="menu-anchor">
          <button type="button" className="icon-btn composer-plus" onClick={() => setPlusOpen((o) => !o)} aria-label={t("More")}>
            <Icon name="plus-small" size={22} />
          </button>
          {plusOpen ? (
            <div className="menu up left">
              <button type="button" onClick={() => (setPlusOpen(false), setParty("start"))}>
                <Icon name="two-people" size={18} /> Start party
              </button>
              <button type="button" onClick={() => (setPlusOpen(false), setParty("schedule"))}>
                <Icon name="clock" size={18} /> Schedule a Party
              </button>
            </div>
          ) : null}
        </div>
        <input
          ref={input}
          value={draft}
          onChange={(e) => onType(e.target.value)}
          placeholder={
            replyTo
              ? replyTo.senderUserId === me.id ? t("Reply to yourself") : names.get(replyTo.senderUserId)?.displayName ? t("Reply to {name}", { name: names.get(replyTo.senderUserId)!.displayName }) : t("Reply to message")
              : t("Say something")
          }
          maxLength={500}
        />
        <button className="icon-btn" type="submit" disabled={!draft.trim() || sending} aria-label={t("Send")}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M3 11.5 21 3l-6.5 18-3-7.5z" />
            <path d="m11.5 13.5 4-4" strokeLinecap="round" />
          </svg>
        </button>
      </form>
      {party ? <PartyDialog kind={party} onClose={() => setParty(null)} /> : null}
    </div>
  );
}

export function Chat({ conversationId, withUserId }: { conversationId?: string; withUserId?: number }) {
  const me = useMe();
  const { go } = useNav();
  const { toast } = useUi();
  const qc = useQueryClient();
  const q = useThreads();
  const [filter, setFilter] = useState("");
  const [newChat, setNewChat] = useState(false);
  const [partyStart, setPartyStart] = useState(false);
  const names = q.data?.names ?? new Map();
  const conversations = q.data?.conversations ?? [];
  // Hovering a conversation starts loading it, so opening it feels instant.
  const prefetch = (id: string) =>
    qc.prefetchQuery({ queryKey: ["chatMessages", id], queryFn: () => chatMessages(id), staleTime: 15_000 });

  // "Message this user": open the existing DM, or create one natively.
  useEffect(() => {
    if (!withUserId || !q.data) return;
    const existing = conversations.find((c) => c.type === "direct" && otherUser(c, me.id) === withUserId);
    if (existing) {
      go({ name: "chat", conversationId: existing.id });
      return;
    }
    startConversation(withUserId)
      .then(async (id) => {
        await qc.invalidateQueries({ queryKey: ["chatThreads"] });
        go({ name: "chat", conversationId: id });
      })
      .catch((e) => toast(t("Couldn't start a chat: {error}", { error: friendlyError(e) }), "error"));
  }, [withUserId, q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const createChat = async (ids: number[]) => {
    let id: string;
    if (ids.length === 1) {
      const existing = conversations.find((c) => c.type === "direct" && otherUser(c, me.id) === ids[0]);
      id = existing ? existing.id : await startConversation(ids[0]);
    } else {
      const label = ids.map((x) => names.get(x)?.displayName).filter(Boolean).slice(0, 3).join(", ");
      id = await startGroupChat(label || t("Group chat"), ids);
    }
    await qc.invalidateQueries({ queryKey: ["chatThreads"] });
    go({ name: "chat", conversationId: id });
  };

  const friendsQ = useFriends(me.id);
  const presence = useMemo(() => new Map((friendsQ.data ?? []).map((f) => [f.id, f.presence?.userPresenceType])), [friendsQ.data]);
  const list = conversations.filter((c) => !filter || title(c, names, me.id).toLowerCase().includes(filter.toLowerCase()));
  const active = conversations.find((c) => c.id === conversationId);

  return (
    <div className="chat">
      <div className="chat-list">
        <div className="chat-list-head">
          <h1 className="page-title">{t("Chat")}</h1>
          <button className="icon-btn" onClick={() => setNewChat(true)} aria-label={t("New chat")}>
            <Icon name="pencil-square" size={22} />
          </button>
        </div>
        <div className="filter">
          <Icon name="magnifying-glass" size={16} />
          <input placeholder={t("Search")} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {q.isLoading ? (
          <SkeletonRows count={10} avatar={44} />
        ) : q.error ? (
          <ErrorState error={q.error} retry={() => q.refetch()} />
        ) : (
          <div
            className="convo-list"
            onScroll={(e) => {
              const el = e.currentTarget;
              if (!filter && el.scrollTop + el.clientHeight > el.scrollHeight - 240) void q.loadOlder();
            }}
          >
            {!filter ? (
              <button className="convo nav-row" onClick={() => setPartyStart(true)}>
                <span className="nav-row-icon">
                  <Icon name="two-people" size={20} />
                </span>
                <div className="convo-text">
                  <div className="person-name">{t("Start party")}</div>
                  <div className="muted small">{t("Join experiences together")}</div>
                </div>
                <Icon name="chevron-small-right" size={20} />
              </button>
            ) : null}
            {!filter ? (
              <button className="convo nav-row" onClick={() => go({ name: "communities" })}>
                <span className="nav-row-icon">
                  <Icon name="two-folders" size={20} />
                </span>
                <div className="convo-text">
                  <div className="person-name">{t("Communities")}</div>
                  <div className="muted small">{t("Create and explore communities")}</div>
                </div>
                <Icon name="chevron-small-right" size={20} />
              </button>
            ) : null}
            {list.map((c, i) => {
              const other = otherUser(c, me.id);
              return (
                <button
                  key={c.id}
                  className={`convo row-in ${c.id === conversationId ? "active" : ""}`}
                  style={{ animationDelay: `${Math.min(i, 14) * 22}ms` }}
                  onMouseEnter={() => prefetch(c.id)}
                  onClick={() => go({ name: "chat", conversationId: c.id })}
                >
                  {c.type === "direct" && other ? (
                    <Headshot userId={other} size={44} presence={presence.get(other)} />
                  ) : (
                    <div className="group-avatar">
                      <Icon name="two-people" size={22} />
                    </div>
                  )}
                  <div className="convo-text">
                    <div className="person-name">{title(c, names, me.id)}</div>
                    <div className={`ellipsis ${c.unreadCount > 0 ? "unread-text" : "muted"}`}>
                      {c.lastMessage}
                      {c.lastMessageAt || c.updatedAt ? ` · ${ago(c.lastMessageAt || c.updatedAt)}` : ""}
                    </div>
                  </div>
                  {c.unreadCount > 0 ? <span className="unread-dot" /> : null}
                </button>
              );
            })}
            {!filter && q.hasOlder ? (
              <button className="convo-more muted small" disabled={q.loadingOlder} onClick={() => void q.loadOlder()}>
                {q.loadingOlder ? <Spinner size={18} /> : t("Load older chats")}
              </button>
            ) : null}
          </div>
        )}
      </div>
      <div className="chat-main">
        {active ? (
          <Thread key={active.id} c={active} names={names} />
        ) : (
          // The app's empty state: two tilted cards (voice + chat), no text.
          <div className="chat-empty" aria-label={t("No conversation selected")}>
            <span className="chat-empty-card mic">
              <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
              </svg>
            </span>
            <span className="chat-empty-card bubble">
              <Icon name="chat" size={34} />
            </span>
          </div>
        )}
      </div>
      {partyStart ? <PartyDialog kind="start" onClose={() => setPartyStart(false)} /> : null}
      {newChat ? <FriendPicker title={t("New chat")} action={t("Create")} max={5} onDone={createChat} onClose={() => setNewChat(false)} /> : null}
    </div>
  );
}
