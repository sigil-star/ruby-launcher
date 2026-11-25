import { call, rbx, RobloxError } from "./ipc";
import { noteBought } from "./bought";
import { t } from "./i18n";

export type Me = {
  id?: number;
  name?: string;
  displayName?: string;
  robux?: number;
  isPremium?: boolean;
  hasVerifiedBadge?: boolean;
};

export type SavedAccount = { id: string; userId: number; username: string; displayName?: string };

export type GameSummary = {
  universeId: number;
  placeId: number;
  name: string;
  upVotes?: number;
  downVotes?: number;
  playing?: number;
};

export type Shelf = { id: string; title: string; layout: "grid" | "tiles"; games: GameSummary[] };

export type Presence = {
  userId: number;
  userPresenceType: 0 | 1 | 2 | 3;
  lastLocation: string;
  placeId: number | null;
  rootPlaceId: number | null;
  universeId: number | null;
  gameId: string | null;
};

export type Friend = { id: number; name: string; displayName: string; hasVerifiedBadge?: boolean; presence?: Presence };

export type UserInfo = {
  id: number;
  name: string;
  displayName: string;
  description: string;
  created: string;
  hasVerifiedBadge: boolean;
  isBanned: boolean;
};

export type GameDetail = {
  id: number;
  rootPlaceId: number;
  name: string;
  description: string;
  creator: { id: number; name: string; type: string; hasVerifiedBadge: boolean };
  price: number | null;
  playing: number;
  visits: number;
  maxPlayers: number;
  created: string;
  updated: string;
  genre: string;
  favoritedCount: number;
};

export type Server = { id: string; maxPlayers: number; playing: number; ping?: number; fps?: number; playerTokens?: string[] };

export const session = {
  me: () => call<Me>("getUserData"),
  refresh: () => call<Me>("refreshUserData"),
  authState: () => call<{ hasKnownUser: boolean; loginBarVisible: boolean }>("getAuthState"),
  accounts: () => call<SavedAccount[]>("listSavedAccounts"),
  switchAccount: (id: string) => call("switchSavedAccount", id),
  removeAccount: (id: string) => call("removeSavedAccount", id),
  signIn: () => call("signIn"),
  useRobloxAppSession: () => call<{ ok: boolean; error?: string }>("useRobloxAppSession"),
  signOut: () => call("signOut"),
};

export const launcher = {
  launch: (placeId: number, jobId?: string, meta?: { name?: string; iconUrl?: string }) =>
    call<{ ok: boolean }>("launchRoblox", placeId, jobId ?? null, meta ?? null),
  prewarm: () => call("prewarmLaunch").catch(() => undefined),
  install: () => call<{ installed: boolean; path: string | null }>("getRobloxInstall"),
  openVersions: () => call("openRobloxVersionsFolder"),
  settings: () =>
    call<{ minimizeToTray: boolean; dontOpenAppOnGameClose: boolean; handleWebLaunches?: boolean }>("getLauncherSettings"),
  setSetting: (key: string, value: unknown) => call("setLauncherSetting", key, value),
  openLog: () => call("openLogFile"),
  playTime: (placeIds: number[]) =>
    call<Record<string, { totalMs: number; lastPlayedAt?: number }>>("getPlayTimeForPlaces", placeIds),
};

type UserName = { name: string; displayName: string; hasVerifiedBadge: boolean };
const nameCache = new Map<number, UserName>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Names for many users. Cached forever (names rarely change mid-session); a rate-limited
 *  chunk is retried once, then skipped rather than failing the whole list. */
export async function usersByIds(ids: number[]): Promise<Map<number, UserName>> {
  const uniq = [...new Set(ids)].filter(Boolean);
  const missing = uniq.filter((id) => !nameCache.has(id));
  const chunks: number[][] = [];
  for (let i = 0; i < missing.length; i += 100) chunks.push(missing.slice(i, i + 100));
  const fetchChunk = (c: number[]) =>
    rbx<{ data: ({ id: number } & UserName)[] }>("https://users.roblox.com/v1/users", { method: "POST", body: { userIds: c, excludeBannedUsers: false } });
  await Promise.all(
    chunks.map(async (c, i) => {
      await sleep(i * 120); // stagger: users.roblox.com rate-limits bursts
      let res = await fetchChunk(c).catch((e) => (e instanceof RobloxError && e.status === 429 ? null : Promise.reject(e))).catch(() => null);
      if (!res) {
        await sleep(1500);
        res = await fetchChunk(c).catch(() => null);
      }
      res?.data.forEach((u) => nameCache.set(u.id, u));
    }),
  );
  const out = new Map<number, UserName>();
  for (const id of uniq) {
    const u = nameCache.get(id);
    if (u) out.set(id, u);
  }
  return out;
}

export async function presences(ids: number[]): Promise<Map<number, Presence>> {
  const out = new Map<number, Presence>();
  const uniq = [...new Set(ids)].filter(Boolean);
  const chunks: number[][] = [];
  for (let i = 0; i < uniq.length; i += 50) chunks.push(uniq.slice(i, i + 50));
  // In parallel; a failed (e.g. rate-limited) chunk just shows those friends as offline.
  const results = await Promise.all(
    chunks.map((ids) => rbx<{ userPresences: Presence[] }>("https://presence.roblox.com/v1/presence/users", { method: "POST", body: { userIds: ids } }).catch(() => null)),
  );
  for (const res of results) {
    res?.userPresences.forEach((p) => out.set(p.userId, p));
  }
  return out;
}

const PRESENCE_RANK = { 2: 0, 3: 1, 1: 2, 0: 3 } as const;

const friendsCache = new Map<number, { at: number; p: Promise<Friend[]> }>();

/** Everyone's friends list goes through here, so Home, Friends, chat and the overlay share
 *  one request (and one rate-limit budget) instead of each fetching 480+ friends. */
export function friends(userId: number): Promise<Friend[]> {
  const hit = friendsCache.get(userId);
  if (hit && Date.now() - hit.at < 20_000) return hit.p;
  const p = loadFriends(userId).catch((e) => {
    friendsCache.delete(userId);
    throw e;
  });
  friendsCache.set(userId, { at: Date.now(), p });
  return p;
}

async function loadFriends(userId: number): Promise<Friend[]> {
  // /friends stops at 200; /friends/find pages through everyone. Fall back if it misbehaves.
  let ids: number[] = [];
  try {
    const seen = new Set<number>();
    let cursor = "";
    for (let i = 0; i < 60; i++) {
      const res = await rbx<{ PageItems?: { id: number }[]; NextCursor?: string | null }>(
        `https://friends.roblox.com/v1/users/${userId}/friends/find?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      const before = seen.size;
      (res.PageItems ?? []).forEach((f) => seen.add(f.id));
      if (!res.NextCursor || res.NextCursor === cursor || seen.size === before) break;
      cursor = res.NextCursor;
    }
    ids = [...seen];
  } catch {
    ids = [];
  }
  if (!ids.length) {
    const res = await rbx<{ data: { id: number }[] }>(`https://friends.roblox.com/v1/users/${userId}/friends`);
    ids = res.data.map((f) => f.id);
  }
  const [names, pres] = await Promise.all([usersByIds(ids).catch(() => new Map<number, UserName>()), presences(ids).catch(() => new Map<number, Presence>())]);
  return ids
    .map((id) => {
      const u = names.get(id);
      return { id, name: u?.name ?? "", displayName: u?.displayName ?? u?.name ?? "", hasVerifiedBadge: u?.hasVerifiedBadge, presence: pres.get(id) };
    })
    .sort((a, b) => PRESENCE_RANK[a.presence?.userPresenceType ?? 0] - PRESENCE_RANK[b.presence?.userPresenceType ?? 0]);
}

export const friendCount = (userId: number) =>
  rbx<{ count: number }>(`https://friends.roblox.com/v1/users/${userId}/friends/count`).then((r) => r.count);
export const followerCount = (userId: number) =>
  rbx<{ count: number }>(`https://friends.roblox.com/v1/users/${userId}/followers/count`).then((r) => r.count);
export const followingCount = (userId: number) =>
  rbx<{ count: number }>(`https://friends.roblox.com/v1/users/${userId}/followings/count`).then((r) => r.count);

export const user = (id: number) => rbx<UserInfo>(`https://users.roblox.com/v1/users/${id}`);

export type FriendRequest = { id: number; name: string; displayName: string; created: string };

export async function friendRequests(): Promise<FriendRequest[]> {
  // Roblox pages requests 50 at a time; follow the cursor so every request shows (capped for sanity).
  type Row = { id: number; name: string; displayName: string; friendRequest?: { sentAt: string } };
  const res: { data: Row[] } = { data: [] };
  let cursor = "";
  for (let i = 0; i < 40; i++) {
    const page = await rbx<{ data: Row[]; nextPageCursor?: string | null }>(
      `https://friends.roblox.com/v1/my/friends/requests?limit=50&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    res.data.push(...(page.data ?? []));
    if (!page.nextPageCursor) break;
    cursor = page.nextPageCursor;
  }
  const missing = res.data.filter((r) => !r.name).map((r) => r.id);
  const names = missing.length ? await usersByIds(missing) : new Map();
  return res.data.map((r) => ({
    id: r.id,
    name: r.name || names.get(r.id)?.name || "",
    displayName: r.displayName || names.get(r.id)?.displayName || "",
    created: r.friendRequest?.sentAt ?? "",
  }));
}

export const friendRequestCount = () =>
  rbx<{ count: number }>("https://friends.roblox.com/v1/user/friend-requests/count").then((r) => r.count);
export const acceptRequest = (id: number) =>
  rbx(`https://friends.roblox.com/v1/users/${id}/accept-friend-request`, { method: "POST" });
export const declineRequest = (id: number) =>
  rbx(`https://friends.roblox.com/v1/users/${id}/decline-friend-request`, { method: "POST" });

export async function searchUsers(keyword: string) {
  return (await searchUsersPage(keyword, null, 10)).data;
}

/** One page of people matching a search; `next` is null on the last page. */
export async function searchUsersPage(keyword: string, cursor: string | null, limit: 10 | 25 | 50 = 25) {
  const res = await rbx<{ data: { id: number; name: string; displayName: string; hasVerifiedBadge: boolean }[]; nextPageCursor: string | null }>(
    `https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(keyword)}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
  return { data: res.data, next: res.nextPageCursor };
}

function newSession() {
  return crypto.randomUUID();
}

type OmniMeta = { name?: string; rootPlaceId?: number; totalUpVotes?: number; totalDownVotes?: number; playerCount?: number };

export async function homeShelves(): Promise<Shelf[]> {
  const res = await rbx<{
    sorts: { topic?: string; topicId?: number; treatmentType?: string; recommendationList?: { contentType: string; contentId: number }[] }[];
    contentMetadata?: { Game?: Record<string, OmniMeta> };
  }>("https://apis.roblox.com/discovery-api/omni-recommendation", {
    method: "POST",
    body: { pageType: "Home", sessionId: newSession(), supportedTreatmentTypes: ["SortlessGrid", "Carousel", "HeroUnit", "EventTile", "FeaturedGrid", "Pills", "InterestGrid", "AvatarCarousel"] },
  });
  const meta = res.contentMetadata?.Game ?? {};
  const shelves: Shelf[] = [];
  for (const s of res.sorts ?? []) {
    const games = (s.recommendationList ?? [])
      .filter((r) => r.contentType === "Game")
      .map((r) => {
        const m = meta[String(r.contentId)] ?? {};
        return {
          universeId: r.contentId,
          placeId: m.rootPlaceId ?? 0,
          name: m.name ?? "",
          upVotes: m.totalUpVotes,
          downVotes: m.totalDownVotes,
          playing: m.playerCount,
        };
      })
      .filter((g) => g.name);
    if (!games.length) continue;
    const title = s.topic?.trim() || "Recommended";
    shelves.push({
      id: `${s.topicId ?? title}`,
      title,
      layout: s.treatmentType === "SortlessGrid" ? "grid" : "tiles",
      games,
    });
  }
  return shelves;
}

export async function charts(): Promise<Shelf[]> {
  const res = await rbx<{
    sorts: { sortId: string; sortDisplayName: string; games?: { universeId: number; rootPlaceId: number; name: string; totalUpVotes: number; totalDownVotes: number; playerCount: number }[] }[];
  }>(`https://apis.roblox.com/explore-api/v1/get-sorts?sessionId=${newSession()}&device=computer&country=all`);
  return (res.sorts ?? [])
    .filter((s) => s.games?.length)
    .map((s) => ({
      id: s.sortId,
      title: s.sortDisplayName,
      layout: "tiles" as const,
      games: s.games!.map((g) => ({
        universeId: g.universeId,
        placeId: g.rootPlaceId,
        name: g.name,
        upVotes: g.totalUpVotes,
        downVotes: g.totalDownVotes,
        playing: g.playerCount,
      })),
    }));
}

export async function searchGames(q: string): Promise<GameSummary[]> {
  return (await searchGamesPage(q, newSession(), null)).games;
}

/** One page of experiences matching a search. Keep the same session id across pages. */
export async function searchGamesPage(q: string, session: string, token: string | null): Promise<{ games: GameSummary[]; next: string | null }> {
  const res = await rbx<{
    searchResults: { contentGroupType: string; contents: { universeId: number; rootPlaceId: number; name: string; totalUpVotes: number; totalDownVotes: number; playerCount: number }[] }[];
    nextPageToken?: string | null;
  }>(`https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(q)}&sessionId=${session}&pageType=all${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`);
  const games = (res.searchResults ?? [])
    .filter((g) => g.contentGroupType === "Game")
    .flatMap((g) => g.contents)
    .map((g) => ({
      universeId: g.universeId,
      placeId: g.rootPlaceId,
      name: g.name,
      upVotes: g.totalUpVotes,
      downVotes: g.totalDownVotes,
      playing: g.playerCount,
    }));
  return { games, next: res.nextPageToken || null };
}

export async function userGames(userId: number): Promise<GameSummary[]> {
  const res = await rbx<{ data: { id: number; name: string; rootPlace?: { id: number }; placeVisits?: number }[] }>(
    `https://games.roblox.com/v2/users/${userId}/games?accessFilter=Public&limit=10&sortOrder=Desc`,
  ).catch(() => ({ data: [] as { id: number; name: string; rootPlace?: { id: number } }[] }));
  const base = res.data.map((g) => ({ universeId: g.id, placeId: g.rootPlace?.id ?? 0, name: g.name }));
  return withStats(base);
}

export async function favoriteGames(userId: number): Promise<GameSummary[]> {
  const res = await rbx<{ data: { id: number; name: string; rootPlace?: { id: number } }[] }>(
    `https://games.roblox.com/v2/users/${userId}/favorite/games?limit=50&sortOrder=Desc`,
  );
  const base = res.data.map((g) => ({ universeId: g.id, placeId: g.rootPlace?.id ?? 0, name: g.name }));
  return withStats(base);
}

/** Fill in votes + player counts for a list of games. */
export async function withStats(games: GameSummary[]): Promise<GameSummary[]> {
  if (!games.length) return games;
  const ids = games.map((g) => g.universeId);
  const [details, votes] = await Promise.all([gameDetails(ids), gameVotes(ids)]);
  return games.map((g) => {
    const d = details.get(g.universeId);
    const v = votes.get(g.universeId);
    return { ...g, placeId: g.placeId || d?.rootPlaceId || 0, playing: d?.playing, upVotes: v?.upVotes, downVotes: v?.downVotes };
  });
}

export async function gameDetails(universeIds: number[]): Promise<Map<number, GameDetail>> {
  const out = new Map<number, GameDetail>();
  for (let i = 0; i < universeIds.length; i += 50) {
    const res = await rbx<{ data: GameDetail[] }>(
      `https://games.roblox.com/v1/games?universeIds=${universeIds.slice(i, i + 50).join(",")}`,
    );
    res.data.forEach((g) => out.set(g.id, g));
  }
  return out;
}

export async function gameVotes(universeIds: number[]): Promise<Map<number, { upVotes: number; downVotes: number }>> {
  const out = new Map();
  for (let i = 0; i < universeIds.length; i += 50) {
    const res = await rbx<{ data: { id: number; upVotes: number; downVotes: number }[] }>(
      `https://games.roblox.com/v1/games/votes?universeIds=${universeIds.slice(i, i + 50).join(",")}`,
    );
    res.data.forEach((v) => out.set(v.id, v));
  }
  return out;
}

export async function gameMedia(universeId: number): Promise<string[]> {
  const res = await rbx<{ data: { thumbnails: { imageUrl: string | null }[] }[] }>(
    `https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${universeId}&countPerUniverse=10&defaults=true&size=768x432&format=Png&isCircular=false`,
  );
  return (res.data[0]?.thumbnails ?? []).map((t) => t.imageUrl).filter((u): u is string => !!u);
}

export async function universeFromPlace(placeId: number): Promise<number> {
  const res = await rbx<{ universeId: number }>(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
  return res.universeId;
}

/** sortOrder: 2 = most players first, 1 = fewest first (the only orders Roblox sorts by). */
export async function servers(placeId: number, cursor = "", excludeFull = true, sortOrder: 1 | 2 = 2): Promise<{ data: Server[]; nextPageCursor: string | null }> {
  return rbx(
    `https://games.roblox.com/v1/games/${placeId}/servers/0?limit=25&sortOrder=${sortOrder}&excludeFullGames=${excludeFull}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
}

/**
 * A game's preview video (the clip the app plays on hover): a GamePreviewVideo media item whose
 * asset resolves to a WebM on contentdelivery.roblox.com. Null when the game has none.
 */
export async function gamePreviewVideo(universeId: number): Promise<string | null> {
  const media = await rbx<{ data: { assetTypeId: number; videoId?: string | null }[] }>(
    `https://games.roblox.com/v2/games/${universeId}/media?fetchAllExperienceRelatedMedia=false`,
  ).catch(() => null);
  const videoId = media?.data.find((m) => m.assetTypeId === 86 && m.videoId)?.videoId;
  if (!videoId) return null;
  const asset = await rbx<{ locations?: { location?: string }[] }>(`https://assetdelivery.roblox.com/v2/asset/?id=${videoId}`).catch(() => null);
  return asset?.locations?.[0]?.location ?? null;
}

export type PrivateServer = {
  vipServerId: number;
  name: string;
  accessCode: string;
  maxPlayers: number;
  playing?: number;
  owner?: { id: number; name: string; displayName: string };
};

/** Private servers on this place the signed-in user can join (their own + ones they're invited to). */
export function privateServers(placeId: number, cursor = "") {
  return rbx<{ data: PrivateServer[]; nextPageCursor: string | null; gameJoinRestricted?: boolean }>(
    `https://games.roblox.com/v1/games/${placeId}/private-servers?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
}

export type PrivateServerSettings = { isAvailable: boolean; price: number; discounts: { source: string; robux: number }[] };

/** Price/availability shown on "Create a private server" (same call the game page makes). */
export async function privateServerSettings(universeId: number): Promise<PrivateServerSettings | null> {
  const res = await rbx<{ privateServerData?: PrivateServerSettings }>(
    `https://apis.roblox.com/private-servers-api/Universe-Private-Server-Settings?universeId=${universeId}`,
  ).catch(() => null);
  return res?.privateServerData ?? null;
}

/** Buys a private server (a Robux subscription) — only called after the user confirms. */
export const createPrivateServer = (universeId: number, name: string, expectedPrice: number) =>
  rbx<{ id?: number; vipServerId?: number; accessCode?: string }>(`https://games.roblox.com/v1/games/vip-servers/${universeId}`, {
    method: "POST",
    body: { name, expectedPrice, idempotencyKey: crypto.randomUUID() },
  });

/** The launcher's job argument for a private server (see launch.rs `parse_private`). */
export const privateJoinToken = (accessCode: string, linkCode = "") => `private:${accessCode}:${linkCode}`;

export type UserVote = { canVote: boolean; userVote: boolean | null; reasonForNotVoteable?: string };
export const userVote = (universeId: number) => rbx<UserVote>(`https://games.roblox.com/v1/games/${universeId}/votes/user`);
/**
 * Like (true), dislike (false) or clear (null). Roblox's own pages vote on the root place through voting-api; the
 * games API's PATCH is tried first and that one is the fallback, since the two disagree about
 * whether you've "played" (the games API only counts recent visits).
 */
export async function setUserVote(universeId: number, vote: boolean | null, rootPlaceId?: number) {
  try {
    return await rbx(`https://games.roblox.com/v1/games/${universeId}/user-votes`, { method: "PATCH", body: { vote } });
  } catch (e) {
    if (!rootPlaceId) throw e;
    // roblox.com's own like buttons (the old www.roblox.com/voting/vote is gone). If that fails
    // too, the games API's reason ("play it first" and so on) is the more useful one to show.
    return await rbx(`https://apis.roblox.com/voting-api/vote/asset/${rootPlaceId}?vote=${vote === null ? "" : vote}`, { method: "POST" }).catch(() => {
      throw e;
    });
  }
}

/** "Notify" on a game page = following the experience (followings API). */
export const isFollowingGame = (meId: number, universeId: number) =>
  rbx<{ IsFollowing?: boolean; isFollowing?: boolean }>(`https://followings.roblox.com/v1/users/${meId}/universes/${universeId}/status`).then(
    (r) => !!(r.IsFollowing ?? r.isFollowing),
  );
export const setFollowingGame = (meId: number, universeId: number, follow: boolean) =>
  rbx(`https://followings.roblox.com/v1/users/${meId}/universes/${universeId}`, { method: follow ? "POST" : "DELETE" });

export type SocialLink = { id: number; type: string; url: string; title: string };
export const gameSocialLinks = (universeId: number) =>
  rbx<{ data: SocialLink[] }>(`https://games.roblox.com/v1/games/${universeId}/social-links/list`)
    .then((r) => r.data ?? [])
    .catch(() => [] as SocialLink[]);

/** Headshots for the anonymous player tokens a server listing returns. */
export async function playerTokenHeadshots(tokens: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!tokens.length) return out;
  const res = await rbx<{ data: { requestId: string; imageUrl: string | null }[] }>("https://thumbnails.roblox.com/v1/batch", {
    method: "POST",
    body: tokens.slice(0, 100).map((token) => ({ requestId: token, token, type: "AvatarHeadShot", size: "48x48", format: "png", isCircular: true })),
  }).catch(() => ({ data: [] as { requestId: string; imageUrl: string | null }[] }));
  for (const r of res.data) if (r.imageUrl) out.set(r.requestId, r.imageUrl);
  return out;
}

export const isFavorited = (universeId: number) =>
  rbx<{ isFavorited: boolean }>(`https://games.roblox.com/v1/games/${universeId}/favorites`).then((r) => r.isFavorited);
export const setFavorited = (universeId: number, isFavorited: boolean) =>
  rbx(`https://games.roblox.com/v1/games/${universeId}/favorites`, { method: "POST", body: { isFavorited } });

export type Community = { id: number; name: string; memberCount: number; hasVerifiedBadge: boolean; role: string; rank: number; isOwner: boolean };

export async function communities(userId: number): Promise<Community[]> {
  const res = await rbx<{ data: { group: { id: number; name: string; memberCount: number; hasVerifiedBadge: boolean; owner?: { userId: number } | null }; role: { name: string; rank: number } }[] }>(
    `https://groups.roblox.com/v1/users/${userId}/groups/roles`,
  );
  return res.data.map((r) => ({
    id: r.group.id,
    name: r.group.name,
    memberCount: r.group.memberCount,
    hasVerifiedBadge: r.group.hasVerifiedBadge,
    role: r.role.name,
    rank: r.role.rank,
    isOwner: r.role.rank === 255 || r.group.owner?.userId === userId,
  }));
}

export type WornAsset = { id: number; name: string; assetType: { id: number; name: string }; meta?: unknown };

export type EquippedEmote = { assetId: number; assetName: string; position: number };
export type MyAvatar = {
  assets: WornAsset[];
  playerAvatarType: "R6" | "R15";
  bodyColor3s?: Record<string, string>;
  scales?: Record<string, number>;
  emotes?: EquippedEmote[];
};

export const myAvatar = () => rbx<MyAvatar>("https://avatar.roblox.com/v2/avatar/avatar");

export const setWearing = (assets: { id: number; meta?: unknown }[]) =>
  rbx<{ success: boolean; invalidAssetIds?: number[] }>("https://avatar.roblox.com/v2/avatar/set-wearing-assets", {
    method: "POST",
    body: { assets },
  });

export const redrawAvatar = () =>
  rbx("https://avatar.roblox.com/v1/avatar/redraw-thumbnail", { method: "POST" }).catch(() => undefined);

export const setAvatarType = (type: "R6" | "R15") =>
  rbx("https://avatar.roblox.com/v1/avatar/set-player-avatar-type", { method: "POST", body: { playerAvatarType: type } });

export type BodyPart = "head" | "torso" | "rightArm" | "leftArm" | "rightLeg" | "leftLeg";

/** Body colours, as hex without "#", for the parts given. */
export const setBodyColors = (colors: Partial<Record<BodyPart, string>>) =>
  rbx("https://avatar.roblox.com/v2/avatar/set-body-colors", {
    method: "POST",
    body: Object.fromEntries(Object.entries(colors).map(([k, v]) => [`${k}Color3`, v.replace("#", "")])),
  });

export type Scales = { height: number; width: number; head: number; depth: number; proportion: number; bodyType: number };

export const setScales = (scales: Scales) => rbx("https://avatar.roblox.com/v1/avatar/set-scales", { method: "POST", body: scales });

export type ScaleRule = { min: number; max: number; increment: number };

export type SkinColor = { hexColor: string; name: string };

/** Roblox's limits for each body scale, and its skin colour palettes. */
export async function avatarRules(): Promise<{ scales: Partial<Record<keyof Scales, ScaleRule>>; basic: SkinColor[]; all: SkinColor[] }> {
  const r = await rbx<{ scales: Partial<Record<keyof Scales, ScaleRule>>; basicBodyColorsPalette?: SkinColor[]; bodyColorsPalette?: SkinColor[] }>(
    "https://avatar.roblox.com/v1/avatar-rules",
  );
  return { scales: r.scales ?? {}, basic: r.basicBodyColorsPalette ?? [], all: r.bodyColorsPalette ?? [] };
}

export type InventoryItem = { id: number; name: string; assetTypeId: number };

export async function inventory(userId: number, assetTypeIds: number[]): Promise<InventoryItem[]> {
  const lists = await Promise.all(
    assetTypeIds.map(async (t) => {
      const res = await rbx<{ data: { assetId?: number; id?: number; name?: string; assetName?: string }[] }>(
        `https://inventory.roblox.com/v2/users/${userId}/inventory/${t}?limit=100&sortOrder=Desc`,
      ).catch(() => ({ data: [] }));
      return res.data.map((r) => ({ id: (r.assetId ?? r.id)!, name: r.name ?? r.assetName ?? "", assetTypeId: t }));
    }),
  );
  return lists.flat();
}

export type Outfit = { id: number; name: string };

export async function outfits(userId: number): Promise<Outfit[]> {
  const res = await rbx<{ data: Outfit[] }>(
    `https://avatar.roblox.com/v1/users/${userId}/outfits?page=1&itemsPerPage=50&isEditable=true`,
  );
  return res.data;
}

export const wearOutfit = (outfitId: number) =>
  rbx(`https://avatar.roblox.com/v1/outfits/${outfitId}/wear`, { method: "POST" });

export type CatalogItem = {
  id: number;
  itemType: "Asset" | "Bundle";
  name: string;
  creatorName: string;
  creatorHasVerifiedBadge?: boolean;
  price?: number;
  lowestPrice?: number;
  priceStatus?: string;
  assetType?: number;
  favoriteCount?: number;
  itemRestrictions?: string[];
};

export async function catalogSearch(params: { category: number; subcategory?: number; keyword?: string; cursor?: string }) {
  // v1 (not v2) actually honours the Category filter.
  const q = new URLSearchParams({ Category: String(params.category), Limit: "30", SortType: "0" });
  if (params.subcategory) q.set("Subcategory", String(params.subcategory));
  if (params.keyword) q.set("Keyword", params.keyword);
  if (params.cursor) q.set("Cursor", params.cursor);
  return rbx<{ data: CatalogItem[]; nextPageCursor: string | null }>(
    `https://catalog.roblox.com/v1/search/items/details?${q}`,
  );
}

export type Conversation = {
  id: string;
  title: string;
  type: "direct" | "group";
  participants: number[];
  lastMessage: string;
  unreadCount: number;
  updatedAt: string;
  lastMessageAt: string;
};

/** `type` is "system" for Roblox notices (e.g. "You unlocked chat without filters"), which have no sender. */
export type ChatMessage = { id: string; content: string; senderUserId: number; createdAt: string; repliesTo?: string | null; type?: string };

export const chatThreads = (cursor = "") =>
  call<{ conversations: Conversation[]; nextCursor: string }>("chatListThreads", cursor);

export const chatMessages = (conversationId: string, cursor = "") =>
  call<{ ok: boolean; messages: ChatMessage[]; nextCursor: string }>("chatGetMessages", conversationId, cursor);

const CHAT = "https://apis.roblox.com/platform-chat-api/v1";

/**
 * Send a message. Messages carry a `replies_to` field (seen in Roblox's own message
 * data), but its send shape isn't documented — so if Roblox rejects a reply we resend
 * it as a plain message rather than losing it.
 */
export async function sendChat(conversationId: string, content: string, repliesTo?: string) {
  if (repliesTo) {
    try {
      return await rbx(`${CHAT}/send-messages`, {
        method: "POST",
        body: { conversation_id: conversationId, messages: [{ content, replies_to: repliesTo }] },
      });
    } catch (e) {
      if (!(e instanceof RobloxError) || e.status >= 500 || e.status === 401) throw e;
    }
  }
  return rbx(`${CHAT}/send-messages`, {
    method: "POST",
    body: { conversation_id: conversationId, messages: [{ content }] },
  });
}

/** Open (or create) a one-to-one conversation with a user. Returns the conversation id. */
export async function startConversation(userId: number): Promise<string> {
  const res = await rbx<{ conversations: { id: string }[] }>(`${CHAT}/create-conversations`, {
    method: "POST",
    body: { conversations: [{ type: "one_to_one", participant_user_ids: [userId] }], include_user_data: true },
  });
  const id = res.conversations?.[0]?.id;
  if (!id) throw new Error(t("Roblox didn't return a conversation."));
  return id;
}

/** Create a group chat. Returns the conversation id. */
export async function startGroupChat(name: string, userIds: number[]): Promise<string> {
  const res = await rbx<{ conversations: { id: string }[] }>(`${CHAT}/create-conversations`, {
    method: "POST",
    body: { conversations: [{ type: "group", name, participant_user_ids: userIds }], include_user_data: true },
  });
  const id = res.conversations?.[0]?.id;
  if (!id) throw new Error(t("Roblox didn't return a conversation."));
  return id;
}

export const markConversationsRead = (ids: string[]) =>
  rbx(`${CHAT}/mark-conversations`, { method: "POST", body: { conversation_ids: ids } }).catch(() => undefined);

export const sendTyping = (conversationId: string) =>
  rbx(`${CHAT}/update-typing-status`, { method: "POST", body: { conversation_id: conversationId } }).catch(() => undefined);

export const addChatMembers = (conversationId: string, userIds: number[]) =>
  rbx(`${CHAT}/add-users`, { method: "POST", body: { conversation_id: conversationId, user_ids: userIds } });

export const removeChatMembers = (conversationId: string, userIds: number[]) =>
  rbx(`${CHAT}/remove-users`, { method: "POST", body: { conversation_id: conversationId, user_ids: userIds } });

export async function connections(
  userId: number,
  kind: "followers" | "followings",
): Promise<{ id: number; name: string; displayName: string; hasVerifiedBadge?: boolean }[]> {
  const res = await rbx<{ data: { id: number }[] }>(
    `https://friends.roblox.com/v1/users/${userId}/${kind}?limit=50&sortOrder=Desc`,
  );
  const ids = res.data.map((r) => r.id);
  const names = await usersByIds(ids);
  return ids.map((id) => {
    const u = names.get(id);
    return { id, name: u?.name ?? "", displayName: u?.displayName ?? u?.name ?? "", hasVerifiedBadge: u?.hasVerifiedBadge };
  });
}

export type WornItem = { id: number; name: string; price: number | null };

export async function currentlyWearing(userId: number): Promise<WornItem[]> {
  const res = await rbx<{ assetIds: number[] }>(`https://avatar.roblox.com/v1/users/${userId}/currently-wearing`);
  const ids = res.assetIds ?? [];
  if (!ids.length) return [];
  const details = await rbx<{ data: { id: number; name: string; price?: number; lowestPrice?: number }[] }>(
    "https://catalog.roblox.com/v1/catalog/items/details",
    { method: "POST", body: { items: ids.map((id) => ({ itemType: "Asset", id })) } },
  ).catch(() => ({ data: [] as { id: number; name: string; price?: number; lowestPrice?: number }[] }));
  const byId = new Map(details.data.map((d) => [d.id, d]));
  return ids.map((id) => {
    const d = byId.get(id);
    return { id, name: d?.name ?? "", price: d?.lowestPrice ?? d?.price ?? null };
  });
}

export type GroupDetail = {
  id: number;
  name: string;
  description: string;
  memberCount: number;
  hasVerifiedBadge: boolean;
  owner: { userId: number; username: string; displayName: string; hasVerifiedBadge: boolean } | null;
  shout: { body: string; poster: { userId: number; username: string; displayName: string } | null; updated: string } | null;
};

export const group = (groupId: number) => rbx<GroupDetail>(`https://groups.roblox.com/v1/groups/${groupId}`);

export type GroupMember = { id: number; name: string; displayName: string; hasVerifiedBadge: boolean; role: string };

export async function groupMembers(groupId: number, cursor = ""): Promise<{ members: GroupMember[]; nextCursor: string | null }> {
  const res = await rbx<{
    nextPageCursor: string | null;
    data: { user: { userId: number; username: string; displayName: string; hasVerifiedBadge: boolean }; role: { name: string } }[];
  }>(`https://groups.roblox.com/v1/groups/${groupId}/users?limit=25&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
  return {
    members: res.data.map((m) => ({
      id: m.user.userId,
      name: m.user.username,
      displayName: m.user.displayName,
      hasVerifiedBadge: m.user.hasVerifiedBadge,
      role: m.role.name,
    })),
    nextCursor: res.nextPageCursor,
  };
}

/* Membership actions (groups.roblox.com public spec). */
export type GroupMembership = { member: boolean; pending: boolean; role: string; rank: number };

export async function groupMembership(groupId: number): Promise<GroupMembership> {
  const res = await rbx<{ isPendingJoin?: boolean; userRole?: { role?: { name?: string; rank?: number } } }>(
    `https://groups.roblox.com/v1/groups/${groupId}/membership`,
  );
  const rank = res.userRole?.role?.rank ?? 0;
  return { member: rank > 0, pending: !!res.isPendingJoin, role: res.userRole?.role?.name ?? "", rank };
}

export const joinGroup = (groupId: number) => rbx(`https://groups.roblox.com/v1/groups/${groupId}/users`, { method: "POST" });
export const leaveGroup = (groupId: number, meId: number) =>
  rbx(`https://groups.roblox.com/v1/groups/${groupId}/users/${meId}`, { method: "DELETE" });
export const cancelGroupRequest = (groupId: number, meId: number) =>
  rbx(`https://groups.roblox.com/v1/groups/${groupId}/join-requests/users/${meId}`, { method: "DELETE" });

export async function groupGames(groupId: number): Promise<GameSummary[]> {
  const res = await rbx<{ data: { id: number; name: string; rootPlace?: { id: number } }[] }>(
    `https://games.roblox.com/v2/groups/${groupId}/games?accessFilter=Public&limit=10&sortOrder=Desc`,
  ).catch(() => ({ data: [] as { id: number; name: string; rootPlace?: { id: number } }[] }));
  return withStats(res.data.map((g) => ({ universeId: g.id, placeId: g.rootPlace?.id ?? 0, name: g.name })));
}

export type GamePass = {
  id: number;
  name: string;
  price: number | null;
  productId: number | null;
  sellerId: number | null;
  owned: boolean;
};

export async function gamePasses(universeId: number, userId?: number): Promise<GamePass[]> {
  const res = await rbx<{ gamePasses: { id: number; name: string; displayName: string }[] }>(
    `https://apis.roblox.com/game-passes/v1/universes/${universeId}/game-passes?count=100`,
  ).catch(() => ({ gamePasses: [] as { id: number; name: string; displayName: string }[] }));
  const passes = res.gamePasses ?? [];
  // Prices + purchase data come from per-pass product-info; fetch in parallel (cap to keep it light).
  const priced = await Promise.all(
    passes.slice(0, 24).map(async (p) => {
      const [info, owned] = await Promise.all([
        rbx<{ PriceInRobux?: number | null; ProductId?: number; IsForSale?: boolean; Creator?: { CreatorTargetId?: number } }>(
          `https://apis.roblox.com/game-passes/v1/game-passes/${p.id}/product-info`,
        ).catch(() => ({}) as { PriceInRobux?: number | null }),
        userId
          ? rbx<boolean>(`https://inventory.roblox.com/v1/users/${userId}/items/GamePass/${p.id}/is-owned`).catch(() => false)
          : Promise.resolve(false),
      ]);
      const i = info as { PriceInRobux?: number | null; ProductId?: number; Creator?: { CreatorTargetId?: number } };
      return {
        id: p.id,
        name: p.displayName || p.name,
        price: i.PriceInRobux ?? null,
        productId: i.ProductId ?? null,
        sellerId: i.Creator?.CreatorTargetId ?? null,
        owned: owned === true,
      };
    }),
  );
  return priced.filter((p) => p.price != null || p.owned);
}

export async function peopleAlsoJoin(universeId: number): Promise<GameSummary[]> {
  const res = await rbx<{
    games: { universeId: number; placeId: number; name: string; totalUpVotes: number; totalDownVotes: number; playerCount: number }[];
  }>(`https://games.roblox.com/v1/games/recommendations/game/${universeId}?maxRows=6`).catch(() => ({ games: [] as any[] }));
  return (res.games ?? []).map((g) => ({
    universeId: g.universeId,
    placeId: g.placeId,
    name: g.name,
    upVotes: g.totalUpVotes,
    downVotes: g.totalDownVotes,
    playing: g.playerCount,
  }));
}

export const unreadNotifications = () =>
  rbx<{ unreadNotifications: number }>("https://notifications.roblox.com/v2/stream-notifications/unread-count").then(
    (r) => r.unreadNotifications,
  );

export type NotifAction =
  | { kind: "profile"; userId: number }
  | { kind: "chat"; userId: number }
  | { kind: "experience"; placeId?: number; universeId?: number; name?: string }
  | { kind: "community"; groupId: number }
  | { kind: "item"; itemType: "Asset" | "Bundle"; id: number }
  | { kind: "game"; universeId: number }
  | { kind: "dismiss" }
  | { kind: "none" };

export type NotifButton = { label: string; primary: boolean; action: NotifAction };

export type NotifThumb = { id: number; kind: "user" | "group" | "asset" | "game" };

export type Notification = {
  id: string;
  type: string;
  thumbnail?: NotifThumb;
  title?: string;
  body: string;
  timestamp: string;
  interacted: boolean;
  buttons: NotifButton[];
  /** What tapping the notification itself does (its body deep link). */
  bodyAction: NotifAction;
};

function thumbKind(idType: string | undefined): NotifThumb["kind"] {
  const t = (idType || "").toLowerCase();
  if (t.includes("group")) return "group";
  if (t.includes("asset") || t.includes("catalog") || t.includes("item") || t.includes("bundle")) return "asset";
  if (t.includes("game") || t.includes("universe") || t.includes("experience") || t.includes("place")) return "game";
  return "user";
}

function parseDeeplink(path: string | undefined, payload?: Record<string, unknown>): NotifAction {
  if (!path) return { kind: "none" };
  const num = (s: string | null) => (s ? Number(s) || undefined : undefined);
  // The deep-link formats Roblox notifications use.
  try {
    const u = new URL(path.replace("roblox://", "https://x/"));
    const q = (k: string) => u.searchParams.get(k) ?? u.searchParams.get(k.toLowerCase());
    if (path.includes("navigation/profile")) return { kind: "profile", userId: num(q("userId")) ?? 0 };
    if (path.includes("navigation/chat")) return { kind: "chat", userId: num(q("userId")) ?? 0 };
    if (path.includes("navigation/group")) {
      const groupId = num(q("groupId"));
      if (groupId) return { kind: "community", groupId };
    }
    if (path.includes("navigation/item_details")) {
      const id = num(q("itemId"));
      if (id) return { kind: "item", itemType: /bundle/i.test(q("itemType") ?? "") ? "Bundle" : "Asset", id };
    }
    if (path.includes("navigation/game_details")) {
      const universeId = num(q("gameId"));
      if (universeId) return { kind: "game", universeId };
    }
  } catch {
    /* fall through */
  }
  if (payload && (payload.root_place_id || payload.place_id)) {
    return {
      kind: "experience",
      placeId: Number(payload.root_place_id ?? payload.place_id) || undefined,
      universeId: Number(payload.universe_id) || undefined,
    };
  }
  return { kind: "none" };
}

/** One page of the notification stream (Roblox allows at most 20 per call). */
export async function notifications(startIndex = 0): Promise<Notification[]> {
  const raw = await rbx<any[]>(`https://notifications.roblox.com/v2/stream-notifications/get-recent?startIndex=${startIndex}&maxRows=20`);
  if (!Array.isArray(raw)) return [];
  const out: Notification[] = [];
  for (const n of raw) {
    const vis = n?.content?.states?.default?.visualItems ?? n?.content?.states?.[n?.content?.currentState]?.visualItems;
    if (!vis) continue;
    const tb = vis.textBody?.[0];
    const body = tb?.label?.text ?? "";
    if (!body) continue;
    const title = tb?.title?.text;
    const payload = tb?.clientEventsPayload as Record<string, unknown> | undefined;
    const name = payload ? /join (.+?)!?$/.exec(body)?.[1] : undefined;
    const thumbRaw = (vis.thumbnail ?? [])[0];
    const thumb: NotifThumb | undefined =
      thumbRaw && thumbRaw.id ? { id: Number(thumbRaw.id), kind: thumbKind(thumbRaw.idType) } : undefined;
    const buttons: NotifButton[] = (vis.button ?? []).map((b: any) => {
      const acts = b.actions ?? [];
      const dismiss = acts.find((a: any) => a.actionType === "dismiss" || a.actionType === "notificationAPI");
      const link = acts.find((a: any) => a.actionType === "deeplink");
      let action: NotifAction = dismiss && !link ? { kind: "dismiss" } : parseDeeplink(link?.path, payload);
      if (action.kind === "experience" && name) action = { ...action, name };
      return { label: b.label?.text ?? "", primary: b.buttonStyle === "Primary", action };
    });
    const bodyLink = (tb?.actions ?? []).find((a: any) => a.actionType === "deeplink");
    let bodyAction = parseDeeplink(bodyLink?.path, payload);
    if (bodyAction.kind === "experience" && name) bodyAction = { ...bodyAction, name };
    out.push({
      id: n.id,
      type: n?.content?.notificationType ?? "",
      thumbnail: thumb,
      title,
      body,
      timestamp: n.timestamp ?? "",
      interacted: !!n.isInteracted,
      buttons,
      bodyAction,
    });
  }
  return out;
}

export const clearNotificationsUnread = () =>
  rbx("https://notifications.roblox.com/v2/stream-notifications/clear-unread", { method: "POST" }).catch(() => undefined);

/* Friends, trusted friends, follows and blocks. Endpoints taken from Roblox's live web bundles (several are absent from the public docs). */

const FRIENDS = "https://friends.roblox.com/v1";

export type FriendStatus = "Friends" | "RequestSent" | "RequestReceived" | "NotFriends";

export async function friendStatus(meId: number, userId: number): Promise<FriendStatus> {
  const res = await rbx<{ data: { id: number; status: string }[] }>(
    `${FRIENDS}/users/${meId}/friends/statuses?userIds=${userId}`,
  );
  const s = res.data?.[0]?.status ?? "NotFriends";
  return (["Friends", "RequestSent", "RequestReceived"].includes(s) ? s : "NotFriends") as FriendStatus;
}

export const sendFriendRequest = (userId: number) =>
  rbx(`${FRIENDS}/users/${userId}/request-friendship`, {
    method: "POST",
    body: { friendshipOriginSourceType: "UserProfile" },
  });

export const unfriend = (userId: number) => rbx(`${FRIENDS}/users/${userId}/unfriend`, { method: "POST" });

export async function isFollowing(userId: number): Promise<boolean> {
  const res = await rbx<{ followings: { userId: number; isFollowing: boolean }[] }>(`${FRIENDS}/user/following-exists`, {
    method: "POST",
    body: { targetUserIds: [userId] },
  });
  return !!res.followings?.[0]?.isFollowing;
}

export const follow = (userId: number) => rbx(`${FRIENDS}/users/${userId}/follow`, { method: "POST" });
export const unfollow = (userId: number) => rbx(`${FRIENDS}/users/${userId}/unfollow`, { method: "POST" });

export type TrustedStatus = "TrustedFriends" | "RequestSent" | "RequestReceived" | "None";

export async function trustedStatus(userId: number): Promise<TrustedStatus> {
  const res = await rbx<{ status: string }>(`${FRIENDS}/my/trusted-friends/${userId}/status`).catch(() => ({ status: "None" }));
  const s = res.status ?? "None";
  if (/^trusted/i.test(s)) return "TrustedFriends";
  if (/sent|outgoing/i.test(s)) return "RequestSent";
  if (/received|incoming/i.test(s)) return "RequestReceived";
  return "None";
}

export const sendTrustedFriendRequest = (userId: number) =>
  rbx(`${FRIENDS}/users/${userId}/send-trusted-friend-request`, { method: "POST", body: {} });
export const acceptTrustedFriendRequest = (userId: number) =>
  rbx(`${FRIENDS}/users/${userId}/accept-trusted-friend-request`, { method: "POST", body: {} });
export const removeTrustedFriend = (userId: number) =>
  rbx(`${FRIENDS}/users/${userId}/remove-trusted-friend`, { method: "POST" });

export async function trustedFriendRequests(): Promise<FriendRequest[]> {
  const res = await rbx<{ data: { id: number }[] }>(`${FRIENDS}/my/trusted-friends/requests?limit=50`).catch(() => ({
    data: [] as { id: number }[],
  }));
  const ids = (res.data ?? []).map((r) => r.id);
  const names = ids.length ? await usersByIds(ids) : new Map();
  return ids.map((id) => ({ id, name: names.get(id)?.name ?? "", displayName: names.get(id)?.displayName ?? "", created: "" }));
}

const BLOCK = "https://apis.roblox.com/user-blocking-api/v1/users";
/** Whether you've blocked this person (Roblox answers a bare boolean or { isBlocked }). */
export const isBlocked = (userId: number) =>
  rbx<boolean | { isBlocked?: boolean }>(`${BLOCK}/${userId}/is-blocked`).then((r) => (typeof r === "boolean" ? r : !!r?.isBlocked));
export const blockUser = (userId: number) => rbx(`${BLOCK}/${userId}/block-user`, { method: "POST" });
export const unblockUser = (userId: number) => rbx(`${BLOCK}/${userId}/unblock-user`, { method: "POST" });

/* Purchasing: the same calls Roblox's website makes (its ItemPurchase bundle). The expected price is
 * re-checked server-side, so a price change between viewing and buying can never overcharge. */

export type PurchaseInfo = {
  itemType: "Asset" | "Bundle";
  id: number;
  name: string;
  price: number | null;
  priceStatus?: string;
  owned: boolean;
  productId: number | null;
  collectibleItemId: string | null;
  collectibleProductId: string | null;
  sellerId: number;
  sellerType: "User" | "Group";
  sellerName: string;
};

export async function purchaseInfo(itemType: "Asset" | "Bundle", id: number, meId: number): Promise<PurchaseInfo> {
  const [det, owned] = await Promise.all([
    rbx<{ data: any[] }>("https://catalog.roblox.com/v1/catalog/items/details", {
      method: "POST",
      body: { items: [{ itemType, id }] },
    }),
    rbx<boolean>(`https://inventory.roblox.com/v1/users/${meId}/items/${itemType}/${id}/is-owned`).catch(() => false),
  ]);
  const d = det.data?.[0];
  if (!d) throw new Error(t("Item not found."));
  let collectibleProductId: string | null = null;
  if (d.collectibleItemId) {
    const mi = await rbx<any[]>("https://apis.roblox.com/marketplace-items/v1/items/details", {
      method: "POST",
      body: { itemIds: [d.collectibleItemId] },
    }).catch(() => [] as any[]);
    collectibleProductId = mi?.[0]?.collectibleProductId ?? null;
  }
  return {
    itemType,
    id,
    name: d.name,
    price: d.lowestPrice ?? d.price ?? null,
    priceStatus: d.priceStatus,
    owned: owned === true,
    productId: d.productId ?? null,
    collectibleItemId: d.collectibleItemId ?? null,
    collectibleProductId,
    sellerId: d.creatorTargetId,
    sellerType: d.creatorType === "Group" ? "Group" : "User",
    sellerName: d.creatorName,
  };
}

/** Buy a catalog item (asset or bundle) with Robux. Throws with Roblox's reason on failure. */
export async function purchaseItem(info: PurchaseInfo, meId: number): Promise<void> {
  const price = info.price ?? 0;
  if (info.collectibleItemId) {
    const res = await rbx<{ purchased?: boolean; errorMessage?: string; purchaseResult?: string }>(
      `https://apis.roblox.com/marketplace-sales/v1/item/${info.collectibleItemId}/purchase-item`,
      {
        method: "POST",
        body: {
          collectibleItemId: info.collectibleItemId,
          collectibleProductId: info.collectibleProductId,
          expectedCurrency: 1,
          expectedPrice: price,
          expectedPurchaserId: meId,
          expectedPurchaserType: "User",
          expectedSellerId: info.sellerId,
          expectedSellerType: info.sellerType,
          idempotencyKey: crypto.randomUUID(),
        },
      },
    );
    if (res.purchased === false) throw new Error(res.errorMessage || res.purchaseResult || t("Purchase failed."));
    if (info.itemType === "Asset") noteBought(info.id);
    return;
  }
  if (!info.productId) throw new Error(t("This item can't be bought."));
  const res = await rbx<{ purchased?: boolean; reason?: string; errorMsg?: string }>(
    `https://economy.roblox.com/v1/purchases/products/${info.productId}`,
    { method: "POST", body: { expectedCurrency: 1, expectedPrice: price, expectedSellerId: info.sellerId } },
  );
  if (res.purchased === false) throw new Error(res.errorMsg || res.reason || t("Purchase failed."));
  if (info.itemType === "Asset") noteBought(info.id);
}

/** Buy a game pass with Robux. */
export async function purchaseGamePass(pass: GamePass): Promise<void> {
  if (!pass.productId || pass.sellerId == null) throw new Error(t("This pass can't be bought."));
  const res = await rbx<{ purchased?: boolean; reason?: string; errorMsg?: string }>(
    `https://apis.roblox.com/game-passes/v1/game-passes/${pass.productId}/purchase`,
    { method: "POST", body: { expectedCurrency: 1, expectedPrice: pass.price ?? 0, expectedSellerId: pass.sellerId } },
  );
  if (res.purchased === false) throw new Error(res.errorMsg || res.reason || t("Purchase failed."));
}

export type MarketSub = { name: string; taxonomy: string };
export type MarketCategory = { name: string; taxonomy: string; subcategories: MarketSub[] };

export async function marketCategories(): Promise<MarketCategory[]> {
  const res = await rbx<{ categories: { name: string; taxonomy: string; subcategories?: { name: string; taxonomy: string }[] }[] }>(
    "https://catalog.roblox.com/v1/search/navigation-menu-items",
  );
  return (res.categories ?? [])
    .filter((c) => c.taxonomy)
    .map((c) => ({
      name: c.name,
      taxonomy: c.taxonomy,
      subcategories: (c.subcategories ?? []).filter((s) => s.taxonomy).map((s) => ({ name: s.name, taxonomy: s.taxonomy })),
    }));
}

export async function marketSearch(params: {
  taxonomy?: string;
  keyword?: string;
  cursor?: string;
  creatorId?: number;
  /** "trending" = best-selling this week (the app's Trending Items). */
  sort?: "trending";
  limit?: number;
  filters?: MarketFilters;
}) {
  const f = params.filters ?? DEFAULT_FILTERS;
  const q = new URLSearchParams({ limit: String(params.limit ?? 30), salesTypeFilter: f.sale === "limited" ? "2" : "1" });
  if (params.sort === "trending") {
    q.set("sortType", "2");
    q.set("sortAggregation", "3");
  }
  const SORTS: Record<MarketFilters["sort"], [string, string?]> = {
    relevance: ["0"],
    favorited: ["1", "5"],
    bestselling: ["2", "5"],
    recent: ["3"],
    priceLow: ["4"],
    priceHigh: ["5"],
  };
  if (f.sort !== "relevance") {
    const [t, agg] = SORTS[f.sort];
    q.set("sortType", t);
    if (agg) q.set("sortAggregation", agg);
  }
  if (f.price === "free") {
    q.set("minPrice", "0");
    q.set("maxPrice", "0");
  } else {
    if (f.minPrice != null) q.set("minPrice", String(f.minPrice));
    if (f.maxPrice != null) q.set("maxPrice", String(f.maxPrice));
  }
  if (f.offSale !== "hide") q.set("includeNotForSale", "true");
  if (f.creator?.type === "User" && f.creator.name) q.set("creatorName", f.creator.name);
  if (f.creator?.type === "Group" && f.creator.id) {
    q.set("creatorTargetId", String(f.creator.id));
    q.set("creatorType", "Group");
  }
  if (params.taxonomy) q.set("taxonomy", params.taxonomy);
  if (params.keyword) q.set("keyword", params.keyword);
  if (params.cursor) q.set("cursor", params.cursor);
  if (params.creatorId) {
    q.set("creatorTargetId", String(params.creatorId));
    q.set("creatorType", "User");
    q.set("sortType", "3");
  }
  const res = await rbx<{ data: CatalogItem[]; nextPageCursor: string | null }>(`https://catalog.roblox.com/v2/search/items/details?${q}`);
  // "Off sale only" has no server filter: keep the off-sale rows of each page.
  if (f.offSale === "only") res.data = (res.data ?? []).filter((i) => (i as { priceStatus?: string }).priceStatus === "Off Sale");
  return res;
}

/** Marketplace filters (the app's Filter sheet, plus a few extra). */
export type MarketFilters = {
  sort: "relevance" | "favorited" | "bestselling" | "recent" | "priceLow" | "priceHigh";
  price: "any" | "free";
  minPrice?: number | null;
  maxPrice?: number | null;
  sale: "all" | "limited";
  offSale: "hide" | "show" | "only";
  creator?: { type: "User" | "Group"; name?: string; id?: number } | null;
};
export const DEFAULT_FILTERS: MarketFilters = { sort: "relevance", price: "any", sale: "all", offSale: "hide", creator: null };
export const filtersActive = (f: MarketFilters) => JSON.stringify(f) !== JSON.stringify(DEFAULT_FILTERS);

/** Full-body avatars (Body → Full Bodies) — the app's "Avatars" tab and Home's "Discover Avatars". */
export async function discoverAvatars(cursor = ""): Promise<{ data: CatalogItem[]; nextPageCursor: string | null }> {
  const cats = await marketCategories();
  const full = cats.flatMap((c) => c.subcategories).find((s) => /full bod/i.test(s.name));
  if (!full) return { data: [], nextPageCursor: null };
  return marketSearch({ taxonomy: full.taxonomy, cursor });
}

/** "Recommended For You": the same widget feed the real marketplace home uses. */
export async function marketRecommended(): Promise<CatalogItem[]> {
  const res = await rbx<{ widgets: Record<string, { type: string; content: { type: string; id: number }[] }> }>(
    "https://apis.roblox.com/marketplace-widgets/v1/widgets/web",
  );
  const items = Object.values(res.widgets ?? {})
    .flatMap((w) => w.content ?? [])
    .slice(0, 60);
  if (!items.length) return [];
  const det = await rbx<{ data: CatalogItem[] }>("https://catalog.roblox.com/v1/catalog/items/details", {
    method: "POST",
    body: { items: items.map((i) => ({ itemType: i.type === "Bundle" ? "Bundle" : "Asset", id: i.id })) },
  });
  return det.data ?? [];
}

/** A creator's own for-sale items (the "Store" row on a profile). */
export async function userStore(userId: number): Promise<CatalogItem[]> {
  const res = await marketSearch({ creatorId: userId }).catch(() => ({ data: [] as CatalogItem[] }));
  return res.data ?? [];
}

export const updateDescription = (description: string) =>
  rbx("https://users.roblox.com/v1/description", { method: "POST", body: { description } });

export type ItemDetail = CatalogItem & { description?: string; creatorTargetId?: number; creatorType?: string };

export async function itemDetail(itemType: "Asset" | "Bundle", id: number): Promise<ItemDetail> {
  const res = await rbx<{ data: ItemDetail[] }>("https://catalog.roblox.com/v1/catalog/items/details", {
    method: "POST",
    body: { items: [{ itemType, id }] },
  });
  const d = res.data?.[0];
  if (!d) throw new Error(t("Item not found."));
  return d;
}

/** Equip / unequip a single owned asset (the same calls Roblox's avatar editor makes). */
export const wearAsset = (assetId: number) => rbx(`https://avatar.roblox.com/v1/avatar/assets/${assetId}/wear`, { method: "POST" });
export const removeAsset = (assetId: number) =>
  rbx(`https://avatar.roblox.com/v1/avatar/assets/${assetId}/remove`, { method: "POST" });

// Same request shape as Roblox's avatar editor (PATCH /v4/avatar → avatarDefinition.updateAvatarConfig).
export const setAvatarBackground = (assetId: number | null) =>
  rbx("https://avatar.roblox.com/v4/avatar", {
    method: "PATCH",
    body: {
      updateTypes: ["UpdateBackground"],
      avatarDefinition: { updateAvatarConfig: { backgroundRequestModel: { id: assetId ?? 0 } } },
    },
  });

const setEmotes = (emotes: { assetId: number; position: number }[]) =>
  rbx("https://avatar.roblox.com/v4/avatar", {
    method: "PATCH",
    body: { updateTypes: ["UpdateEmotes"], avatarDefinition: { updateAvatarConfig: { emoteRequestModels: emotes } } },
  });

/** Equip into `position` (or the first free slot), replacing whatever was there. */
export function equipEmote(current: EquippedEmote[], assetId: number, position?: number) {
  const used = new Set(current.map((e) => e.position));
  const slot = position ?? ([1, 2, 3, 4, 5, 6, 7, 8].find((p) => !used.has(p)) ?? 8);
  const next = current.filter((e) => e.position !== slot && e.assetId !== assetId).map(({ assetId, position }) => ({ assetId, position }));
  return setEmotes([...next, { assetId, position: slot }]);
}

export const unequipEmote = (current: EquippedEmote[], assetId: number) =>
  setEmotes(current.filter((e) => e.assetId !== assetId).map(({ assetId, position }) => ({ assetId, position })));

/** The backdrop asset on a user's profile (profile-platform API, same call roblox.com makes). */
export async function profileBackground(userId: number): Promise<number | null> {
  const res = await rbx<{ components?: { ProfileBackground?: { assetId?: number | null } } }>(
    "https://apis.roblox.com/profile-platform-api/v1/profiles/get",
    { method: "POST", body: { profileType: "User", profileId: String(userId), components: [{ component: "ProfileBackground" }] } },
  );
  return res.components?.ProfileBackground?.assetId || null;
}

/** Full-size image for a background asset (Roblox renders these as "AvatarBackground"). */
export async function backgroundImage(assetId: number): Promise<string | null> {
  const fileUrl = (id: number) =>
    rbx<{ locations?: { location?: string }[] }>(`https://assetdelivery.roblox.com/v2/assetId/${id}`)
      .then((r) => r.locations?.find((l) => l.location?.startsWith("https://"))?.location ?? null)
      .catch(() => null);
  // The original upload (full resolution, like the app) when Roblox serves it as an image…
  const original = await fileUrl(assetId);
  if (original) {
    if (await loadsAsImage(original)) return original;
    // …and most backgrounds are decals: a tiny model pointing at the real image. Follow it.
    const raw = await rbx<unknown>(original).catch(() => null);
    const bin = raw as { __btrBinary?: boolean; base64?: string } | null;
    const xml = typeof raw === "string" ? raw : bin?.__btrBinary && bin.base64 ? atob(bin.base64) : null;
    const m = typeof xml === "string" ? (xml.match(/asset\/?\?id=(\d+)/i) ?? xml.match(/rbxassetid:\/\/(\d+)/i)) : null;
    if (m) {
      const img = await fileUrl(Number(m[1]));
      if (img && (await loadsAsImage(img))) return img;
    }
  }
  // …otherwise Roblox's 768×432 render.
  const res = await rbx<{ data: { state: string; imageUrl: string | null }[] }>(
    `https://thumbnails.roblox.com/v1/assets?assetIds=${assetId}&size=768x432&format=Png`,
  );
  return res.data?.[0]?.imageUrl ?? null;
}

/** Whether a URL decodes as an image (asset files can also be models). */
function loadsAsImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const t = window.setTimeout(() => resolve(false), 8000);
    img.onload = () => {
      window.clearTimeout(t);
      resolve(img.naturalWidth > 0);
    };
    img.onerror = () => {
      window.clearTimeout(t);
      resolve(false);
    };
    img.src = url;
  });
}

type TryOnItem = { id: number; itemType: "Asset" | "Bundle"; assetType?: number };

/** Types where wearing a new one replaces the old one. */
const REPLACES = new Set([2, 11, 12, 17, 18, 27, 28, 29, 30, 31, 48, 50, 51, 52, 53, 54, 55, 79, 88, 89, 90, 76, 77]);

/** Animation asset types: climb, fall, idle, jump, run, swim, walk, and emotes. */
export const ANIMATION_TYPES = new Set([48, 50, 51, 52, 53, 54, 55, 61]);
/** Things an R6 avatar can't show: animations/emotes, R15 body parts, layered clothing, dynamic heads. */
export const R15_ONLY_TYPES = new Set([...ANIMATION_TYPES, 27, 28, 29, 30, 31, 64, 65, 66, 67, 68, 69, 70, 71, 72, 79]);

const itemTypesCache = new Map<string, Promise<{ id: number; type: number }[]>>();
/** The assets (with types) an item consists of: itself, or a bundle's contents. Cached. */
export function itemAssets(item: TryOnItem): Promise<{ id: number; type: number }[]> {
  const key = `${item.itemType}:${item.id}`;
  let p = itemTypesCache.get(key);
  if (!p) {
    p = tryOnAssets(item).catch((e) => {
      itemTypesCache.delete(key);
      throw e;
    });
    itemTypesCache.set(key, p);
  }
  return p;
}

/** Whether previewing/wearing this needs an R15 avatar. */
export async function needsR15(item: TryOnItem): Promise<boolean> {
  if (item.itemType === "Asset" && item.assetType != null) return R15_ONLY_TYPES.has(item.assetType);
  const parts = await itemAssets(item).catch(() => []);
  return parts.some((a) => R15_ONLY_TYPES.has(a.type));
}

/** The animation to play when previewing an item (an emote, an animation, or an animation pack). */
export async function previewAnimationId(item: TryOnItem): Promise<number | null> {
  if (item.itemType === "Asset") return item.assetType != null && ANIMATION_TYPES.has(item.assetType) ? item.id : null;
  const parts = await itemAssets(item).catch(() => []);
  // Emote first; for packs, walk reads best on a standing preview, then run, idle, jump…
  for (const t of [61, 55, 53, 51, 52, 50, 48, 54]) {
    const hit = parts.find((a) => a.type === t);
    if (hit) return hit.id;
  }
  return null;
}

async function tryOnAssets(item: TryOnItem): Promise<{ id: number; type: number }[]> {
  if (item.itemType === "Asset") return [{ id: item.id, type: item.assetType ?? 0 }];
  const b = await rbx<{ items: { id: number; type: string; assetType?: number }[] }>(`https://catalog.roblox.com/v1/bundles/${item.id}/details`);
  const parts = b.items.filter((i) => i.type === "Asset");
  // Bundle details usually carry each part's type already.
  if (parts.length && parts.every((i) => i.assetType)) return parts.map((i) => ({ id: i.id, type: i.assetType! }));
  const ids = parts.map((i) => i.id);
  if (!ids.length) return [];
  const d = await rbx<{ data: { id: number; assetType?: number }[] }>("https://catalog.roblox.com/v1/catalog/items/details", {
    method: "POST",
    body: { items: ids.map((id) => ({ itemType: "Asset", id })) },
  }).catch(() => ({ data: [] as { id: number; assetType?: number }[] }));
  const typed = new Map(d.data.filter((x) => x.assetType).map((x) => [x.id, x.assetType!]));
  // Bundle parts (body parts, heads, animations) aren't sold on their own, so the catalog
  // skips them: ask the asset service for their type instead.
  await Promise.all(
    ids
      .filter((id) => !typed.has(id))
      .map((id) =>
        rbx<{ AssetTypeId?: number }>(`https://economy.roblox.com/v2/assets/${id}/details`)
          .then((r) => r.AssetTypeId && typed.set(id, r.AssetTypeId))
          .catch(() => undefined),
      ),
  );
  return ids.filter((id) => typed.has(id)).map((id) => ({ id, type: typed.get(id)! }));
}

/**
 * Render the user's avatar wearing `item` without changing anything (avatar/render, the same
 * call roblox.com's "Try On" uses). Returns the 3D model metadata URL, or a PNG URL for 2D.
 */
/** The outfit with `item` put on: same-slot items are swapped out, everything else stays. */
export async function outfitWith(avatar: MyAvatar, item: TryOnItem): Promise<{ id: number; type: number; meta?: unknown }[]> {
  const add = await tryOnAssets(item);
  const replaced = new Set(add.map((a) => a.type).filter((t) => REPLACES.has(t)));
  // Any head in the item replaces whichever head you wear (classic or dynamic).
  if (replaced.has(17) || replaced.has(79)) {
    replaced.add(17);
    replaced.add(79);
  }
  const keep = avatar.assets.filter((a) => !replaced.has(a.assetType.id) && !add.some((x) => x.id === a.id));
  return [...keep.map((a) => ({ id: a.id, type: a.assetType.id, meta: a.meta })), ...add];
}

/** Any user's current avatar (same shape as the signed-in user's). */
export const userAvatar = (userId: number) => rbx<MyAvatar>(`https://avatar.roblox.com/v2/avatar/users/${userId}/avatar`);

export async function renderTryOn(avatar: MyAvatar, item: TryOnItem, kind: "3d" | "2d"): Promise<string> {
  const add = await tryOnAssets(item);
  const replaced = new Set(add.map((a) => a.type).filter((t) => REPLACES.has(t)));
  const keep = avatar.assets.filter((a) => !replaced.has(a.assetType.id) && !add.some((x) => x.id === a.id));
  const colors = Object.fromEntries(
    Object.entries(avatar.bodyColor3s ?? {}).map(([k, v]) => [k.replace("Color3", "Color"), v.startsWith("#") ? v : `#${v}`]),
  );
  const body = {
    thumbnailConfig: { thumbnailId: 1, thumbnailType: kind, size: "420x420" },
    avatarDefinition: {
      assets: [...keep.map((a) => ({ id: a.id, ...(a.meta ? { meta: a.meta } : {}) })), ...add.map((a) => ({ id: a.id }))],
      bodyColors: colors,
      scales: avatar.scales,
      playerAvatarType: { playerAvatarType: avatar.playerAvatarType },
    },
  };
  for (let attempt = 0; attempt < 12; attempt++) {
    const res = await rbx<{ state: string; imageUrl: string }>("https://avatar.roblox.com/v1/avatar/render", { method: "POST", body });
    if (res.state === "Completed" && res.imageUrl) return res.imageUrl;
    if (res.state === "Error" || res.state === "Blocked") throw new Error(t("Roblox couldn't render this item on your avatar."));
    await new Promise((r) => setTimeout(r, attempt < 3 ? 600 : 1200));
  }
  throw new Error(t("Roblox is still rendering. Try again in a moment."));
}

export const avatar3dFromUrl = (metaUrl: string) => rbx<Avatar3DMeta>(metaUrl);

type Vec3 = { x: number; y: number; z: number };
export type Avatar3DMeta = {
  camera: { position: Vec3; direction: Vec3; fov: number };
  aabb: { min: Vec3; max: Vec3 };
  mtl: string;
  obj: string;
  textures: string[];
};

/** Roblox CDN host for a content hash (the same scheme Roblox's own 3D viewer uses). */
export function rbxCdnUrl(hash: string): string {
  let i = 31;
  for (let n = 0; n < hash.length; n++) i ^= hash.charCodeAt(n);
  return `https://t${i % 8}.rbxcdn.com/${hash}`;
}

export async function avatar3d(userId: number): Promise<Avatar3DMeta> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await rbx<{ state: string; imageUrl: string | null }>(
      `https://thumbnails.roblox.com/v1/users/avatar-3d?userId=${userId}`,
    );
    if (res.state === "Completed" && res.imageUrl) return rbx<Avatar3DMeta>(res.imageUrl);
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(t("Roblox is still rendering this avatar. Try again in a moment."));
}

/** Roblox sometimes demands a verification "challenge" (captcha) for writes made outside its site. */
export const isChallenge = (e: unknown) => /challenge/i.test(e instanceof Error ? e.message : String(e ?? ""));

export type Playability = {
  universeId: number;
  isPlayable: boolean;
  playabilityStatus: string;
  unplayableDisplayText?: string | null;
};

export async function playability(universeId: number): Promise<Playability | null> {
  const r = await rbx<Playability[]>(`https://games.roblox.com/v1/games/multiget-playability-status?universeIds=${universeId}`).catch(() => null);
  return r?.[0] ?? null;
}

export async function universeOfPlace(placeId: number): Promise<number | null> {
  const r = await rbx<{ universeId?: number }>(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`).catch(() => null);
  return r?.universeId ?? null;
}

/** What to show for a game you can't just join. */
export function playBlock(p: Playability | null | undefined): { kind: "robux" | "fiat" | "age" | "banned" | "private" | "other"; text: string } | null {
  if (!p || p.isPlayable) return null;
  const s = p.playabilityStatus;
  const text = p.unplayableDisplayText?.trim();
  if (s === "PurchaseRequired") return { kind: "robux", text: text || "This experience needs to be bought before you can play." };
  if (s === "FiatPurchaseRequired") return { kind: "fiat", text: text || "This experience is bought with real money on roblox.com." };
  if (/Age|ParentalControl|SeventeenPlus|Unverified|ComplianceBlocked|AccountRestricted/i.test(s)) return { kind: "age", text: text || "This experience isn't available for your age or account settings." };
  if (/Unapproved|UnderReview|Moderated|Banned|IncorrectConfiguration/i.test(s)) return { kind: "banned", text: text || "This experience is unavailable right now." };
  if (/Private|FriendsOnly|GroupOnly|NoPublishedVersion|Permission/i.test(s)) return { kind: "private", text: text || "This experience is private." };
  return { kind: "other", text: text || "You can't join this experience right now." };
}
