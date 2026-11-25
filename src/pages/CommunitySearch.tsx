import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useMe, useNav } from "../app/store";
import { rbx } from "../lib/ipc";
import { Empty, ErrorState, Headshot, Icon, SkeletonGrid, Thumb, Verified } from "../components/ui";
import { t } from "../lib/i18n";

/*
 * Community discovery, as roblox.com/search/communities: friends' communities, Roblox's
 * suggested keyword rows, and keyword search. Same endpoints the site calls.
 */

const G = "https://groups.roblox.com/v1";
type Group = { id: number; name: string; memberCount: number; hasVerifiedBadge?: boolean };
type SearchPage = { data: Group[]; nextPageCursor: string | null; totalResults?: number };

const search = (keyword: string, cursor = "", limit = 10) =>
  rbx<SearchPage>(`${G}/groups/search?keyword=${encodeURIComponent(keyword)}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);

type FriendGroup = Group & { friends: number[] };
async function friendsGroups(userId: number): Promise<FriendGroup[]> {
  const r = await rbx<{ data: { user: { userId: number }; groups: { group: Group }[] }[] }>(`${G}/users/${userId}/friends/groups/roles`);
  const byId = new Map<number, FriendGroup>();
  for (const row of r.data ?? []) {
    for (const { group } of row.groups ?? []) {
      const g = byId.get(group.id) ?? { ...group, friends: [] };
      g.friends.push(row.user.userId);
      byId.set(group.id, g);
    }
  }
  return [...byId.values()].sort((a, b) => b.friends.length - a.friends.length);
}

const fmtMembers = (n: number) => t("{n} Members", { n });

function Card({ g, friends }: { g: Group; friends?: number[] }) {
  const { go } = useNav();
  return (
    <button className="cs-card" onClick={() => go({ name: "community", groupId: g.id })} title={g.name}>
      <Thumb type="GroupIcon" id={g.id} size="150x150" className="cs-art" />
      <span className="cs-name">
        <span className="ellipsis">{g.name}</span>
        {g.hasVerifiedBadge ? <Verified size={13} /> : null}
      </span>
      {friends ? (
        <span className="cs-friends">
          <span className="fp-stack">
            {friends.slice(0, 3).map((id) => (
              <Headshot key={id} userId={id} size={22} />
            ))}
          </span>
          {friends.length > 3 ? <span className="tiny muted">+{friends.length - 3}</span> : null}
        </span>
      ) : (
        <span className="tiny muted">{fmtMembers(g.memberCount)}</span>
      )}
    </button>
  );
}

function Row({ title, onAll, children }: { title: string; onAll?: () => void; children: React.ReactNode }) {
  return (
    <section className="cs-row">
      <div className="row-between">
        <h2 className="cs-title">{title}</h2>
        {onAll ? (
          <button className="cs-all" onClick={onAll}>
            {t("See All")} <Icon name="arrow-large-right" size={16} />
          </button>
        ) : null}
      </div>
      <div className="cs-strip">{children}</div>
    </section>
  );
}

function KeywordRow({ keyword, onAll }: { keyword: string; onAll: () => void }) {
  const q = useQuery({ queryKey: ["groupSearch", keyword, "row"], queryFn: () => search(keyword, "", 10), staleTime: 10 * 60_000 });
  if (!q.data?.data.length) return null;
  return (
    <Row title={keyword} onAll={onAll}>
      {q.data.data.map((g) => (
        <Card key={g.id} g={g} />
      ))}
    </Row>
  );
}

function Results({ keyword }: { keyword: string }) {
  const q = useInfiniteQuery({
    queryKey: ["groupSearch", keyword, "all"],
    queryFn: ({ pageParam }) => search(keyword, pageParam, 50),
    initialPageParam: "",
    getNextPageParam: (l) => l.nextPageCursor || undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  if (q.isLoading) return <SkeletonGrid count={18} />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!rows.length) return <Empty icon="two-folders">{t("No communities match “{keyword}”.", { keyword })}</Empty>;
  return (
    <>
      <div className="cs-grid">
        {rows.map((g) => (
          <Card key={g.id} g={g} />
        ))}
      </div>
      {q.hasNextPage ? (
        <button className="btn btn-secondary cs-more" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          {q.isFetchingNextPage ? t("Loading…") : t("Load more")}
        </button>
      ) : null}
    </>
  );
}

export function CommunitySearch({ q: initial = "" }: { q?: string }) {
  const me = useMe();
  const { go } = useNav();
  const [text, setText] = useState(initial);
  const [keyword, setKeyword] = useState(initial);
  const [friendsAll, setFriendsAll] = useState(false);
  useEffect(() => (setText(initial), setKeyword(initial)), [initial]);
  const meta = useQuery({
    queryKey: ["groupSearchMeta"],
    queryFn: () => rbx<{ SuggestedGroupKeywords?: string[]; ShowFriendsGroupsSort?: boolean }>(`${G}/groups/search/metadata`),
    staleTime: 60 * 60_000,
  });
  const fg = useQuery({ queryKey: ["friendsGroups", me.id], queryFn: () => friendsGroups(me.id!), enabled: !!me.id && meta.data?.ShowFriendsGroupsSort !== false, staleTime: 10 * 60_000 });

  const submit = () => setKeyword(text.trim());
  const back = keyword || friendsAll;

  return (
    <div className="page cs-page">
      <div className="row-between">
        <h1 className="cs-head">
          {back ? (
            <button className="icon-btn" onClick={() => (setKeyword(""), setText(""), setFriendsAll(false))} aria-label={t("Back")}>
              <Icon name="arrow-large-left" size={20} />
            </button>
          ) : null}
          {keyword ? t("Results for “{keyword}”", { keyword }) : friendsAll ? t("Friends' Communities") : t("Search Communities")}
        </h1>
        <button className="cs-all" onClick={() => go({ name: "communities" })}>
          {t("My Communities")} <Icon name="arrow-large-right" size={16} />
        </button>
      </div>
      <form
        className="filter cs-search"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Icon name="magnifying-glass" size={16} />
        <input placeholder={t("Search")} value={text} onChange={(e) => setText(e.target.value)} />
      </form>

      {keyword ? (
        <Results keyword={keyword} />
      ) : friendsAll ? (
        <div className="cs-grid">
          {(fg.data ?? []).map((g) => (
            <Card key={g.id} g={g} friends={g.friends} />
          ))}
        </div>
      ) : (
        <>
          <p className="cs-intro">
            {t("Join a community to connect with people like you! Communities exist for all types of communities - fan clubs, help communities, hobbies, corporations, and more. Communities have their own walls and shared places.")}
          </p>
          {fg.data?.length ? (
            <Row title={t("Friends' Communities")} onAll={() => setFriendsAll(true)}>
              {fg.data.slice(0, 12).map((g) => (
                <Card key={g.id} g={g} friends={g.friends} />
              ))}
            </Row>
          ) : null}
          {(meta.data?.SuggestedGroupKeywords ?? []).map((k) => (
            <KeywordRow key={k} keyword={k} onAll={() => (setText(k), setKeyword(k))} />
          ))}
        </>
      )}
    </div>
  );
}
