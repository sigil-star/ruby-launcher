import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type UIEvent } from "react";
import { charts, discoverAvatars, friends, homeShelves, type Friend, type Shelf } from "../lib/api";
import { useMe, useNav, useUi } from "../app/store";
import { useFlip, usePresence } from "../lib/motion";
import { GameGrid, TileRow } from "../components/games";
import { gameEvents, type GameEvent } from "../lib/gamePage";
import { useGameThumb } from "../lib/thumbs";
import { ErrorState, Headshot, Icon, Robux, SectionHeader, Skel, SkeletonGrid, Thumb, Verified } from "../components/ui";
import { t, fmtDate } from "../lib/i18n";

export const useHomeShelves = () => useQuery({ queryKey: ["home"], queryFn: homeShelves, staleTime: 5 * 60_000 });
export const useFriends = (userId: number) =>
  useQuery({ queryKey: ["friends", userId], queryFn: () => friends(userId), refetchInterval: 45_000, enabled: !!userId });

function presenceLine(f: Friend) {
  const p = f.presence;
  if (!p) return "";
  if (p.userPresenceType === 2) return p.lastLocation || t("In experience");
  if (p.userPresenceType === 3) return t("In Studio");
  if (p.userPresenceType === 1) return t("Online");
  return "";
}

function FriendsRow() {
  const me = useMe();
  const { go } = useNav();
  const { play } = useUi();
  const { data, isFetching } = useFriends(me.id);
  const isLoading = !data?.length && isFetching;
  // Render in pages of 40 and add more as you near the end, so the whole list is reachable.
  const [limit, setLimit] = useState(40);
  const shown = (data ?? []).slice(0, limit);
  const onRowScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollLeft + el.clientWidth > el.scrollWidth - 800 && limit < (data?.length ?? 0)) setLimit((l) => l + 40);
  };
  // Friends coming online pop in, going offline slide out, and re-sorting glides into place.
  const rowRef = useRef<HTMLDivElement>(null);
  const list = usePresence(shown, (f) => f.id);
  useFlip(rowRef, list.map((x) => `${x.key}:${x.phase}`).join(","));
  // Like the app: clicking a friend opens a small card under them (Join / Chat / View profile).
  const [pop, setPop] = useState<{ f: Friend; x: number; y: number } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const toggle = (f: Friend, el: HTMLElement) => {
    if (pop?.f.id === f.id) return setPop(null);
    const r = el.getBoundingClientRect();
    setPop({ f, x: r.left + r.width / 2, y: r.bottom + 6 });
  };
  useEffect(() => {
    if (!pop) return;
    const close = (e: MouseEvent) => {
      const tg = e.target as HTMLElement;
      if (popRef.current?.contains(tg) || tg.closest(".friend-bubble")) return;
      setPop(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPop(null);
    const off = () => setPop(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", off);
    document.querySelector(".content")?.addEventListener("scroll", off, { once: true });
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", off);
    };
  }, [pop]);

  const p = pop?.f.presence;
  const inGame = p?.userPresenceType === 2 && (p.placeId || p.rootPlaceId);
  const head = (name: string) =>
    p?.userPresenceType === 2 ? t("{name} is playing", { name }) : p?.userPresenceType === 1 ? t("{name} is online", { name }) : t("{name} is offline", { name });

  return (
    <>
      <div className="friend-row hscroll" ref={rowRef} onScroll={onRowScroll}>
        <button className="friend-bubble" onClick={() => go({ name: "friends" })}>
          <div className="add-friends">
            <Icon name="person-plus" size={40} />
          </div>
          <div className="friend-name">{t("Add Friends")}</div>
        </button>
        {isLoading
          ? Array.from({ length: 12 }, (_, i) => (
              <div key={`sk${i}`} className="friend-bubble skel-bubble" style={{ animationDelay: `${i * 40}ms` }}>
                <Skel w={104} h={104} r="50%" />
                <Skel w={72} h={12} />
                <Skel w={56} h={10} />
              </div>
            ))
          : null}
        {list.map(({ item: f, phase }) => (
          <button
            key={f.id}
            data-flip={f.id}
            className={`friend-bubble ${phase} ${pop?.f.id === f.id ? "open" : ""}`}
            onClick={(e) => phase !== "exit" && toggle(f, e.currentTarget)}
          >
            <Headshot userId={f.id} size={104} presence={f.presence?.userPresenceType} />
            <div className="friend-name">{f.displayName}</div>
            <div className="friend-sub">{presenceLine(f)}</div>
          </button>
        ))}
      </div>
      {pop ? (
        <div className="presence-pop" ref={popRef} style={{ position: "fixed", left: pop.x, top: pop.y }}>
          {inGame ? (
            <div className="pop-game">
              <Thumb type="GameIcon" id={p!.universeId ?? undefined} className="square" />
              <div>
                <div className="pop-head">{head(pop.f.displayName)}</div>
                <div className="pop-title">{p!.lastLocation}</div>
              </div>
            </div>
          ) : (
            <div className="pop-head">{head(pop.f.displayName)}</div>
          )}
          {inGame ? (
            <button
              className="btn btn-primary"
              onClick={() => play(p!.placeId || p!.rootPlaceId!, p!.lastLocation || "experience", p!.gameId ?? undefined)}
            >
              {t("Join")}
            </button>
          ) : null}
          <button className="btn btn-secondary" onClick={() => go({ name: "chat", withUserId: pop.f.id })}>
            {t("Chat")}
          </button>
          <button className="link pop-link" onClick={() => go({ name: "profile", userId: pop.f.id })}>
            {t("View profile")}
          </button>
        </div>
      ) : null}
    </>
  );
}

function Shelves({ shelves }: { shelves: Shelf[] }) {
  const { go } = useNav();
  return (
    <>
      {shelves.map((s) => {
        const isContinue = /continue/i.test(s.title);
        return (
          <section key={s.id} className="shelf">
            <SectionHeader title={s.title} onMore={isContinue ? () => go({ name: "list", kind: "continue" }) : undefined} />
            {s.layout === "grid" ? <GameGrid games={s.games.slice(0, 12)} /> : <TileRow games={s.games} />}
          </section>
        );
      })}
    </>
  );
}

/** "Discover Avatars": tall full-body avatar cards (creator ✓, price) — opens the item page. */
function DiscoverAvatars() {
  const { go } = useNav();
  const q = useQuery({ queryKey: ["discoverAvatars"], queryFn: () => discoverAvatars(), staleTime: 30 * 60_000 });
  const items = q.data?.data ?? [];
  if (!items.length) return null;
  return (
    <section className="shelf">
      <SectionHeader title={t("Discover Avatars")} onMore={() => go({ name: "avatar", tab: "marketplace" })} />
      <div className="avatar-row hscroll">
        {items.slice(0, 20).map((it) => (
          <button key={`${it.itemType}${it.id}`} className="avatar-card" onClick={() => go({ name: "item", itemType: it.itemType, id: it.id })} title={it.name}>
            <div className="avatar-card-art">
              <Thumb type={it.itemType === "Bundle" ? "BundleThumbnail" : "Asset"} id={it.id} size="420x420" />
            </div>
            <div className="avatar-card-creator">
              {it.creatorName} {it.creatorHasVerifiedBadge ? <Verified size={11} /> : null}
            </div>
            <div className="avatar-card-price">
              {(it.lowestPrice ?? it.price) ? <Robux amount={(it.lowestPrice ?? it.price) as number} size={13} /> : <span>{t("Free")}</span>}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

type HomeEvent = GameEvent & { universeId: number; gameName: string };

/** Event banners: live and upcoming events from the experiences on your home feed. */
async function homeEvents(shelves: Shelf[]): Promise<HomeEvent[]> {
  const seen = new Set<number>();
  const games = shelves.flatMap((sh) => sh.games).filter((g) => !seen.has(g.universeId) && seen.add(g.universeId)).slice(0, 24);
  const lists = await Promise.all(games.map((g) => gameEvents(g.universeId).then((ev) => ev.map((e) => ({ ...e, universeId: g.universeId, gameName: g.name }))).catch(() => [])));
  const now = Date.now();
  const soon = now + 7 * 86_400_000;
  return lists
    .flat()
    .filter((e) => Date.parse(e.start) < soon)
    .sort((a, b) => Math.max(Date.parse(a.start), now) - Math.max(Date.parse(b.start), now))
    .slice(0, 8);
}

function whenText(e: GameEvent) {
  const now = Date.now();
  const st = Date.parse(e.start);
  if (st <= now) return t("Live now");
  const h = Math.round((st - now) / 3_600_000);
  if (h < 1) return t("Starting soon");
  if (h < 24) return t("Starts in {h}h", { h });
  return fmtDate(new Date(st), { weekday: "short", month: "short", day: "numeric" });
}

function EventBanner({ e }: { e: HomeEvent }) {
  const { go } = useNav();
  const fallback = useGameThumb(e.universeId);
  const live = Date.parse(e.start) <= Date.now();
  return (
    <button className="event-banner" onClick={() => go({ name: "game", universeId: e.universeId })} title={e.title}>
      {e.imageId ? <Thumb type="Asset" id={e.imageId} size="768x432" className="hev-art" /> : fallback ? <img className="hev-art" src={fallback} alt="" draggable={false} /> : null}
      <span className="hev-shade" />
      <span className="hev-text">
        <span className={`hev-when ${live ? "live" : ""}`}>{whenText(e)}</span>
        <b className="hev-title">{e.title}</b>
        <span className="small ellipsis">{e.subtitle || e.gameName}</span>
      </span>
    </button>
  );
}

function EventBanners({ shelves }: { shelves: Shelf[] }) {
  const q = useQuery({ queryKey: ["homeEvents", shelves.map((s) => s.id).join()], queryFn: () => homeEvents(shelves), staleTime: 10 * 60_000, enabled: shelves.length > 0 });
  const ev = q.data ?? [];
  if (!ev.length) return null;
  return (
    <section className="shelf">
      <SectionHeader title={t("Events")} />
      <div className="hev-row hscroll">
        {ev.map((e) => (
          <EventBanner key={e.id} e={e} />
        ))}
      </div>
    </section>
  );
}

function ForYou() {
  const q = useHomeShelves();
  return (
    <>
      <FriendsRow />
      {q.isLoading ? (
        <SkeletonShelves />
      ) : q.error ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : (
        <>
          <EventBanners shelves={q.data ?? []} />
          <Shelves shelves={(q.data ?? []).slice(0, 2)} />
          <DiscoverAvatars />
          <Shelves shelves={(q.data ?? []).slice(2)} />
        </>
      )}
    </>
  );
}

function Charts() {
  const q = useQuery({ queryKey: ["charts"], queryFn: charts, staleTime: 10 * 60_000 });
  if (q.isLoading) return <SkeletonShelves />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  return <Shelves shelves={q.data ?? []} />;
}

function SkeletonShelves() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <section key={i} className="shelf">
          <Skel w={220} h={22} />
          <div style={{ height: 12 }} />
          <SkeletonGrid count={6} variant="tile" />
        </section>
      ))}
    </>
  );
}

export function Home({ tab = "foryou" }: { tab?: "foryou" | "charts" }) {
  const { go } = useNav();
  return (
    <div className="page">
      <div className="tabs">
        <button className={tab === "foryou" ? "active" : ""} onClick={() => go({ name: "home", tab: "foryou" })}>
          {t("For you")}
        </button>
        <button className={tab === "charts" ? "active" : ""} onClick={() => go({ name: "home", tab: "charts" })}>
          {t("Charts")}
        </button>
      </div>
      {tab === "foryou" ? <ForYou /> : <Charts />}
    </div>
  );
}
