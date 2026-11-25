/**
 * Communities (roles, forums, announcements, relations, store, funds) and profile extras.
 * Endpoints are the ones roblox.com's community and profile pages use.
 */
import { rbx } from "./ipc";
import type { CatalogItem } from "./api";

export type GroupRole = { id: number; name: string; rank: number; memberCount: number; isBase?: boolean };

export async function groupRoles(groupId: number): Promise<GroupRole[]> {
  const res = await rbx<{ roles: GroupRole[] }>(`https://groups.roblox.com/v1/groups/${groupId}/roles`);
  // Like the app: hide Guest and the built-in base "Member" role, lowest rank first.
  return (res.roles ?? []).filter((r) => r.rank > 0 && !r.isBase).sort((a, b) => a.rank - b.rank);
}

export type RoleMember = { id: number; name: string; displayName: string; hasVerifiedBadge: boolean };

/** Members of one role (the app's Members dropdown). */
export async function roleMembers(groupId: number, roleId: number, cursor = ""): Promise<{ members: RoleMember[]; nextCursor: string | null }> {
  const res = await rbx<{
    data: { userId: number; username: string; displayName: string; hasVerifiedBadge: boolean }[];
    nextPageCursor: string | null;
  }>(`https://groups.roblox.com/v1/groups/${groupId}/roles/${roleId}/users?limit=50&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
  return {
    members: (res.data ?? []).map((m) => ({ id: m.userId, name: m.username, displayName: m.displayName, hasVerifiedBadge: m.hasVerifiedBadge })),
    nextCursor: res.nextPageCursor,
  };
}

export type Reaction = { emoteId: string; reactionCount?: number; count?: number; hasUserAppliedReaction?: boolean; hasReacted?: boolean; areReactionCountsVisible?: boolean };
type RichContent = { plainText?: string | null; slate?: string | null; markdown?: string | null };

export type Announcement = {
  id: string;
  name?: string;
  createdAt?: string;
  createdBy?: number;
  /** Older shape. */
  content?: RichContent | string;
  /** Current shape (groups/v1/groups/{id}/announcements). */
  message?: { id: string; content?: RichContent; reactions?: Reaction[] };
  creatorInfo?: { displayName?: string; groupRoleName?: string; hasVerifiedBadge?: boolean };
};

/** Plain text from Roblox's Slate documents (announcements and forum posts are stored this way). */
export function richText(c?: RichContent | string | null): string {
  if (!c) return "";
  if (typeof c === "string") return c;
  if (c.plainText) return c.plainText;
  if (c.markdown) return c.markdown;
  if (!c.slate) return "";
  try {
    const walk = (n: { text?: string; type?: string; children?: unknown[] }): string =>
      n.text ?? (n.children ?? []).map((x) => walk(x as never)).join(n.type === "document" ? "\n" : "");
    return walk(JSON.parse(c.slate)).trim();
  } catch {
    return "";
  }
}

export const announcementText = (a: Announcement) => richText(a.message?.content ?? a.content);
export const announcementReactions = (a: Announcement) => a.message?.reactions ?? [];

/**
 * Communities' stock reaction emotes (groups/v1/groups/{id}/emotes → "GroupsStockEmotes").
 * Roblox draws them as images; their names map to these emoji.
 */
const STOCK_EMOTES: Record<string, string> = {
  "95eaaeeb-527b-4bf5-b78e-a6f01c7c30d5": "👍",
  "0385ec07-efb1-4d51-bcb1-8153488b392c": "❤️",
  "2f7812cb-9f27-4e2c-ade1-a721b5f3c748": "😮",
  "4eac0a44-723b-4e2a-be90-325cdda77d3f": "😢",
  "59a86c62-2ab4-4196-8d7f-706d46f166d6": "💀",
  "74de7ad0-097f-4ad6-9c29-d197aa8db467": "🔥",
  "abd770d9-89ec-4b81-a313-1a66ea922d13": "😠",
  "bc342b68-bafd-4fa2-a46d-4318c84ca7f8": "🤔",
  "ccc5c723-121a-411c-b632-41c16bd5a225": "😄",
};
export const reactionEmoji = (emoteId: string) => STOCK_EMOTES[emoteId] ?? "✨";
/** The stock emotes in the order the reaction picker shows them. */
export const STOCK_EMOTE_IDS = Object.keys(STOCK_EMOTES);

/** Cover photo + the tabs Roblox shows for a community (profile-platform API, profileType "Community"). */
export async function communityProfile(groupId: number): Promise<{ coverPhotoId: number | null; tabs: string[] }> {
  try {
    const r = await rbx<{ components?: { CoverPhoto?: { coverPhotoId?: number }; CommunityTabs?: { tabs?: string[] } } }>(
      "https://apis.roblox.com/profile-platform-api/v1/profiles/get",
      { method: "POST", body: { profileType: "Community", profileId: String(groupId), components: [{ component: "CoverPhoto" }, { component: "CommunityTabs" }] } },
    );
    return { coverPhotoId: r.components?.CoverPhoto?.coverPhotoId ?? null, tabs: r.components?.CommunityTabs?.tabs ?? [] };
  } catch {
    return { coverPhotoId: null, tabs: [] };
  }
}

export async function groupAnnouncements(groupId: number): Promise<Announcement[]> {
  try {
    return (await rbx<{ data: Announcement[] }>(`https://groups.roblox.com/v1/groups/${groupId}/announcements?limit=10`)).data ?? [];
  } catch {
    try {
      return (await rbx<{ data: Announcement[] }>(`https://groups.roblox.com/v1/groups/${groupId}/announcements/latest`)).data ?? [];
    } catch {
      return [];
    }
  }
}

export type Shout = { title?: string; content?: string; createdAt?: string; updatedAt?: string; createdBy?: number; likeCount?: number };

/** The current shout (community-links; empty 204 when there is none). */
export async function groupShout(groupId: number): Promise<Shout | null> {
  try {
    const r = await rbx<Shout | string | null>(`https://apis.roblox.com/community-links/v1/groups/${groupId}/shout`);
    return r && typeof r === "object" && (r.content || r.title) ? r : null;
  } catch {
    return null;
  }
}

export type RelatedGroup = { id: number; name: string; memberCount: number; hasVerifiedBadge?: boolean };

export async function groupRelations(groupId: number, kind: "allies" | "enemies"): Promise<RelatedGroup[]> {
  try {
    const r = await rbx<{ relatedGroups: RelatedGroup[] }>(
      `https://groups.roblox.com/v1/groups/${groupId}/relationships/${kind}?maxRows=50&sortOrder=Asc&startRowIndex=0`,
    );
    return r.relatedGroups ?? [];
  } catch {
    return [];
  }
}

export type SocialLinkRow = { id: number; type: string; url: string; title: string };

export async function groupSocialLinks(groupId: number): Promise<SocialLinkRow[]> {
  try {
    return (await rbx<{ data: SocialLinkRow[] }>(`https://groups.roblox.com/v1/groups/${groupId}/social-links`)).data ?? [];
  } catch {
    return [];
  }
}

export type GroupEvent = { id: string; title: string; description?: string; eventTime?: { startUtc?: string; endUtc?: string }; universeId?: number };

export async function groupEvents(groupId: number): Promise<GroupEvent[]> {
  try {
    return (await rbx<{ data: GroupEvent[] }>(`https://apis.roblox.com/virtual-events/v1/virtual-events/groups/${groupId}?limit=10`)).data ?? [];
  } catch {
    return [];
  }
}

/** One page (30) of a community's store, newest first; Roblox pages with a cursor. */
export async function groupStore(groupId: number, cursor = ""): Promise<{ items: CatalogItem[]; nextCursor: string | null }> {
  const q = new URLSearchParams({ limit: "30", salesTypeFilter: "1", creatorTargetId: String(groupId), creatorType: "Group", sortType: "3" });
  if (cursor) q.set("cursor", cursor);
  try {
    const r = await rbx<{ data: CatalogItem[]; nextPageCursor: string | null }>(`https://catalog.roblox.com/v2/search/items/details?${q}`);
    return { items: r.data ?? [], nextCursor: r.nextPageCursor };
  } catch {
    return { items: [], nextCursor: null };
  }
}

/**
 * When you and `friendId` became friends. Roblox doesn't expose it directly, but your friends
 * list pages newest-first and each page cursor ends in the last row's friendship time (.NET ticks).
 * Find the page holding the friend, then ask for exactly up to them to read their cursor.
 */
export async function friendsSince(meId: number, friendId: number): Promise<Date | null> {
  type Page = { PageItems: { id: number }[]; NextCursor: string | null };
  const url = (cursor: string, limit: number) => `https://friends.roblox.com/v1/users/${meId}/friends/find?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const ticksToDate = (c: string | null) => {
    const t = Number(c?.split(":")[1]);
    return Number.isFinite(t) && t > 6e17 ? new Date((t - 621355968000000000) / 10000) : null;
  };
  let cursor = "";
  for (let i = 0; i < 40; i++) {
    const page = await rbx<Page>(url(cursor, 50));
    const at = page.PageItems.findIndex((p) => p.id === friendId);
    if (at >= 0) {
      if (at === page.PageItems.length - 1) return ticksToDate(page.NextCursor);
      const exact = await rbx<Page>(url(cursor, at + 1));
      return ticksToDate(exact.NextCursor);
    }
    if (!page.NextCursor) return null;
    cursor = page.NextCursor;
  }
  return null;
}

/** Group funds — only for roles allowed to see them (403 otherwise → null). */
export async function groupFunds(groupId: number): Promise<number | null> {
  try {
    return (await rbx<{ robux: number }>(`https://economy.roblox.com/v1/groups/${groupId}/currency`)).robux;
  } catch {
    return null;
  }
}

export async function groupNameHistory(groupId: number): Promise<{ name: string; created: string }[]> {
  try {
    return (await rbx<{ data: { name: string; created: string }[] }>(`https://groups.roblox.com/v1/groups/${groupId}/name-history?limit=10&sortOrder=Desc`)).data ?? [];
  } catch {
    return [];
  }
}

export type PrimaryGroup = { group: { id: number; name: string; memberCount: number }; role: { name: string; rank: number } } | null;

export async function primaryGroup(userId: number): Promise<PrimaryGroup> {
  try {
    return await rbx<PrimaryGroup>(`https://groups.roblox.com/v1/users/${userId}/groups/primary/role`);
  } catch {
    return null;
  }
}

/* Forums (the app's Posts tab). */

/** What your role may do in a community's Posts (from the membership call's permissions). */
export type ForumPerms = { member: boolean; createPosts: boolean; createComments: boolean; removeComments: boolean };
export async function forumPerms(groupId: number): Promise<ForumPerms> {
  const r = await rbx<{ userRole?: { role?: { rank?: number } }; permissions?: { groupForumsPermissions?: Record<string, boolean> } }>(
    `https://groups.roblox.com/v1/groups/${groupId}/membership`,
  );
  const f = r.permissions?.groupForumsPermissions ?? {};
  return { member: (r.userRole?.role?.rank ?? 0) > 0, createPosts: !!f.createPosts, createComments: !!f.createComments, removeComments: !!f.removeComments };
}

export type ForumCategory = { id: string; name: string; description?: string; archivedAt?: string | null };

export type ForumComment = {
  id?: string;
  content?: RichContent;
  createdBy?: number;
  createdAt?: string;
  creatorInfo?: { displayName?: string; groupRoleName?: string; hasVerifiedBadge?: boolean };
  reactions?: Reaction[];
  replyCount?: number;
};

export type ForumPost = {
  id: string;
  name?: string;
  isPinned?: boolean;
  commentCount?: number;
  createdAt?: string;
  createdBy?: number;
  firstComment?: ForumComment;
};

export async function forumCategories(groupId: number): Promise<ForumCategory[]> {
  const r = await rbx<{ data: ForumCategory[] }>(`https://groups.roblox.com/v1/groups/${groupId}/forums`);
  return (r.data ?? []).filter((c) => !c.archivedAt);
}

export async function forumPosts(groupId: number, categoryId: string, cursor = ""): Promise<{ posts: ForumPost[]; nextCursor: string | null }> {
  const q = new URLSearchParams({ limit: "25" });
  if (cursor) q.set("cursor", cursor);
  const res = await rbx<{ data: ForumPost[]; nextPageCursor: string | null }>(
    `https://groups.roblox.com/v1/groups/${groupId}/forums/${categoryId}/posts?includeCommentCount=true&${q}`,
  );
  return { posts: res.data ?? [], nextCursor: res.nextPageCursor };
}

export async function forumPinned(groupId: number, categoryId: string): Promise<ForumPost[]> {
  try {
    return (
      (await rbx<{ data: ForumPost[] }>(`https://groups.roblox.com/v1/groups/${groupId}/forums/${categoryId}/posts/pinned?includeCommentCount=true`)).data ??
      []
    );
  } catch {
    return [];
  }
}

export async function forumComments(groupId: number, categoryId: string, postId: string, cursor = ""): Promise<{ comments: ForumComment[]; nextCursor: string | null }> {
  const q = new URLSearchParams({ limit: "25" });
  if (cursor) q.set("cursor", cursor);
  const res = await rbx<{ data: ForumComment[]; nextPageCursor: string | null }>(
    `https://groups.roblox.com/v1/groups/${groupId}/forums/${categoryId}/posts/${postId}/comments?${q}`,
  );
  return { comments: res.data ?? [], nextCursor: res.nextPageCursor };
}

export type Badge = { id: number; name: string; description?: string };

export async function userBadges(userId: number): Promise<Badge[]> {
  try {
    return (await rbx<{ data: Badge[] }>(`https://badges.roblox.com/v1/users/${userId}/badges?limit=25&sortOrder=Desc`)).data ?? [];
  } catch {
    return [];
  }
}

export type RobloxBadge = { id: number; name: string; description: string; imageUrl: string };

export async function robloxBadges(userId: number): Promise<RobloxBadge[]> {
  try {
    return await rbx<RobloxBadge[]>(`https://accountinformation.roblox.com/v1/users/${userId}/roblox-badges`);
  } catch {
    return [];
  }
}

export async function usernameHistory(userId: number): Promise<string[]> {
  try {
    return (await rbx<{ data: { name: string }[] }>(`https://users.roblox.com/v1/users/${userId}/username-history?limit=10&sortOrder=Desc`)).data.map((d) => d.name);
  } catch {
    return [];
  }
}

/** Public social links on a profile (accountinformation promotion-channels). */
export async function userSocialLinks(userId: number): Promise<[string, string][]> {
  try {
    const r = await rbx<Record<string, string | null>>(`https://accountinformation.roblox.com/v1/users/${userId}/promotion-channels?alwaysReturnUrls=true`);
    return Object.entries(r).filter((e): e is [string, string] => typeof e[1] === "string" && !!e[1]);
  } catch {
    return [];
  }
}

export async function canViewInventory(userId: number): Promise<boolean> {
  try {
    return (await rbx<{ canView: boolean }>(`https://inventory.roblox.com/v1/users/${userId}/can-view-inventory`)).canView;
  } catch {
    return false;
  }
}

export async function inventoryPage(userId: number, assetTypeId: number, cursor = ""): Promise<{ items: { id: number; name: string }[]; nextCursor: string | null }> {
  const res = await rbx<{ data: { assetId: number; assetName: string }[]; nextPageCursor: string | null }>(
    `https://inventory.roblox.com/v2/users/${userId}/inventory/${assetTypeId}?limit=50&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
  return { items: (res.data ?? []).map((d) => ({ id: d.assetId, name: d.assetName })), nextCursor: res.nextPageCursor };
}

/** Make a community your primary one (shown on your profile); same call roblox.com makes. */
export const setPrimaryGroup = (groupId: number) =>
  rbx("https://groups.roblox.com/v1/user/groups/primary", { method: "POST", body: { groupId } });


/** The profile header roblox.com draws: Plus / admin / verified marks and the counts (incl. mutuals). */
export type ProfileHeader = {
  isRobloxPlus: boolean;
  isRobloxAdmin: boolean;
  isVerified: boolean;
  counts: { friendsCount?: number; followersCount?: number; followingsCount?: number; mutualFriendsCount?: number; isMutualFriendsCountEnabled?: boolean };
};
export async function profileHeader(userId: number): Promise<ProfileHeader> {
  const r = await rbx<{ components?: { UserProfileHeader?: ProfileHeader & { isPremium?: boolean } } }>("https://apis.roblox.com/profile-platform-api/v1/profiles/get", {
    method: "POST",
    body: { profileType: "User", profileId: String(userId), components: [{ component: "UserProfileHeader" }] },
  });
  const h = r.components?.UserProfileHeader;
  // Roblox calls it isPremium in this response (Plus is Premium's new name).
  return { isRobloxPlus: !!(h?.isRobloxPlus ?? h?.isPremium), isRobloxAdmin: !!h?.isRobloxAdmin, isVerified: !!h?.isVerified, counts: h?.counts ?? {} };
}

/* Forum writes, as roblox.com's community page makes them. */
const G = "https://groups.roblox.com/v1/groups";

export const createForumPost = (groupId: number, categoryId: string, title: string, content: string) =>
  rbx<ForumPost>(`${G}/${groupId}/forums/${categoryId}/posts`, { method: "POST", body: { title, content } });

/** Reply to a post (repliesTo = a comment id to answer that comment). */
export const createForumComment = (groupId: number, categoryId: string, postId: string, content: string, repliesTo?: string) =>
  rbx<ForumComment>(`${G}/${groupId}/forums/${categoryId}/posts/${postId}/comments`, {
    method: "POST",
    body: repliesTo ? { repliesToPostCommentId: repliesTo, content } : { content },
  });

export const deleteForumComment = (groupId: number, categoryId: string, postId: string, commentId: string) =>
  rbx(`${G}/${groupId}/forums/${categoryId}/posts/${postId}/comments/${commentId}`, { method: "DELETE" });

/**
 * React to a post (its first comment) or a comment. The "channel" is the post for top-level
 * comments and the parent comment for replies, exactly like roblox.com.
 */
export const setForumReaction = (
  groupId: number,
  t: { categoryId: string; postId: string; channelId: string; commentId: string; isPostComment: boolean },
  emoteId: string,
  on: boolean,
) =>
  rbx(
    `${G}/${groupId}/forums/channels/${t.channelId}/comments/${t.commentId}/reactions/${emoteId}?categoryId=${t.categoryId}&postId=${t.postId}&isPostComment=${t.isPostComment}`,
    { method: on ? "POST" : "DELETE" },
  );
