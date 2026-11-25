import { askConfirm } from "../components/Confirm";
import { SocialIcon } from "../components/SocialIcon";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  cancelGroupRequest,
  communities,
  group,
  groupGames,
  groupMembers,
  groupMembership,
  joinGroup,
  backgroundImage,
  leaveGroup,
  sendFriendRequest,
  type CatalogItem,
  type Community as MyCommunity,
} from "../lib/api";
import {
  announcementReactions,
  announcementText,
  communityProfile,
  reactionEmoji,
  STOCK_EMOTE_IDS,
  createForumPost,
  createForumComment,
  deleteForumComment,
  setForumReaction,
  richText,
  type Announcement,
  type Reaction,
  forumCategories,
  forumComments,
  forumPinned,
  forumPosts,
  groupAnnouncements,
  groupEvents,
  groupFunds,
  groupNameHistory,
  groupRelations,
  groupRoles,
  groupSocialLinks,
  groupStore,
  primaryGroup,
  setPrimaryGroup,
  roleMembers,
  type ForumPost,
  type GroupRole,
  type RelatedGroup, forumPerms, type ForumPerms } from "../lib/social";
import { ago, compact, longDate, thousands } from "../lib/format";
import { win } from "../lib/ipc";
import { useMe, useNav, useUi } from "../app/store";
import { ErrorState, Headshot, Icon, Robux, SectionHeader, Skel, SkeletonGrid, SkeletonPage, SkeletonRows, Spinner, Thumb, Verified } from "../components/ui";
import { useItemPreview } from "../components/ItemPreview";
import { TileRow } from "../components/games";
import { friendlyError } from "./People";
import { fmtDate, t } from "../lib/i18n";

type CommunityTab = "home" | "posts" | "events" | "store" | "affiliates" | "about";
const tabLabel = (tb: CommunityTab): string => ({ home: t("Home"), posts: t("Posts"), events: t("Events"), store: t("Store"), affiliates: t("Affiliates"), about: t("About") })[tb];

function Sidebar({ current }: { current: number }) {
  const me = useMe();
  const { go } = useNav();
  const [q, setQ] = useState("");
  const mine = useQuery({ queryKey: ["communities", me.id], queryFn: () => communities(me.id) });
  const primary = useQuery({ queryKey: ["primaryGroup", me.id], queryFn: () => primaryGroup(me.id) });
  const rows = (mine.data ?? []).filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));
  const prim = rows.find((c) => c.id === primary.data?.group.id);
  // Owned communities first, like the app.
  const rest = rows.filter((c) => c !== prim).sort((a, b) => Number(!!b.isOwner) - Number(!!a.isOwner));
  const row = (c: MyCommunity) => (
    <button key={c.id} className={`cs-row ${c.id === current ? "active" : ""}`} onClick={() => go({ name: "community", groupId: c.id })}>
      <Thumb type="GroupIcon" id={c.id} className="square" />
      <div className="cs-text">
        <b>
          {c.name} {c.hasVerifiedBadge ? <Verified size={11} /> : null}
        </b>
        <span className="muted small">
          {c.isOwner ? t("{n} members • Owned", { n: compact(c.memberCount) }) : t("{n} members", { n: compact(c.memberCount) })}
        </span>
      </div>
    </button>
  );
  return (
    <aside className="community-side">
      <div className="row-between">
        <h2 className="cs-title">{t("Communities")}</h2>
        <button className="link small" onClick={() => go({ name: "communitySearch" })}>
          {t("See All")}
        </button>
      </div>
      <div className="filter">
        <Icon name="magnifying-glass" size={16} />
        <input placeholder={t("Search My Communities")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="cs-list">
        {mine.isLoading ? <SkeletonRows count={8} avatar={36} /> : null}
        {prim ? (
          <>
            <div className="cs-label">{t("Primary")}</div>
            {row(prim)}
          </>
        ) : null}
        {rest.length ? <div className="cs-label">{t("My Communities")}</div> : null}
        {rest.map(row)}
      </div>
      <button className="btn btn-secondary btn-block" onClick={() => win.openExternal("https://www.roblox.com/communities/create")}>
        {t("Create Community")}
      </button>
    </aside>
  );
}

function MembersModal({ groupId, roles, onClose }: { groupId: number; roles: GroupRole[]; onClose: () => void }) {
  const me = useMe();
  const { go } = useNav();
  const { toast } = useUi();
  // Like the app: start on the biggest role; "All members" (null) lists everyone with their role.
  const [roleId, setRoleId] = useState<number | null>(() => [...roles].sort((a, b) => b.memberCount - a.memberCount)[0]?.id ?? null);
  const [pickOpen, setPickOpen] = useState(false);
  const [sent, setSent] = useState<Set<number>>(new Set());
  const role = roles.find((r) => r.id === roleId) ?? null;
  const q = useInfiniteQuery({
    queryKey: ["roleMembers", groupId, roleId],
    queryFn: ({ pageParam }) =>
      roleId == null
        ? groupMembers(groupId, pageParam).then((r) => ({ members: r.members, nextCursor: r.nextCursor }))
        : roleMembers(groupId, roleId, pageParam),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.members) ?? [];
  const add = async (id: number) => {
    try {
      await sendFriendRequest(id);
      setSent((s) => new Set(s).add(id));
      toast(t("Friend request sent."));
    } catch (e) {
      toast(friendlyError(e), "error");
    }
  };
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="members-modal" onClick={(e) => e.stopPropagation()}>
        <div className="buy-head">
          <h2>{t("Members")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("Close")}>
            <Icon name="x-small" size={20} />
          </button>
        </div>
        <div className="menu-anchor">
          <button className="role-picker" onClick={() => setPickOpen((o) => !o)}>
            <span>{role ? role.name : t("All members")}</span>
            <Icon name="arrow-small-down" size={16} />
          </button>
          {pickOpen ? (
            <div className="menu left role-menu">
              <button className={roleId == null ? "on" : ""} onClick={() => (setRoleId(null), setPickOpen(false))}>
                <Icon name="two-people" size={16} /> <span className="role-name">{t("All members")}</span>
              </button>
              {roles.map((r) => (
                <button
                  key={r.id}
                  className={r.id === roleId ? "on" : ""}
                  onClick={() => {
                    setRoleId(r.id);
                    setPickOpen(false);
                  }}
                >
                  <Icon name="person" size={16} /> <span className="role-name">{r.name}</span>
                  <span className="role-count">{compact(r.memberCount)}</span>
                  <span className="muted small">{t("Rank {rank}", { rank: r.rank })}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="members-list">
          {q.isLoading ? <SkeletonRows count={6} avatar={40} /> : null}
          {rows.map((m) => (
            <div key={m.id} className="member-row">
              <button className="person-id" onClick={() => (onClose(), go({ name: "profile", userId: m.id }))}>
                <Headshot userId={m.id} size={40} />
                <div>
                  <div className="person-name">
                    {m.displayName} {m.hasVerifiedBadge ? <Verified size={12} /> : null}
                  </div>
                  <div className="muted small">
                    @{m.name}
                    {"role" in m && m.role ? ` · ${m.role}` : ""}
                  </div>
                </div>
              </button>
              {m.id !== me.id ? (
                <button className="btn btn-primary btn-small" disabled={sent.has(m.id)} onClick={() => add(m.id)}>
                  {sent.has(m.id) ? t("Sent") : t("Add")}
                </button>
              ) : null}
            </div>
          ))}
          {!q.isLoading && !rows.length ? <p className="muted center-text">{t("No members in this role.")}</p> : null}
          {q.hasNextPage ? (
            <button className="btn btn-secondary btn-small" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
              {q.isFetchingNextPage ? t("Loading...") : t("Load more")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type ReactTarget = { groupId: number; categoryId: string; postId: string; channelId: string; commentId: string; isPostComment: boolean };

/** Reaction chips; with a target they toggle (optimistically) and offer the emote picker. */
const noReact = () => t("Your role in this community can't react here.");
const noReply = () => t("Your role in this community can't reply to posts.");
const noPost = () => t("Your role in this community can't create posts.");
function Reactions({ list, target, locked }: { list: Reaction[]; target?: ReactTarget; locked?: string }) {
  const { toast } = useUi();
  const [local, setLocal] = useState(list);
  const [picker, setPicker] = useState(false);
  useEffect(() => setLocal(list), [list]);
  const mine = (r: Reaction) => !!(r.hasUserAppliedReaction || r.hasReacted);
  const toggle = async (emoteId: string) => {
    if (!target || locked) return;
    setPicker(false);
    const cur = local.find((r) => r.emoteId === emoteId);
    const on = !(cur && mine(cur));
    const before = local;
    setLocal((l) => {
      const has = l.find((r) => r.emoteId === emoteId);
      if (!has) return [...l, { emoteId, reactionCount: 1, hasUserAppliedReaction: true }];
      return l
        .map((r) => (r.emoteId === emoteId ? { ...r, hasUserAppliedReaction: on, hasReacted: on, reactionCount: Math.max(0, (r.reactionCount ?? r.count ?? 0) + (on ? 1 : -1)) } : r))
        .filter((r) => (r.reactionCount ?? 0) > 0 || mine(r));
    });
    try {
      const { groupId, ...tgt } = target;
      await setForumReaction(groupId, tgt, emoteId, on);
    } catch (e) {
      setLocal(before);
      toast(e instanceof Error ? e.message : t("Couldn't react to that."), "error");
    }
  };
  const shown = local.filter((r) => r.areReactionCountsVisible !== false || mine(r));
  return (
    <div className="post-reactions" onClick={(e) => e.stopPropagation()}>
      {shown.slice(0, 10).map((r) => (
        <button key={r.emoteId} type="button" disabled={!target || !!locked} title={locked} className={`reaction ${mine(r) ? "on" : ""}`} onClick={() => toggle(r.emoteId)}>
          <span className="reaction-emoji">{reactionEmoji(r.emoteId)}</span> {compact(r.reactionCount ?? r.count ?? 0)}
        </button>
      ))}
      {target ? (
        <span className="reaction-add-wrap">
          <button type="button" className="reaction add" disabled={!!locked} title={locked ?? t("Add reaction")} onClick={() => setPicker((p) => !p)}>
            <Icon name="plus-small" size={14} />
          </button>
          {picker ? (
            <span className="reaction-picker card-in">
              {STOCK_EMOTE_IDS.map((id) => (
                <button key={id} type="button" onClick={() => toggle(id)}>
                  {reactionEmoji(id)}
                </button>
              ))}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/** A plain-text composer used for new posts and replies. */
function Composer({ placeholder, withTitle, submitLabel, onSubmit, onCancel, autoFocus }: { placeholder: string; withTitle?: boolean; submitLabel: string; onSubmit: (body: string, title: string) => Promise<unknown>; onCancel?: () => void; autoFocus?: boolean }) {
  const { toast } = useUi();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = body.trim().length > 0 && (!withTitle || title.trim().length > 0);
  const send = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      await onSubmit(body.trim(), title.trim());
      setBody("");
      setTitle("");
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Roblox didn't accept that."), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="forum-composer card-in">
      {withTitle ? <input className="text-input" placeholder={t("Title")} maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={autoFocus} /> : null}
      <textarea
        className="text-input"
        placeholder={placeholder}
        rows={withTitle ? 5 : 2}
        maxLength={10000}
        value={body}
        autoFocus={autoFocus && !withTitle}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && send()}
      />
      <div className="forum-composer-actions">
        <span className="muted tiny">{t("Ctrl+Enter to send")}</span>
        {onCancel ? (
          <button className="btn btn-secondary btn-small" onClick={onCancel} disabled={busy}>
            {t("Cancel")}
          </button>
        ) : null}
        <button className="btn btn-primary btn-small" onClick={send} disabled={!ok || busy}>
          {busy ? <Spinner size={14} /> : submitLabel}
        </button>
      </div>
    </div>
  );
}

function AnnouncementCard({ a, ownerId }: { a: Announcement; ownerId?: number }) {
  const { go } = useNav();
  return (
    <div className="post-card announcement">
      <div className="post-head">
        {a.createdBy ? (
          <button className="link-plain" onClick={() => go({ name: "profile", userId: a.createdBy! })}>
            <Headshot userId={a.createdBy} size={22} />
          </button>
        ) : null}
        <b>{a.creatorInfo?.displayName ?? t("Member")}</b>
        {a.creatorInfo?.hasVerifiedBadge ? <Verified size={11} /> : null}
        {ownerId && a.createdBy === ownerId ? <span className="tag">{t("Owner")}</span> : null}
        <span className="muted small">
          {a.createdAt ? ` · ${ago(a.createdAt)}` : ""}
          {a.creatorInfo?.groupRoleName ? ` · ${a.creatorInfo.groupRoleName}` : ""}
        </span>
      </div>
      {a.name ? <div className="post-title big">{a.name}</div> : null}
      {announcementText(a) ? <div className="post-body">{announcementText(a)}</div> : null}
      <div className="post-foot">
        <Reactions list={announcementReactions(a)} />
      </div>
    </div>
  );
}

function PostCard({ p, onOpen, ownerId, groupId, categoryId, perms }: { p: ForumPost; onOpen?: () => void; ownerId?: number; groupId?: number; categoryId?: string; perms?: ForumPerms }) {
  const fc = p.firstComment;
  const author = fc?.creatorInfo;
  const reactions = fc?.reactions ?? [];
  return (
    <div className={`post-card ${onOpen ? "clickable" : ""}`} role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined} onClick={onOpen} onKeyDown={(e) => onOpen && e.key === "Enter" && onOpen()}>
      <div className="post-head">
        {fc?.createdBy ? <Headshot userId={fc.createdBy} size={22} /> : null}
        <b>{author?.displayName ?? t("Member")}</b>
        {author?.hasVerifiedBadge ? <Verified size={11} /> : null}
        {ownerId && fc?.createdBy === ownerId ? <span className="tag">{t("Owner")}</span> : null}
        <span className="muted small">
          {fc?.createdAt || p.createdAt ? ` · ${ago(fc?.createdAt || p.createdAt!)}` : ""}
          {author?.groupRoleName ? ` · ${author.groupRoleName}` : ""}
        </span>
      </div>
      <div className="post-title">
        {p.isPinned ? "📌 " : ""}
        {p.name}
      </div>
      {richText(fc?.content) ? <div className="post-body">{richText(fc?.content)}</div> : null}
      <div className="post-foot">
        <Reactions
          list={reactions}
          locked={perms?.member ? undefined : noReact()}
          target={groupId && categoryId && fc?.id ? { groupId, categoryId, postId: p.id, channelId: p.id, commentId: fc.id, isPostComment: true } : undefined}
        />
        <span className="muted small">
          <Icon name="chat" size={14} /> {p.commentCount === 1 ? t("1 reply") : t("{n} replies", { n: p.commentCount ?? 0 })}
        </span>
      </div>
    </div>
  );
}

function PostThread({ groupId, categoryId, post, onBack, ownerId, perms }: { groupId: number; categoryId: string; post: ForumPost; onBack: () => void; ownerId?: number; perms?: ForumPerms }) {
  const canReply = !!perms?.createComments;
  const qc = useQueryClient();
  const me = useMe();
  const { toast } = useUi();
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: ["forumComments", groupId, categoryId, post.id],
    queryFn: ({ pageParam }) => forumComments(groupId, categoryId, post.id, pageParam),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["forumComments", groupId, categoryId, post.id] });
    qc.invalidateQueries({ queryKey: ["forumPosts", groupId, categoryId] });
  };
  const rows = (q.data?.pages.flatMap((p) => p.comments) ?? []).filter((c) => c.id !== post.firstComment?.id);
  return (
    <div className="post-thread">
      <button className="link back-link" onClick={onBack}>
        <Icon name="arrow-large-left" size={16} /> {t("Back to posts")}
      </button>
      <PostCard p={post} ownerId={ownerId} groupId={groupId} categoryId={categoryId} perms={perms} />
      {canReply ? (
        <Composer placeholder={t("Write a reply")} submitLabel={t("Reply")} onSubmit={(body) => createForumComment(groupId, categoryId, post.id, body).then(refresh)} />
      ) : (
        <p className="muted small perm-note">
          <Icon name="lock" size={14} /> {perms?.member ? noReply() : t("Join this community to reply.")}
        </p>
      )}
      <div className="comments">
        {q.isLoading ? <SkeletonRows count={4} avatar={28} /> : null}
        {rows.map((c, i) => (
          <div key={c.id ?? i} className="comment card-in">
            {c.createdBy ? <Headshot userId={c.createdBy} size={28} /> : null}
            <div className="comment-main">
              <div className="muted small">
                <b className="text">{c.creatorInfo?.displayName ?? t("Member")}</b>
                {ownerId && c.createdBy === ownerId ? <span className="tag">{t("Owner")}</span> : null}
                {c.creatorInfo?.groupRoleName ? ` · ${c.creatorInfo.groupRoleName}` : ""}
                {c.createdAt ? ` · ${ago(c.createdAt)}` : ""}
              </div>
              <div className="comment-body">{richText(c.content)}</div>
              <div className="comment-foot">
                {c.id ? <Reactions list={c.reactions ?? []} locked={perms?.member ? undefined : noReact()} target={{ groupId, categoryId, postId: post.id, channelId: post.id, commentId: c.id, isPostComment: true }} /> : null}
                {c.id ? (
                  <button className="link small" disabled={!canReply} title={canReply ? undefined : perms?.member ? noReply() : t("Join this community to reply.")} onClick={() => setReplyTo(replyTo === c.id ? null : c.id!)}>
                    {c.replyCount ? t("Reply ({n})", { n: c.replyCount }) : t("Reply")}
                  </button>
                ) : null}
                {c.id && (c.createdBy === me.id || perms?.removeComments) ? (
                  <button
                    className="link small danger-text"
                    onClick={async () => {
                      if (!await askConfirm(t("Delete your reply?"))) return;
                      try {
                        await deleteForumComment(groupId, categoryId, post.id, c.id!);
                        refresh();
                      } catch (e) {
                        toast(e instanceof Error ? e.message : t("Couldn't delete it."), "error");
                      }
                    }}
                  >
                    {t("Delete")}
                  </button>
                ) : null}
              </div>
              {replyTo === c.id && canReply ? (
                <Composer
                  autoFocus
                  placeholder={c.creatorInfo?.displayName ? t("Reply to {name}", { name: c.creatorInfo.displayName }) : t("Reply to this comment")}
                  submitLabel={t("Reply")}
                  onCancel={() => setReplyTo(null)}
                  onSubmit={(body) => createForumComment(groupId, categoryId, post.id, body, c.id).then(() => (setReplyTo(null), refresh()))}
                />
              ) : null}
            </div>
          </div>
        ))}
        {!q.isLoading && !rows.length ? <p className="muted small">{t("No replies yet.")}</p> : null}
        {q.hasNextPage ? (
          <button className="btn btn-secondary btn-small" onClick={() => q.fetchNextPage()}>
            {t("Show more")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Posts({ groupId, compactView, onSeeAll, ownerId, member = false }: { groupId: number; compactView?: boolean; onSeeAll?: () => void; ownerId?: number; member?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useUi();
  const [creating, setCreating] = useState(false);
  const permsQ = useQuery({ queryKey: ["forumPerms", groupId, member], queryFn: () => forumPerms(groupId), retry: false, staleTime: 60_000 });
  const perms: ForumPerms = permsQ.data ?? { member, createPosts: false, createComments: false, removeComments: false };
  const cats = useQuery({ queryKey: ["forumCats", groupId], queryFn: () => forumCategories(groupId), retry: false });
  const [cat, setCat] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<ForumPost | null>(null);
  const categoryId = cat ?? cats.data?.[0]?.id ?? null;
  const posts = useInfiniteQuery({
    queryKey: ["forumPosts", groupId, categoryId],
    queryFn: ({ pageParam }) => forumPosts(groupId, categoryId!, pageParam),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor || undefined,
    enabled: !!categoryId,
  });
  const pinned = useQuery({ queryKey: ["forumPinned", groupId, categoryId], queryFn: () => forumPinned(groupId, categoryId!), enabled: !!categoryId });
  if (cats.isLoading) return <SkeletonRows count={4} avatar={22} />;
  if (cats.error) return <p className="muted">{/401|403/.test(String(cats.error)) ? t("Posts aren't available for this community (members only).") : t("Posts aren't available for this community.")}</p>;
  if (!cats.data?.length) return <p className="muted">{t("This community hasn't set up posts.")}</p>;
  if (open && categoryId) return <PostThread groupId={groupId} categoryId={categoryId} post={open} ownerId={ownerId} perms={perms} onBack={() => setOpen(null)} />;
  const pinnedIds = new Set((pinned.data ?? []).map((p) => p.id));
  const list = [...(pinned.data ?? []).map((p) => ({ ...p, isPinned: true })), ...(posts.data?.pages.flatMap((p) => p.posts) ?? []).filter((p) => !pinnedIds.has(p.id))].filter(
    (p) => !filter || `${p.name} ${richText(p.firstComment?.content)}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const shown = compactView ? list.slice(0, 4) : list;
  const current = cats.data.find((c) => c.id === categoryId);
  return (
    <div className="posts">
      {!compactView ? (
        <>
          <div className="row-between">
            <div className="chip-row hscroll" style={{ margin: 0 }}>
              {cats.data.map((c) => (
                <button key={c.id} className={`chip ${c.id === categoryId ? "on-solid" : ""}`} onClick={() => setCat(c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
            <div className="filter post-search">
              <Icon name="magnifying-glass" size={14} />
              <input placeholder={t("Search posts")} value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
          </div>
          <div className="row-between" style={{ margin: "14px 0 6px" }}>
            <h3 className="sub-title" style={{ margin: 0 }}>
              {current?.name}
            </h3>
            {member ? (
              <button className="btn btn-primary btn-small" disabled={!perms.createPosts} title={perms.createPosts ? undefined : noPost()} onClick={() => setCreating((c) => !c)}>
                {creating ? t("Close") : t("Create post")}
              </button>
            ) : null}
          </div>
          {creating && categoryId && perms.createPosts ? (
            <Composer
              withTitle
              autoFocus
              placeholder={t("What's on your mind?")}
              submitLabel={t("Post")}
              onCancel={() => setCreating(false)}
              onSubmit={async (body, title) => {
                await createForumPost(groupId, categoryId, title, body);
                setCreating(false);
                toast(t("Posted."));
                qc.invalidateQueries({ queryKey: ["forumPosts", groupId, categoryId] });
              }}
            />
          ) : null}
        </>
      ) : (
        <div className="row-between">
          <h3 className="sub-title">{t("Top Community Posts")}</h3>
          {onSeeAll ? (
            <button className="link small" onClick={onSeeAll}>
              {t("See All →")}
            </button>
          ) : null}
        </div>
      )}
      {posts.isLoading ? <SkeletonRows count={4} avatar={22} /> : null}
      {shown.map((p) => (
        <PostCard key={p.id} p={p} ownerId={ownerId} groupId={groupId} categoryId={categoryId ?? undefined} perms={perms} onOpen={() => setOpen(p)} />
      ))}
      {!posts.isLoading && !shown.length ? <p className="muted">{t("No posts yet.")}</p> : null}
      {!compactView && posts.hasNextPage ? (
        <button className="btn btn-secondary btn-small" onClick={() => posts.fetchNextPage()} disabled={posts.isFetchingNextPage}>
          {posts.isFetchingNextPage ? t("Loading...") : t("Load more")}
        </button>
      ) : null}
    </div>
  );
}

function GroupList({ title, rows }: { title: string; rows: RelatedGroup[] }) {
  const { go } = useNav();
  if (!rows.length) return null;
  return (
    <section className="shelf">
      <SectionHeader title={t("{title} ({n})", { title, n: rows.length })} />
      <div className="community-grid">
        {rows.map((g) => (
          <button key={g.id} className="community-card" onClick={() => go({ name: "community", groupId: g.id })}>
            <div className="community-card-art">
              <Thumb type="GroupIcon" id={g.id} className="square" />
            </div>
            <div className="game-name two-line">
              {g.name} {g.hasVerifiedBadge ? <Verified size={12} /> : null}
            </div>
            <div className="muted small">{t("{n} Members", { n: compact(g.memberCount) })}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

function StoreGrid({ items, hasMore, loadingMore, onMore }: { items: CatalogItem[]; hasMore: boolean; loadingMore: boolean; onMore: () => void }) {
  const preview = useItemPreview();
  return (
    <>
      <div className="item-grid">
        {items.map((it, i) => (
          <button
            key={`${it.itemType}${it.id}`}
            className="item card-in"
            style={{ animationDelay: `${Math.min(i % 30, 20) * 18}ms` }}
            onClick={() => preview({ itemType: it.itemType, id: it.id })}
          >
            <Thumb type={it.itemType === "Bundle" ? "BundleThumbnail" : "Asset"} id={it.id} className="square" />
            <div className="item-name">{it.name}</div>
            <div className="item-price">
              {(it.lowestPrice ?? it.price) === 0 || it.priceStatus === "Free" ? t("Free") : (it.lowestPrice ?? it.price) != null ? <Robux amount={it.lowestPrice ?? it.price} size={13} /> : <span className="muted">{t("Off sale")}</span>}
            </div>
          </button>
        ))}
      </div>
      {hasMore ? (
        <button className="btn btn-secondary load-more" onClick={onMore} disabled={loadingMore}>
          {loadingMore ? t("Loading…") : t("Load more")}
        </button>
      ) : null}
    </>
  );
}

function Affiliates({ groupId }: { groupId: number }) {
  const allies = useQuery({ queryKey: ["allies", groupId], queryFn: () => groupRelations(groupId, "allies") });
  if (allies.isLoading) return <SkeletonRows count={4} avatar={48} />;
  if (!allies.data?.length) return <p className="muted center-text">{t("This community has no affiliates yet.")}</p>;
  return <GroupList title={t("Affiliates")} rows={allies.data} />;
}

function About({ groupId, created }: { groupId: number; created?: string }) {
  const enemies = useQuery({ queryKey: ["enemies", groupId], queryFn: () => groupRelations(groupId, "enemies") });
  const links = useQuery({ queryKey: ["groupLinks", groupId], queryFn: () => groupSocialLinks(groupId) });
  const funds = useQuery({ queryKey: ["groupFunds", groupId], queryFn: () => groupFunds(groupId) });
  const names = useQuery({ queryKey: ["groupNames", groupId], queryFn: () => groupNameHistory(groupId) });
  const roles = useQuery({ queryKey: ["groupRoles", groupId], queryFn: () => groupRoles(groupId) });
  return (
    <div>
      {links.data?.length ? (
        <section className="shelf">
          <SectionHeader title={t("Social Links")} />
          <div className="social-row">
            {links.data.map((l) => (
              <button key={l.id} className="social-link" onClick={() => win.openExternal(l.url)} title={l.url}>
                <span className="social-circle">
                  <SocialIcon type={l.type} />
                </span>
                <span>{l.title || l.type}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {funds.data != null ? (
        <section className="shelf">
          <SectionHeader title={t("Funds")} />
          <div className="funds-card">
            <Robux amount={funds.data} size={20} />
            <span className="muted small">{t("Group funds (visible to your role)")}</span>
          </div>
        </section>
      ) : null}
      {roles.data?.length ? (
        <section className="shelf">
          <SectionHeader title={t("Roles")} />
          <div className="info-table">
            {roles.data.map((r) => (
              <div key={r.id} className="info-row">
                <span className="info-label">
                  {r.name} <span className="muted small">· {t("Rank {rank}", { rank: r.rank })}</span>
                </span>
                <span className="info-value">{t("{n} members", { n: thousands(r.memberCount) })}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <GroupList title={t("Enemies")} rows={enemies.data ?? []} />
      {names.data?.length ? (
        <section className="shelf">
          <SectionHeader title={t("Previous names")} />
          <p className="muted">{names.data.map((n) => `${n.name} (${longDate(n.created)})`).join(" · ")}</p>
        </section>
      ) : null}
      {created ? <p className="muted small">{t("Created {date}", { date: longDate(created) })}</p> : null}
    </div>
  );
}

function MoreMenu({ groupId, member, isOwner, isPrimary, onLeave, onMakePrimary }: { groupId: number; member: boolean; isOwner: boolean; isPrimary: boolean; onLeave: () => void; onMakePrimary: () => void }) {
  const { toast } = useUi();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);
  const copy = async () => {
    setOpen(false);
    try {
      await navigator.clipboard.writeText(`https://www.roblox.com/communities/${groupId}`);
      toast(t("Link copied."));
    } catch {
      toast(t("Couldn't copy the link."), "error");
    }
  };
  return (
    <div className="menu-anchor" ref={ref}>
      <button className="square-btn" onClick={() => setOpen((o) => !o)} aria-label={t("More")}>
        <Icon name="dots-horizontal" size={20} />
      </button>
      {open ? (
        <div className="menu">
          {member && !isPrimary ? <button onClick={() => (setOpen(false), onMakePrimary())}>{t("Make Primary")}</button> : null}
          {member && !isOwner ? (
            <button className="danger" onClick={() => (setOpen(false), onLeave())}>
              {t("Leave Community")}
            </button>
          ) : null}
          <button onClick={copy}>{t("Copy link")}</button>
          <button onClick={() => (setOpen(false), win.openRobloxWeb(`https://www.roblox.com/abusereport/group?id=${groupId}`, t("Report")))}>{t("Report abuse")}</button>
          <button onClick={() => (setOpen(false), win.openExternal(`https://www.roblox.com/communities/${groupId}`))}>{t("View on Roblox")}</button>
        </div>
      ) : null}
    </div>
  );
}

/** The communities sidebar stays put; only the community itself changes (no whole-page reload). */
export function Community({ groupId, initialTab }: { groupId: number; initialTab?: string }) {
  return (
    <div className="community-layout">
      <Sidebar current={groupId} />
      <CommunityBody key={groupId} groupId={groupId} initialTab={initialTab} />
    </div>
  );
}

function CommunityBody({ groupId, initialTab }: { groupId: number; initialTab?: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const { go } = useNav();
  const { toast } = useUi();
  const { replace } = useNav();
  const [tab, setTabState] = useState<CommunityTab>((initialTab as CommunityTab) || "home");
  const setTab = (tb: CommunityTab) => {
    setTabState(tb);
    replace({ name: "community", groupId, tab: tb });
  };
  const primary = useQuery({ queryKey: ["primaryGroup", me.id], queryFn: () => primaryGroup(me.id) });
  const [membersOpen, setMembersOpen] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const [annCount, setAnnCount] = useState(1);
  const profile = useQuery({ queryKey: ["communityProfile", groupId], queryFn: () => communityProfile(groupId), staleTime: 10 * 60_000 });
  const cover = useQuery({
    queryKey: ["coverPhoto", profile.data?.coverPhotoId],
    queryFn: () => backgroundImage(profile.data!.coverPhotoId!),
    enabled: !!profile.data?.coverPhotoId,
    staleTime: 60 * 60_000,
  });
  const [busy, setBusy] = useState(false);
  const info = useQuery({ queryKey: ["group", groupId], queryFn: () => group(groupId) });
  const membership = useQuery({ queryKey: ["membership", groupId], queryFn: () => groupMembership(groupId), retry: false });
  // Public fallback for your role/rank (works even when the membership call is refused).
  const mine = useQuery({ queryKey: ["communities", me.id], queryFn: () => communities(me.id) });
  const roles = useQuery({ queryKey: ["groupRoles", groupId], queryFn: () => groupRoles(groupId) });
  const games = useQuery({ queryKey: ["groupGames", groupId], queryFn: () => groupGames(groupId) });
  const announcements = useQuery({ queryKey: ["groupAnnouncements", groupId], queryFn: () => groupAnnouncements(groupId) });
  const events = useQuery({ queryKey: ["groupEvents", groupId], queryFn: () => groupEvents(groupId) });
  const store = useInfiniteQuery({
    queryKey: ["groupStore", groupId],
    queryFn: ({ pageParam }) => groupStore(groupId, pageParam),
    initialPageParam: "",
    getNextPageParam: (l) => l.nextCursor || undefined,
    enabled: tab === "store",
  });
  const storeItems = store.data?.pages.flatMap((pg) => pg.items) ?? [];
  const sortedRoles = useMemo(() => roles.data ?? [], [roles.data]);


  if (info.isLoading) return <div className="community-main"><SkeletonPage hero={140} /></div>;
  if (info.error || !info.data) return <div className="community-main"><ErrorState error={info.error} retry={() => info.refetch()} /></div>;
  const g = info.data;
  const listed = mine.data?.find((c) => c.id === groupId);
  const m = membership.data ?? (listed ? { member: true, pending: false, role: listed.role, rank: listed.rank } : mine.isFetched ? { member: false, pending: false, role: "", rank: 0 } : undefined);
  const isMember = !!m?.member;
  const isOwner = !!m && m.rank === 255;
  // Roblox's own tab list for this community (About → Home, Forums → Posts), plus Ruby's About extras.
  const apiTabs = profile.data?.tabs ?? [];
  const has = (name: string) => !apiTabs.length || apiTabs.includes(name);
  const tabs: CommunityTab[] = [
    "home",
    ...(has("Forums") ? (["posts"] as const) : []),
    // Like the app: the Events tab only appears when there are events to show.
    ...(events.data?.length ? (["events"] as const) : []),
    ...(has("Store") ? (["store"] as const) : []),
    ...(has("Affiliates") ? (["affiliates"] as const) : []),
    "about" as const,
  ];

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      await qc.invalidateQueries({ queryKey: ["membership", groupId] });
      qc.invalidateQueries({ queryKey: ["communities", me.id] });
      qc.invalidateQueries({ queryKey: ["group", groupId] });
    } catch (e) {
      toast(friendlyError(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const leave = async () => {
    if (await askConfirm(t("Leave {name}?", { name: g.name }))) run(() => leaveGroup(groupId, me.id), t("You left {name}.", { name: g.name }));
  };

  return (
    <>
      <div className="community-main">
        {cover.data ? <div className="community-cover" style={{ backgroundImage: `url("${cover.data}")` }} /> : null}
        <div className={`community-header ${cover.data ? "on-cover" : ""}`}>
          <Thumb type="GroupIcon" id={groupId} size="420x420" className="community-icon" />
          <div className="community-meta">
            <h1 className="page-title">
              {g.name} {g.hasVerifiedBadge ? <Verified size={18} /> : null}
            </h1>
            {g.owner ? (
              <button className="link community-by" onClick={() => go({ name: "profile", userId: g.owner!.userId })}>
                {t("By {name}", { name: g.owner.displayName })}
              </button>
            ) : (
              <span className="muted">{t("No owner")}</span>
            )}
          </div>
          <div className="community-actions">
            {m && !m.member ? (
              m.pending ? (
                <button className="btn btn-secondary" disabled={busy} onClick={() => run(() => cancelGroupRequest(groupId, me.id), t("Join request cancelled."))}>
                  {t("Cancel request")}
                </button>
              ) : (
                <button className="btn btn-primary" disabled={busy} onClick={() => run(() => joinGroup(groupId), t("Joined {name}.", { name: g.name }))}>
                  {t("Join Community")}
                </button>
              )
            ) : null}
            <MoreMenu
              groupId={groupId}
              member={!!m?.member}
              isOwner={isOwner}
              isPrimary={primary.data?.group.id === groupId}
              onLeave={leave}
              onMakePrimary={() =>
                run(async () => {
                  await setPrimaryGroup(groupId);
                  await qc.invalidateQueries({ queryKey: ["primaryGroup", me.id] });
                }, t("{name} is now your primary community.", { name: g.name }))
              }
            />
          </div>
        </div>

        <div className="chip-row">
          <button className="chip" onClick={() => setMembersOpen(true)} disabled={!sortedRoles.length}>
            <Icon name="two-people" size={14} /> {t("{n} Members", { n: thousands(g.memberCount) })}
          </button>
          {m?.member ? (
            <span className="chip rank-chip" title={t("Rank {rank}", { rank: m.rank })}>
              {t("{role} Rank", { role: m.role })}
            </span>
          ) : null}
        </div>
        {g.description ? (
          <div className="community-desc">
            <p className={`description ${descOpen ? "" : "clamp"}`}>{g.description}</p>
            {g.description.length > 120 ? (
              <button className="link more-toggle" onClick={() => setDescOpen((o) => !o)}>
                {descOpen ? t("less") : t("more")}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="tabs community-tabs">
          {tabs.map((tb) => (
            <button key={tb} className={tab === tb ? "active" : ""} onClick={() => setTab(tb)}>
              {tabLabel(tb)}
            </button>
          ))}
        </div>

        {tab === "home" ? (
          <>
            <section className="shelf">
              <div className="row-between">
                <h3 className="sub-title">{t("Announcements")}</h3>
                <Icon name="bell" size={18} />
              </div>
              {announcements.isLoading ? (
                <Skel h={110} r={12} />
              ) : announcements.data?.length ? (
                <>
                  {announcements.data.slice(0, annCount).map((a) => (
                    <AnnouncementCard key={a.id} a={a} ownerId={g.owner?.userId} />
                  ))}
                  {announcements.data.length > annCount ? (
                    <button className="link see-more" onClick={() => setAnnCount((n) => n + 5)}>
                      {t("See more posts")} <Icon name="chevron-small-right" size={16} />
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="muted center-text">{t("No announcements yet...")}</p>
              )}
            </section>
            <section className="shelf">
              <Posts groupId={groupId} compactView ownerId={g.owner?.userId} member={isMember} onSeeAll={() => setTab("posts")} />
            </section>
            {events.data?.length ? (
              <section className="shelf">
                <SectionHeader title={t("Events")} />
                {events.data.map((e) => (
                  <div key={e.id} className="event-row">
                    <b>{e.title}</b>
                    <span className="muted small">{e.eventTime?.startUtc ? fmtDate(e.eventTime.startUtc, { dateStyle: "short", timeStyle: "medium" }) : ""}</span>
                  </div>
                ))}
              </section>
            ) : null}
            {games.data?.length ? (
              <section className="shelf">
                <SectionHeader title={t("Experiences")} />
                <TileRow games={games.data} />
              </section>
            ) : null}
          </>
        ) : tab === "posts" ? (
          <Posts groupId={groupId} ownerId={g.owner?.userId} member={isMember} />
        ) : tab === "events" ? (
          events.data?.length ? (
            events.data.map((e) => (
              <div key={e.id} className="event-row">
                <b>{e.title}</b>
                <span className="muted small">{e.eventTime?.startUtc ? fmtDate(e.eventTime.startUtc, { dateStyle: "short", timeStyle: "medium" }) : ""}</span>
              </div>
            ))
          ) : (
            <p className="muted center-text">{t("No upcoming events.")}</p>
          )
        ) : tab === "affiliates" ? (
          <Affiliates groupId={groupId} />
        ) : tab === "store" ? (
          store.isLoading ? (
            <SkeletonGrid count={12} />
          ) : storeItems.length ? (
            <StoreGrid items={storeItems} hasMore={!!store.hasNextPage} loadingMore={store.isFetchingNextPage} onMore={() => store.fetchNextPage()} />
          ) : (
            <p className="muted">{t("This community isn't selling anything.")}</p>
          )
        ) : (
          <About groupId={groupId} />
        )}
      </div>
      {membersOpen && sortedRoles.length ? <MembersModal groupId={groupId} roles={sortedRoles} onClose={() => setMembersOpen(false)} /> : null}
    </>
  );
}
