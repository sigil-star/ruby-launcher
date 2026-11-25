import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { charts, favoriteGames, searchGamesPage, searchUsersPage, type GameSummary } from "../lib/api";
import { rbx } from "../lib/ipc";
import { useMe, useNav } from "../app/store";
import { TileGrid } from "../components/games";
import { Select, Empty, ErrorState, Headshot, Icon, SectionHeader, SkeletonGrid, Spinner, Verified } from "../components/ui";
import { useHomeShelves } from "./Home";
import { t } from "../lib/i18n";

/** Full list for one explore sort (Top Trending, Up-and-Coming…), paged. */
async function sortGames(sortId: string): Promise<GameSummary[]> {
  type G = { universeId: number; rootPlaceId: number; name: string; totalUpVotes: number; totalDownVotes: number; playerCount: number };
  const out: GameSummary[] = [];
  const session = crypto.randomUUID();
  let token = "";
  for (let i = 0; i < 4; i++) {
    const r = await rbx<{ games?: G[]; nextPageToken?: string }>(
      `https://apis.roblox.com/explore-api/v1/get-sort-content?sessionId=${session}&sortId=${encodeURIComponent(sortId)}&device=computer&country=all${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`,
    );
    for (const g of r.games ?? [])
      if (!out.some((x) => x.universeId === g.universeId))
        out.push({ universeId: g.universeId, placeId: g.rootPlaceId, name: g.name, upVotes: g.totalUpVotes, downVotes: g.totalDownVotes, playing: g.playerCount });
    if (!r.nextPageToken) break;
    token = r.nextPageToken;
  }
  return out;
}

export function GameList({ kind }: { kind: string }) {
  const me = useMe();
  const { go } = useNav();
  const isFav = kind === "favorites";
  const isCont = kind === "continue";
  const sorts = useQuery({ queryKey: ["charts"], queryFn: charts, staleTime: 10 * 60_000 });
  const fav = useQuery({ queryKey: ["favorites", me.id], queryFn: () => favoriteGames(me.id), enabled: isFav });
  const home = useHomeShelves();
  const sort = useQuery({ queryKey: ["sortGames", kind], queryFn: () => sortGames(kind), enabled: !isFav && !isCont, staleTime: 5 * 60_000 });
  const preview = sorts.data?.find((s) => s.id === kind);
  const q = isFav ? fav : isCont ? home : sort;
  const games = isFav ? fav.data : isCont ? home.data?.find((s) => /continue/i.test(s.title))?.games : sort.data?.length ? sort.data : preview?.games;
  const title = isFav ? t("Favorites") : isCont ? t("Continue Playing") : (preview?.title ?? t("Experiences"));

  const options = [
    { value: "favorites", label: t("Favorites"), icon: "star" as const, group: t("Yours") },
    { value: "continue", label: t("Continue Playing"), icon: "clock" as const, group: t("Yours") },
    ...(sorts.data ?? []).map((s) => ({ value: s.id, label: s.title, icon: "play-small" as const, group: t("Charts") })),
  ];

  return (
    <div className="page">
      <div className="list-picker">
        <Select value={kind} options={options} onChange={(v) => go({ name: "list", kind: v })} ariaLabel={t("Choose a list")} />
      </div>
      <SectionHeader title={title} />
      {q.isLoading && !games?.length ? (
        <SkeletonGrid count={12} variant="tile" />
      ) : q.error && !games?.length ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : games?.length ? (
        <TileGrid games={games} />
      ) : (
        <Empty icon={isFav ? "star" : "clock"}>
          {isFav ? t("Experiences you favorite will show up here.") : isCont ? t("Experiences you play will show up here.") : t("Nothing in this chart right now.")}
        </Empty>
      )}
    </div>
  );
}

export function Search({ q }: { q: string }) {
  const { go } = useNav();
  // Roblox wants the same session id on every page of one search.
  const session = useMemo(() => crypto.randomUUID(), [q]);
  const games = useInfiniteQuery({
    queryKey: ["searchGamesPaged", q],
    queryFn: ({ pageParam }) => searchGamesPage(q, session, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
  });
  const people = useInfiniteQuery({
    queryKey: ["searchUsersPaged", q],
    queryFn: ({ pageParam }) => searchUsersPage(q, pageParam, pageParam ? 25 : 10),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    retry: false,
  });
  const gameList = useMemo(() => {
    const seen = new Set<number>();
    return (games.data?.pages ?? []).flatMap((p) => p.games).filter((g) => !seen.has(g.universeId) && (seen.add(g.universeId), true));
  }, [games.data]);
  const peopleList = useMemo(() => {
    const seen = new Set<number>();
    return (people.data?.pages ?? []).flatMap((p) => p.data).filter((u) => !seen.has(u.id) && (seen.add(u.id), true));
  }, [people.data]);

  return (
    <div className="page">
      <h1 className="page-title">{t("Results for “{q}”", { q })}</h1>
      {peopleList.length ? (
        <section className="shelf">
          <SectionHeader title={t("People")} />
          <div className="friend-row hscroll">
            {peopleList.map((u) => (
              <button key={u.id} className="friend-bubble" onClick={() => go({ name: "profile", userId: u.id })}>
                <Headshot userId={u.id} size={104} />
                <div className="friend-name">
                  {u.displayName} {u.hasVerifiedBadge ? <Verified size={12} /> : null}
                </div>
                <div className="friend-sub">@{u.name}</div>
              </button>
            ))}
            {people.hasNextPage ? (
              <button className="friend-bubble more-bubble" disabled={people.isFetchingNextPage} onClick={() => void people.fetchNextPage()}>
                <span className="more-bubble-icon">{people.isFetchingNextPage ? <Spinner size={22} /> : <Icon name="chevron-small-right" size={28} />}</span>
                <div className="friend-name">{t("Show more")}</div>
                <div className="friend-sub">{t("people")}</div>
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
      <section className="shelf">
        <SectionHeader title={t("Experiences")} />
        {games.isLoading ? (
          <SkeletonGrid count={12} variant="tile" />
        ) : games.error && !gameList.length ? (
          <ErrorState error={games.error} retry={() => games.refetch()} />
        ) : gameList.length ? (
          <>
            <TileGrid games={gameList} />
            {games.hasNextPage ? (
              <button className="btn btn-secondary load-more" disabled={games.isFetchingNextPage} onClick={() => void games.fetchNextPage()}>
                {games.isFetchingNextPage ? <Spinner size={18} /> : t("Show more experiences")}
              </button>
            ) : null}
          </>
        ) : (
          <Empty icon="magnifying-glass">{t("No experiences found.")}</Empty>
        )}
      </section>
    </div>
  );
}
