import { askConfirm, askText } from "../components/Confirm";
import { useAlias, useAliases, useFavorites, useSetAlias } from "../lib/friendsExtra";
import { BadgePopup } from "../components/InfoPopup";
import { friendsSince } from "../lib/social";
import { SocialIcon } from "../components/SocialIcon";
import { peopleYouMayKnow } from "../lib/extras";
import { usersByIds } from "../lib/api";
import { collectibles } from "../lib/trades";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  acceptRequest,
  acceptTrustedFriendRequest,
  blockUser,
  isBlocked,
  unblockUser,
  communities,
  connections,
  currentlyWearing,
  declineRequest,
  follow,
  followerCount,
  followingCount,
  friendCount,
  friendRequests,
  friendStatus,
  isFollowing,
  presences,
  removeTrustedFriend,
  sendFriendRequest,
  sendTrustedFriendRequest,
  trustedStatus,
  unfollow,
  unfriend,
  universeFromPlace,
  user,
  userStore,
  type Community,
  type Friend,
} from "../lib/api";
import { compact, longDate } from "../lib/format";
import { win } from "../lib/ipc";
import { useMe, useNav, useUi } from "../app/store";
import { Empty, ErrorState, Headshot, Icon, Robux, SectionHeader, SkeletonGrid, SkeletonPage, SkeletonRows, Thumb, Verified } from "../components/ui";
import { AvatarRig, useBackdrop } from "../components/Avatar3DLazy";
import { InventoryBrowser } from "../components/InventoryBrowser";
import { SendRobuxDialog } from "../components/SendRobux";
import { useItemPreview } from "../components/ItemPreview";
import { useFriends } from "./Home";
import { TileRow } from "../components/games";
import { favoriteGames, userGames } from "../lib/api";
import { profileHeader } from "../lib/social";
import { canViewInventory, primaryGroup, robloxBadges, userBadges, userSocialLinks, usernameHistory } from "../lib/social";
import { hasPremium } from "../lib/account";
import { t, fmtDate } from "../lib/i18n";

const statusLabel = (s: number) => [t("Offline"), t("Online"), t("In experience"), t("In Studio")][s];

/** Turn Roblox's terse errors into something a person can act on. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/challenge|captcha|verif/i.test(msg)) return t("Roblox wants a quick verification for this. Do it once on roblox.com, then it'll work here.");
  if (/flood|too many|429/i.test(msg)) return t("You're doing that too fast. Wait a moment and try again.");
  return msg;
}

/** A horizontal row of items; tapping one opens the quick-view popup (Roblox-app style). */
export function ItemRow({ items }: { items: { id: number; name: string; price: number | null; itemType?: "Asset" | "Bundle" }[] }) {
  const preview = useItemPreview();
  return (
    <div className="wearing-row hscroll">
      {items.map((w) => (
        <button key={`${w.itemType ?? "Asset"}${w.id}`} className="wearing-item" onClick={() => preview({ itemType: w.itemType ?? "Asset", id: w.id })} title={w.name}>
          <Thumb type={w.itemType === "Bundle" ? "BundleThumbnail" : "Asset"} id={w.id} className="square" />
          <div className="item-name">{w.name}</div>
          {w.price != null ? (
            <div className="item-price">{w.price === 0 ? t("Free") : <Robux amount={w.price} size={14} />}</div>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function ProfileActions({ userId, displayName, username, inGame, onJoin }: { userId: number; displayName: string; username: string; inGame: boolean; onJoin: () => void }) {
  const me = useMe();
  const favs = useFavorites(me.id);
  const saveAlias = useSetAlias();
  const currentAlias = useAlias(userId);
  const { go } = useNav();
  const { toast } = useUi();
  const qc = useQueryClient();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fs = useQuery({ queryKey: ["friendStatus", userId], queryFn: () => friendStatus(me.id, userId) });
  const fol = useQuery({ queryKey: ["isFollowing", userId], queryFn: () => isFollowing(userId) });
  const ts = useQuery({ queryKey: ["trustedStatus", userId], queryFn: () => trustedStatus(userId), enabled: fs.data === "Friends" });

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const run = async (action: () => Promise<unknown>, ok: string, keys: unknown[][]) => {
    setMenu(false);
    try {
      await action();
      toast(ok);
      keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    } catch (e) {
      toast(friendlyError(e), "error");
    }
  };
  const statusKeys = [["friendStatus", userId], ["trustedStatus", userId], ["counts", userId], ["friends"], ["isBlocked", userId]];
  const [sending, setSending] = useState(false);
  const blocked = useQuery({ queryKey: ["isBlocked", userId], queryFn: () => isBlocked(userId), enabled: userId !== me.id, retry: false });

  const friendButton = () => {
    switch (fs.data) {
      case "NotFriends":
        return (
          <button className="btn btn-secondary" onClick={() => run(() => sendFriendRequest(userId), t("Friend request sent."), statusKeys)}>
            <Icon name="person-plus" size={18} /> {t("Add Friend")}
          </button>
        );
      case "RequestSent":
        return (
          <button className="btn btn-secondary" disabled>
            {t("Request Sent")}
          </button>
        );
      case "RequestReceived":
        return (
          <button className="btn btn-primary" onClick={() => run(() => acceptRequest(userId), t("You and {displayName} are now friends.", { displayName }), statusKeys)}>
            {t("Accept Friend Request")}
          </button>
        );
      default:
        return null;
    }
  };

  return (
    <div className="profile-actions">
      {inGame ? (
        <button className="btn btn-primary" onClick={onJoin}>
          {t("Join")}
        </button>
      ) : null}
      {friendButton()}
      <button className="btn btn-secondary" onClick={() => go({ name: "chat", withUserId: userId })}>
        {t("Chat")}
      </button>
      {fs.data === "Friends" ? (
        <button
          className={`icon-btn fav-btn ${favs.isFav(userId) ? "on" : ""}`}
          onClick={() => {
            favs.toggle(userId);
            toast(favs.isFav(userId) ? t("Removed {displayName} from favorites.", { displayName }) : t("Added {displayName} to favorites.", { displayName }));
          }}
          aria-pressed={favs.isFav(userId)}
          title={favs.isFav(userId) ? t("Remove from favorites") : t("Add to favorites")}
        >
          <Icon name="star" size={20} />
        </button>
      ) : null}
      <div className="menu-anchor" ref={menuRef}>
        <button className="icon-btn more-btn" onClick={() => setMenu((m) => !m)} aria-label={t("More")}>
          <Icon name="three-bars-horizontal" size={20} />
        </button>
        {menu ? (
          <div className="menu">
            {fol.data ? (
              <button onClick={() => run(() => unfollow(userId), t("Unfollowed {displayName}.", { displayName }), [["isFollowing", userId], ["counts", userId]])}>{t("Unfollow")}</button>
            ) : (
              <button onClick={() => run(() => follow(userId), t("Following {displayName}.", { displayName }), [["isFollowing", userId], ["counts", userId]])}>{t("Follow")}</button>
            )}
            {fs.data === "Friends" ? (
              <>
                {ts.data === "TrustedFriends" ? (
                  <button onClick={() => run(() => removeTrustedFriend(userId), t("Removed trusted friend."), statusKeys)}>{t("Remove trusted friend")}</button>
                ) : ts.data === "RequestReceived" ? (
                  <button onClick={() => run(() => acceptTrustedFriendRequest(userId), t("{displayName} is now a trusted friend.", { displayName }), statusKeys)}>
                    {t("Accept trusted friend")}
                  </button>
                ) : ts.data === "RequestSent" ? (
                  <button disabled>{t("Trusted friend request sent")}</button>
                ) : (
                  <button onClick={() => run(() => sendTrustedFriendRequest(userId), t("Trusted friend request sent."), statusKeys)}>
                    {t("Add trusted friend")}
                  </button>
                )}
                <button
                  onClick={async () => {
                    setMenu(false);
                    const next = await askText(t("Nickname for {displayName} (only you see it). Leave empty to remove.", { displayName }), currentAlias.data ?? "");
                    if (next == null) return;
                    try {
                      await saveAlias(userId, next.slice(0, 20));
                      toast(next.trim() ? t("Nickname saved.") : t("Nickname removed."));
                    } catch (e) {
                      toast(friendlyError(e), "error");
                    }
                  }}
                >
                  {currentAlias.data ? t("Change nickname") : t("Set nickname")}
                </button>
                <button
                  className="danger"
                  onClick={async () => {
                    if (await askConfirm(t("Unfriend {displayName}?", { displayName }))) run(() => unfriend(userId), t("Unfriended {displayName}.", { displayName }), statusKeys);
                  }}
                >
                  {t("Unfriend")}
                </button>
              </>
            ) : null}
            {blocked.data ? (
              <button onClick={() => run(() => unblockUser(userId), t("Unblocked {displayName}.", { displayName }), statusKeys)}>{t("Unblock")}</button>
            ) : (
              <button
                className="danger"
                onClick={async () => {
                  if (await askConfirm(t("Block {displayName}? They won't be able to message you, join you or see you in games.", { displayName })))
                    run(() => blockUser(userId), t("Blocked {displayName}.", { displayName }), statusKeys);
                }}
              >
                {t("Block")}
              </button>
            )}
            <button onClick={() => (setMenu(false), setSending(true))}>{t("Send Robux")}</button>
            <button onClick={() => (setMenu(false), go({ name: "trade", userId }))}>{t("Trade items")}</button>
            <button onClick={() => win.openRobloxWeb(`https://www.roblox.com/abusereport/userprofile?id=${userId}`, "Report")}>{t("Report")}</button>
          </div>
        ) : null}
      </div>
      {sending ? <SendRobuxDialog userId={userId} displayName={displayName} name={username} onClose={() => setSending(false)} /> : null}
    </div>
  );
}

export function Profile({ userId }: { userId: number }) {
  const alias = useAlias(userId);
  const me = useMe();
  const { go } = useNav();
  const { play } = useUi();
  const [bioOpen, setBioOpen] = useState(false);
  // Profiles open on the animated 3D avatar by default.
  const [show3d, setShow3d] = useState(true);
  const info = useQuery({ queryKey: ["user", userId], queryFn: () => user(userId) });
  const store = useQuery({ queryKey: ["userStore", userId], queryFn: () => userStore(userId) });
  const counts = useQuery({
    queryKey: ["counts", userId],
    queryFn: async () => {
      const [f, fo, fi] = await Promise.all([
        friendCount(userId),
        followerCount(userId).catch(() => null),
        followingCount(userId).catch(() => null),
      ]);
      return { friends: f, followers: fo, following: fi };
    },
  });
  const pres = useQuery({ queryKey: ["presence", userId], queryFn: async () => (await presences([userId])).get(userId), refetchInterval: 30_000 });
  const wearing = useQuery({ queryKey: ["wearing", userId], queryFn: () => currentlyWearing(userId) });
  const theirFriends = useFriends(userId);
  const groups = useQuery({ queryKey: ["communities", userId], queryFn: () => communities(userId) });
  const primary = useQuery({ queryKey: ["primaryGroup", userId], queryFn: () => primaryGroup(userId) });
  // Their primary community leads the row as a normal card (tagged "Primary"), like Roblox.
  const primaryFirst = [...(groups.data ?? [])].sort((x, y) => Number(y.id === primary.data?.group.id) - Number(x.id === primary.data?.group.id));
  const backdrop = useBackdrop(userId);

  if (info.isLoading) return <SkeletonPage hero={240} />;
  if (info.error || !info.data) return <ErrorState error={info.error} retry={() => info.refetch()} />;
  const u = info.data;
  const p = pres.data;
  const isMe = userId === me.id;
  const inGame = p?.userPresenceType === 2 && (p.placeId || p.rootPlaceId);

  const joinThem = async () => {
    if (!p?.placeId && !p?.rootPlaceId) return;
    await play(p.placeId || p.rootPlaceId!, p.lastLocation || "experience", p.gameId ?? undefined);
  };
  const viewGame = async () => {
    const uni = p?.universeId || (p?.rootPlaceId ? await universeFromPlace(p.rootPlaceId) : 0);
    if (uni) go({ name: "game", universeId: uni });
  };
  const bioLong = (u.description || "").length > 140;

  return (
    <div className="page profile-page">
      <div
        className={`profile-banner ${show3d ? "is-3d" : ""} ${backdrop ? "has-backdrop" : ""}`}
        style={backdrop ? { backgroundImage: `url("${backdrop}")` } : undefined}
      >
        <div className="profile-banner-render">{show3d ? <AvatarRig userId={userId} self={userId === me.id} /> : <Thumb type="Avatar" id={userId} size="420x420" />}</div>
        <button className={`banner-3d ${show3d ? "on" : ""}`} onClick={() => setShow3d((s) => !s)}>
          {show3d ? "2D" : "3D"}
        </button>
        {inGame ? (
          <button className="presence-card" onClick={viewGame}>
            <Thumb type="GameIcon" id={p!.universeId ?? undefined} className="square" />
            <div>
              <div className="presence-card-name">{p!.lastLocation || t("In experience")}</div>
              <div className="muted small">{t("In experience")}</div>
            </div>
          </button>
        ) : null}
      </div>

      <div className="profile-head">
        <Headshot userId={userId} size={110} presence={p?.userPresenceType} className="profile-avatar" />
        <div className="profile-id">
          <h1>
            {alias.data || u.displayName} {u.hasVerifiedBadge ? <Verified size={18} /> : null}
            <NameBadges userId={userId} />
          </h1>
          <div className="muted">{alias.data ? `${u.displayName} · @${u.name}` : `@${u.name}`}</div>
        </div>
        {isMe ? (
          <div className="profile-actions">
            <button className="btn btn-secondary" onClick={() => go({ name: "editProfile" })}>
              {t("Edit profile")}
            </button>
            <button className="btn btn-secondary" onClick={() => go({ name: "avatar", tab: "customize" })}>
              {t("Edit avatar")}
            </button>
          </div>
        ) : (
          <ProfileActions userId={userId} displayName={u.displayName} username={u.name} inGame={!!inGame} onJoin={joinThem} />
        )}
      </div>

      <div className="count-pills">
        {!isMe ? <MutualsPill userId={userId} theirs={theirFriends.data} /> : null}
        <button className="count-pill" onClick={() => go({ name: "connections", userId, kind: "friends" })}>
          <b>{compact(counts.data?.friends)}</b> {t("Friends")}
        </button>
        <button className="count-pill" onClick={() => go({ name: "connections", userId, kind: "followers" })}>
          <b>{compact(counts.data?.followers)}</b> {t("Followers")}
        </button>
        <button className="count-pill" onClick={() => go({ name: "connections", userId, kind: "following" })}>
          <b>{compact(counts.data?.following)}</b> {t("Following")}
        </button>
        <RapPill userId={userId} />
        {!isMe ? <FriendsSince userId={userId} /> : null}
      </div>

      {u.description ? (
        <div className="profile-bio">
          <p className={`description ${bioOpen || !bioLong ? "" : "clamp"}`}>{u.description}</p>
          {bioLong ? (
            <button className="link more-toggle" onClick={() => setBioOpen((o) => !o)}>
              {bioOpen ? t("less") : t("more")}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="muted small joined">{t("Joined {date}", { date: longDate(u.created) })}</div>

      {wearing.data?.length ? (
        <section className="shelf">
          <SectionHeader title={t("Currently Wearing")} />
          <ItemRow items={wearing.data} />
        </section>
      ) : null}

      {store.data?.length ? (
        <section className="shelf">
          <SectionHeader title={t("Shop")} />
          <ItemRow items={store.data.map((s) => ({ id: s.id, name: s.name, price: s.lowestPrice ?? s.price ?? null, itemType: s.itemType }))} />
        </section>
      ) : null}

      <ProfileGames userId={userId} />

      {theirFriends.data?.length ? (
        <section className="shelf">
          <SectionHeader title={t("Friends ({n})", { n: theirFriends.data.length })} onMore={() => go({ name: "connections", userId, kind: "friends" })} />
          <div className="friend-row hscroll">
            {theirFriends.data.slice(0, 30).map((f) => (
              <button key={f.id} className="friend-bubble small" onClick={() => go({ name: "profile", userId: f.id })}>
                <Headshot userId={f.id} size={80} presence={f.presence?.userPresenceType} />
                <div className="friend-name">{f.displayName}</div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {groups.data?.length ? (
        <section className="shelf">
          <SectionHeader title={t("Communities ({n})", { n: groups.data.length })} onMore={isMe ? () => go({ name: "communities" }) : undefined} />
          <CommunityGrid items={primaryFirst} row primaryId={primary.data?.group.id} />
        </section>
      ) : null}

      <ProfileCollectibles userId={userId} />
      <ProfileBadges userId={userId} />
      <ProfileExtras userId={userId} created={u.created} />
    </div>
  );
}

/** Plus and Roblox-admin marks after a name (Verified is shown separately). */
function NameBadges({ userId }: { userId: number }) {
  // The same header roblox.com uses: works for anyone, not just yourself.
  const head = useQuery({ queryKey: ["profileHeader", userId], queryFn: () => profileHeader(userId), staleTime: 10 * 60_000 });
  const plusSelf = useQuery({ queryKey: ["hasPlus", userId], queryFn: () => hasPremium(userId), staleTime: 10 * 60_000, enabled: head.isError });
  const plus = head.data ? head.data.isRobloxPlus : !!plusSelf.data;
  const rb = useQuery({ queryKey: ["robloxBadges", userId], queryFn: () => robloxBadges(userId), staleTime: 10 * 60_000, enabled: !!head.isError });
  const admin = head.data ? head.data.isRobloxAdmin : (rb.data ?? []).some((b) => /administrator/i.test(b.name));
  return (
    <>
      {plus ? (
        <span className="name-badge plus" title={t("Roblox Plus")}>
          <Icon name="roblox-plus" size={18} />
        </span>
      ) : null}
      {admin ? (
        <span className="name-badge admin" title={t("Roblox Administrator")}>
          <Icon name="crown" size={16} />
        </span>
      ) : null}
    </>
  );
}

/** Total value (RAP) of their Limiteds. */
function RapPill({ userId }: { userId: number }) {
  const q = useQuery({ queryKey: ["collectibles", userId], queryFn: () => collectibles(userId), staleTime: 10 * 60_000, retry: false });
  if (!q.data) return null;
  const rap = q.data.reduce((n, i) => n + (i.rap ?? 0), 0);
  return (
    <span className="count-pill" title={t("{n} Limiteds · {rap} RAP", { n: q.data.length, rap })}>
      <Icon name="robux" size={14} /> <b>{compact(rap)}</b> {t("RAP")}
    </span>
  );
}

/** "5 Mutuals" with their heads stacked, like the app. */
function MutualsPill({ userId, theirs }: { userId: number; theirs?: Friend[] }) {
  const me = useMe();
  const { go } = useNav();
  const mine = useFriends(me.id);
  const head = useQuery({ queryKey: ["profileHeader", userId], queryFn: () => profileHeader(userId), staleTime: 10 * 60_000 });
  const myIds = new Set((mine.data ?? []).map((f) => f.id));
  const mutual = theirs && mine.data ? theirs.filter((f) => myIds.has(f.id)) : [];
  const count = Math.max(mutual.length, head.data?.counts.mutualFriendsCount ?? 0);
  if (!count) return null;
  return (
    <button className="count-pill mutuals" onClick={() => go({ name: "connections", userId, kind: "mutuals" })} title={mutual.slice(0, 12).map((f) => f.displayName).join(", ")}>
      <span className="fp-stack">
        {mutual.slice(0, 3).map((f) => (
          <Headshot key={f.id} userId={f.id} size={22} />
        ))}
      </span>
      <b>{count}</b> {count === 1 ? t("Mutual") : t("Mutuals")}
    </button>
  );
}

/** "Friends since …" under the counts, for people you're friends with. */
function FriendsSince({ userId }: { userId: number }) {
  const me = useMe();
  const mine = useFriends(me.id ?? 0);
  const isFriend = !!mine.data?.some((f) => f.id === userId);
  const q = useQuery({ queryKey: ["friendsSince", userId], queryFn: () => friendsSince(me.id!, userId), enabled: isFriend && !!me.id, staleTime: Infinity, retry: false });
  if (!q.data) return null;
  return (
    <div className="friends-since muted small">
      <Icon name="two-people" size={14} /> {t("Friends since {date}", { date: fmtDate(q.data, { month: "long", day: "numeric", year: "numeric" }) })}
    </div>
  );
}

/** "@name" from a social profile URL (x.com/name, youtube.com/@name, twitch.tv/name…). */
function socialHandle(url: string) {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean);
    const pick = seg.find((x) => x.startsWith("@")) ?? (seg[0] === "c" || seg[0] === "user" || seg[0] === "channel" ? seg[1] : seg[0]);
    return pick ? (pick.startsWith("@") ? pick : `@${pick}`) : u.hostname.replace(/^www./, "");
  } catch {
    return url;
  }
}

/** Games they made + their favorites (Favorites ›). */
function ProfileGames({ userId }: { userId: number }) {
  const { go } = useNav();
  const me = useMe();
  const made = useQuery({ queryKey: ["userGames", userId], queryFn: () => userGames(userId) });
  const favs = useQuery({ queryKey: ["favGames", userId], queryFn: () => favoriteGames(userId).catch(() => []) });
  return (
    <>
      {made.data?.length ? (
        <section className="shelf">
          <SectionHeader title={t("Creations")} />
          <TileRow games={made.data} />
        </section>
      ) : null}
      {favs.data?.length ? (
        <section className="shelf">
          <SectionHeader title={t("Favorites")} onMore={userId === me.id ? () => go({ name: "list", kind: "favorites" }) : undefined} />
          <TileRow games={favs.data} />
        </section>
      ) : null}
    </>
  );
}

/** Experience badges and Roblox badges. */
function ProfileBadges({ userId }: { userId: number }) {
  const [open, setOpen] = useState<number | null>(null);
  const badges = useQuery({ queryKey: ["badges", userId], queryFn: () => userBadges(userId) });
  const rb = useQuery({ queryKey: ["robloxBadges", userId], queryFn: () => robloxBadges(userId) });
  return (
    <>
      {badges.data?.length ? (
        <section className="shelf">
          <SectionHeader title={t("Badges")} />
          <div className="badge-row hscroll">
            {badges.data.map((b) => (
              <button key={b.id} className="badge-card clickable" title={b.description || b.name} onClick={() => setOpen(b.id)}>
                <Thumb type="BadgeIcon" id={b.id} className="square" />
                <div className="item-name two-line">{b.name}</div>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {open ? <BadgePopup id={open} userId={userId} onClose={() => setOpen(null)} /> : null}
      {rb.data?.length ? (
        <section className="shelf">
          <SectionHeader title={t("Roblox Badges")} />
          <div className="badge-row hscroll">
            {rb.data.map((b) => (
              <div key={b.id} className="badge-card" title={b.description}>
                <img className="rb-badge" src={b.imageUrl} alt="" />
                <div className="item-name two-line">{b.name}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

/** What roblox.com shows but the app doesn't: statistics, past usernames, social links, inventory. */
function ProfileExtras({ userId, created }: { userId: number; created: string }) {
  const names = useQuery({ queryKey: ["usernameHistory", userId], queryFn: () => usernameHistory(userId) });
  const links = useQuery({ queryKey: ["userLinks", userId], queryFn: () => userSocialLinks(userId) });
  const invOk = useQuery({ queryKey: ["canViewInv", userId], queryFn: () => canViewInventory(userId) });
  return (
    <>
      <section className="shelf">
        <SectionHeader title={t("Statistics")} />
        <div className="info-table">
          <div className="info-row">
            <span className="info-label">{t("Join Date")}</span>
            <span className="info-value">{longDate(created)}</span>
          </div>
          {names.data?.length ? (
            <div className="info-row">
              <span className="info-label">{t("Previous usernames")}</span>
              <span className="info-value prev-names">{names.data.join(", ")}</span>
            </div>
          ) : null}
        </div>
      </section>
      {links.data?.length ? (
        <section className="shelf">
          <SectionHeader title={t("Social")} />
          <div className="social-row">
            {links.data.map(([k, url]) => (
              <button key={k} className="social-link" onClick={() => win.openExternal(url)} aria-label={`${k}: ${socialHandle(url)}`}>
                <span className="social-circle"><SocialIcon type={k} /></span>
                <span>{k}</span>
                <span className="social-tip" role="tooltip">{socialHandle(url)}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {invOk.data ? (
        <section className="shelf">
          <SectionHeader title={t("Inventory")} />
          <InventoryBrowser userId={userId} />
        </section>
      ) : invOk.isFetched ? (
        <p className="muted small">{t("This inventory is private.")}</p>
      ) : null}
    </>
  );
}

type Person = { id: number; name: string; displayName: string; hasVerifiedBadge?: boolean; presence?: Friend["presence"] };

/** One person as a card: head with presence, names, status (game name when in one), and actions. */
function PersonCard({ c, actions, sub, alias, fav }: { c: Person; actions?: ReactNode; sub?: ReactNode; alias?: string | null; fav?: boolean }) {
  const { go } = useNav();
  const p = c.presence;
  const status = p?.userPresenceType ?? 0;
  return (
    <div className={`pcard p${status}`}>
      <button className="pcard-main" onClick={() => go({ name: "profile", userId: c.id })}>
        <Headshot userId={c.id} size={52} presence={status} />
        <span className="pcard-text">
          <span className="person-name ellipsis">
            {fav ? <Icon name="star" size={13} className="fav-star" /> : null}
            {alias || c.displayName} {c.hasVerifiedBadge ? <Verified size={12} /> : null}
          </span>
          <span className="muted small ellipsis">{alias ? `${c.displayName} · @${c.name}` : `@${c.name}`}</span>
          {sub ?? <span className={`small ellipsis status-text p${status}`}>{status === 2 && p?.lastLocation ? p.lastLocation : statusLabel(status)}</span>}
        </span>
      </button>
      {actions ? <div className="pcard-actions">{actions}</div> : null}
    </div>
  );
}

function JoinButton({ f }: { f: Person }) {
  const { play } = useUi();
  const p = f.presence;
  if (p?.userPresenceType !== 2 || !(p.placeId || p.rootPlaceId)) return null;
  return (
    <button className="btn btn-secondary btn-small" onClick={() => play(p.placeId || p.rootPlaceId!, p.lastLocation || "experience", p.gameId ?? undefined)}>
      {t("Join")}
    </button>
  );
}

const byPresence = (a: Person, b: Person) => (b.presence?.userPresenceType ?? 0) - (a.presence?.userPresenceType ?? 0);

function PeopleGrid({ rows, join }: { rows: Person[]; join?: boolean }) {
  const me = useMe();
  const { isFav } = useFavorites(me.id);
  const names = useAliases(rows.slice(0, 600).map((r) => r.id));
  return (
    <div className="pgrid">
      {rows.map((c) => (
        <PersonCard key={c.id} c={c} alias={names.data?.get(c.id)} fav={isFav(c.id)} actions={join ? <JoinButton f={c} /> : undefined} />
      ))}
    </div>
  );
}

type ConnKind = "friends" | "followers" | "following" | "mutuals";

export function Connections({ userId, kind }: { userId: number; kind: ConnKind }) {
  const { go } = useNav();
  const me = useMe();
  const isMe = me.id === userId;
  const [filter, setFilter] = useState("");
  const info = useQuery({ queryKey: ["user", userId], queryFn: () => user(userId) });
  const friendsQ = useFriends(userId);
  const mineQ = useFriends(me.id ?? 0);
  const followersQ = useQuery({ queryKey: ["followers", userId], queryFn: () => connections(userId, "followers"), enabled: kind === "followers" });
  const followingQ = useQuery({ queryKey: ["following", userId], queryFn: () => connections(userId, "followings"), enabled: kind === "following" });
  const mutuals = useMemo(() => {
    const mine = new Set((mineQ.data ?? []).map((f) => f.id));
    return (friendsQ.data ?? []).filter((f) => mine.has(f.id));
  }, [friendsQ.data, mineQ.data]);
  const active = kind === "friends" || kind === "mutuals" ? friendsQ : kind === "followers" ? followersQ : followingQ;
  const data: Person[] = kind === "mutuals" ? mutuals : (active.data ?? []);
  const rows = data.filter((c) => !filter || `${c.displayName} ${c.name}`.toLowerCase().includes(filter.toLowerCase())).sort(byPresence);
  const loading = active.isLoading || (kind === "mutuals" && mineQ.isLoading);
  const name = info.data?.displayName;

  const tab = (k: ConnKind, label: string) => (
    <button className={kind === k ? "active" : ""} onClick={() => go({ name: "connections", userId, kind: k })}>
      {label}
    </button>
  );

  return (
    <div className="page people-page">
      <h1 className="page-title">{name ? (kind === "mutuals" ? t("Mutual friends with {name}", { name }) : t("{name}'s Connections", { name })) : t("Connections")}</h1>
      <div className="people-bar">
        <div className="tabs">
          {tab("friends", t("Friends"))}
          {!isMe ? tab("mutuals", mineQ.data && friendsQ.data ? t("Mutuals ({n})", { n: mutuals.length }) : t("Mutuals")) : null}
          {tab("following", t("Following"))}
          {tab("followers", t("Followers"))}
        </div>
        <div className="filter people-search">
          <Icon name="magnifying-glass" size={16} />
          <input placeholder={t("Search")} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      </div>
      {loading ? (
        <SkeletonRows count={10} avatar={52} />
      ) : active.error ? (
        <ErrorState error={active.error} retry={() => active.refetch()} />
      ) : rows.length ? (
        <PeopleGrid rows={rows} />
      ) : (
        <Empty icon="two-people">{kind === "mutuals" ? t("No mutual friends.") : t("Nothing here.")}</Empty>
      )}
    </div>
  );
}

function Requests() {
  const qc = useQueryClient();
  const { toast } = useUi();
  const q = useQuery({ queryKey: ["requests"], queryFn: friendRequests });
  const [busy, setBusy] = useState<number | null>(null);
  const act = async (id: number, accept: boolean) => {
    setBusy(id);
    try {
      await (accept ? acceptRequest(id) : declineRequest(id));
      qc.invalidateQueries({ queryKey: ["requests"] });
      qc.invalidateQueries({ queryKey: ["friendRequestCount"] });
      if (accept) qc.invalidateQueries({ queryKey: ["friends"] });
    } catch (e) {
      toast(t("Couldn't update request: {error}", { error: (e as Error).message }), "error");
    } finally {
      setBusy(null);
    }
  };
  if (q.isLoading) return <SkeletonRows count={6} avatar={52} />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!q.data?.length) return <Empty icon="person-plus">{t("No friend requests.")}</Empty>;
  return (
    <div className="pgrid">
      {q.data.map((r) => (
        <PersonCard
          key={r.id}
          c={r}
          sub={<span className="small muted">{t("Wants to be friends")}</span>}
          actions={
            <>
              <button className="btn btn-primary btn-small" disabled={busy === r.id} onClick={() => act(r.id, true)}>
                {t("Accept")}
              </button>
              <button className="btn btn-secondary btn-small" disabled={busy === r.id} onClick={() => act(r.id, false)}>
                {t("Ignore")}
              </button>
            </>
          }
        />
      ))}
    </div>
  );
}

/** Friend suggestions from Roblox's home feed, with Add Friend like the app. */
function PeopleYouMayKnow() {
  const { go } = useNav();
  const { toast } = useUi();
  const [sent, setSent] = useState<Set<number>>(new Set());
  const ids = useQuery({ queryKey: ["pymk"], queryFn: peopleYouMayKnow, staleTime: 10 * 60_000, retry: false });
  const names = useQuery({ queryKey: ["pymkNames", ids.data?.join()], queryFn: async () => {
      const m = await usersByIds(ids.data!.slice(0, 20));
      return [...m.entries()].map(([id, n]) => ({ id, ...n }));
    }, enabled: !!ids.data?.length });
  if (!names.data?.length) return null;
  return (
    <section className="shelf">
      <h3 className="list-label">{t("People you may know")}</h3>
      <div className="pymk-row hscroll">
        {names.data.map((u) => (
          <div key={u.id} className="pymk-card">
            <button className="pymk-face" onClick={() => go({ name: "profile", userId: u.id })}>
              <Headshot userId={u.id} size={84} />
              <b className="ellipsis">{u.displayName}</b>
              <span className="tiny muted ellipsis">@{u.name}</span>
            </button>
            <button
              className="btn btn-secondary btn-small"
              disabled={sent.has(u.id)}
              onClick={async () => {
                try {
                  await sendFriendRequest(u.id);
                  setSent((s) => new Set(s).add(u.id));
                  toast(t("Friend request sent to {name}.", { name: u.displayName }));
                } catch (e) {
                  toast(friendlyError(e), "error");
                }
              }}
            >
              {sent.has(u.id) ? t("Sent") : t("Add Friend")}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/** A profile's Limiteds, most valuable first (the app's Collectibles row). */
function ProfileCollectibles({ userId }: { userId: number }) {
  const { go } = useNav();
  const q = useQuery({ queryKey: ["collectibles", userId], queryFn: () => collectibles(userId), staleTime: 10 * 60_000, retry: false });
  const items = [...(q.data ?? [])].sort((a, b) => (b.rap ?? 0) - (a.rap ?? 0)).slice(0, 30);
  if (!items.length) return null;
  const total = (q.data ?? []).reduce((n, i) => n + (i.rap ?? 0), 0);
  return (
    <section className="shelf">
      <SectionHeader title={t("Collectibles ({n}) · {total} RAP", { n: q.data!.length, total })} />
      <div className="collect-row hscroll">
        {items.map((i) => (
          <button key={i.userAssetId} className="collect-card" onClick={() => go({ name: "item", itemType: "Asset", id: i.assetId })} title={i.name}>
            <span className="collect-art">
              <Thumb type="Asset" id={i.assetId} />
              {i.serialNumber ? <span className="trade-serial">#{i.serialNumber}</span> : null}
            </span>
            <span className="small ellipsis">{i.name}</span>
            <span className="tiny muted">{t("RAP {rap}", { rap: i.rap ?? 0 })}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

type FriendFilter = "all" | "favorites" | "game" | "online" | "offline";

export function Friends({ tab = "friends" }: { tab?: "friends" | "requests" }) {
  const me = useMe();
  const { go } = useNav();
  const q = useFriends(me.id);
  const req = useQuery({ queryKey: ["requests"], queryFn: friendRequests, staleTime: 60_000 });
  const [filter, setFilter] = useState("");
  const [show, setShow] = useState<FriendFilter>("all");
  const { isFav } = useFavorites(me.id);
  const all = (q.data ?? []).filter((f) => !filter || `${f.displayName} ${f.name}`.toLowerCase().includes(filter.toLowerCase()));
  const pt = (f: Friend) => f.presence?.userPresenceType ?? 0;
  const inGame = all.filter((f) => pt(f) === 2);
  const online = all.filter((f) => pt(f) === 1 || pt(f) === 3);
  const offline = all.filter((f) => pt(f) === 0);
  const favs = all.filter((f) => isFav(f.id)).sort((a, b) => pt(b) - pt(a));
  const groups: [FriendFilter, string, Friend[]][] = [
    ["favorites", t("Favorites"), favs],
    ["game", t("In an experience"), inGame],
    ["online", t("Online"), online],
    ["offline", t("Offline"), offline],
  ];
  const chip = (k: FriendFilter, label: string, _n: number) => (
    <button className={`chip ${show === k ? "on-solid" : ""}`} onClick={() => setShow(k)}>
      {label}
    </button>
  );

  return (
    <div className="page people-page">
      <h1 className="page-title">{t("Friends")}</h1>
      <div className="people-bar">
        <div className="tabs">
          <button className={tab === "friends" ? "active" : ""} onClick={() => go({ name: "friends", tab: "friends" })}>
            {q.data ? t("Friends ({n})", { n: q.data.length }) : t("Friends")}
          </button>
          <button className={tab === "requests" ? "active" : ""} onClick={() => go({ name: "friends", tab: "requests" })}>
            {t("Requests")} {req.data?.length ? <span className="tab-badge">{req.data.length > 99 ? "99+" : req.data.length}</span> : null}
          </button>
        </div>
        {tab === "friends" ? (
          <div className="filter people-search">
            <Icon name="magnifying-glass" size={16} />
            <input placeholder={t("Search friends")} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        ) : null}
      </div>
      {tab === "requests" ? (
        <Requests />
      ) : q.isLoading ? (
        <SkeletonRows count={10} avatar={52} />
      ) : q.error ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : (
        <>
          <div className="chip-row people-chips">
            {chip("all", t("All"), all.length)}
            {favs.length ? chip("favorites", t("Favorites"), favs.length) : null}
            {chip("game", t("In game"), inGame.length)}
            {chip("online", t("Online"), online.length)}
            {chip("offline", t("Offline"), offline.length)}
          </div>
          {!filter && show === "all" ? <PeopleYouMayKnow /> : null}
          {groups
            .filter(([k, , rows]) => rows.length && (show === "all" || show === k))
            .map(([k, label, rows]) => (
              <section key={k} className="people-section">
                <h3 className="list-label">
                  {t("{label} ({n})", { label, n: rows.length })}
                </h3>
                <PeopleGrid rows={rows} join={k === "game" || k === "favorites"} />
              </section>
            ))}
          {!all.length ? <Empty icon="two-people">{filter ? t("No friends match that.") : t("No friends yet.")}</Empty> : null}
        </>
      )}
    </div>
  );
}

function CommunityGrid({ items, row = false, primaryId }: { items: Community[]; row?: boolean; primaryId?: number }) {
  const { go } = useNav();
  return (
    <div className={row ? "community-row hscroll" : "community-grid"}>
      {items.map((c) => (
        <button key={c.id} className="community-card" onClick={() => go({ name: "community", groupId: c.id })}>
          <div className="community-card-art">
            <Thumb type="GroupIcon" id={c.id} className="square" />
            {c.id === primaryId ? <span className="owner-tag">{t("Primary")}</span> : c.isOwner ? <span className="owner-tag">{t("Owner")}</span> : null}
          </div>
          <div className="game-name two-line">
            {c.name} {c.hasVerifiedBadge ? <Verified size={12} /> : null}
          </div>
          <div className="muted small">{t("{count}+ Members", { count: compact(c.memberCount) })}</div>
          <div className="community-role" title={t("Rank {rank}", { rank: c.rank })}>
            {c.role}
          </div>
        </button>
      ))}
    </div>
  );
}

export function Communities() {
  const me = useMe();
  const q = useQuery({ queryKey: ["communities", me.id], queryFn: () => communities(me.id) });
  return (
    <div className="page">
      <h1 className="page-title">{t("Communities")}</h1>
      {q.isLoading ? (
        <SkeletonGrid count={12} />
      ) : q.error ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : q.data?.length ? (
        <CommunityGrid items={q.data} />
      ) : (
        <Empty icon="two-folders">{t("You aren't in any communities yet.")}</Empty>
      )}
    </div>
  );
}
