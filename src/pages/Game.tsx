import { regionLabel, serverRegion } from "../lib/regions";
import { PrivateServerConfig } from "../components/PrivateServerConfig";
import { rbx } from "../lib/ipc";
import { BadgePopup, PassPopup } from "../components/InfoPopup";
import { gameEvents, gameExtras, gameHero, gameMaturity, rsvpEvent, type GameEvent } from "../lib/gamePage";
import { SocialIcon } from "../components/SocialIcon";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  gameDetails,
  gameMedia,
  gamePasses,
  gameSocialLinks,
  gameVotes,
  isFavorited,
  isFollowingGame,
  launcher,
  peopleAlsoJoin,
  playerTokenHeadshots,
  purchaseGamePass,
  servers,
  setFavorited,
  setFollowingGame,
  createPrivateServer,
  privateJoinToken,
  privateServers,
  privateServerSettings,
  setUserVote,
  userVote,
  isChallenge,
  playability,
  playBlock,
  type PrivateServerSettings,
  type GamePass,
  type Server,
} from "../lib/api";
import { compact, longDate, rating, thousands } from "../lib/format";
import { win } from "../lib/ipc";
import { useMe, useNav, useSession, useUi } from "../app/store";
import { ErrorState, Headshot, Icon, Robux, SectionHeader, Skel, SkeletonPage, Thumb, Verified } from "../components/ui";
import { TileRow } from "../components/games";
import { PurchaseDialog } from "../components/Purchase";
import { RUBY_UNIVERSE_ID } from "../lib/support";
import { useFriends } from "./Home";
import { t, fmtDate } from "../lib/i18n";

/** Dropdown anchored to a button; closes on outside click / Escape (the app's popover menus). */
function MenuButton({ icon, label, children }: { icon: ReactNode; label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="menu-anchor" ref={ref}>
      <button className={`square-btn ${open ? "on" : ""}`} onClick={() => setOpen((o) => !o)} aria-label={label} title={label}>
        {icon}
      </button>
      {open ? <div className="menu left">{children(() => setOpen(false))}</div> : null}
    </div>
  );
}

function MenuItem({ icon, children, onClick }: { icon: Parameters<typeof Icon>[0]["name"]; children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick}>
      <Icon name={icon} size={18} /> {children}
    </button>
  );
}

/** The game's badges; click one for its details (rarity, when you earned it…). */
function GameBadges({ universeId }: { universeId: number }) {
  const [open, setOpen] = useState<number | null>(null);
  const { data = [] } = useQuery({
    queryKey: ["gameBadges", universeId],
    queryFn: () => rbx<{ data: { id: number; name: string; displayName?: string }[] }>(`https://badges.roblox.com/v1/universes/${universeId}/badges?limit=50&sortOrder=Asc`).then((r) => r.data ?? []),
    staleTime: 10 * 60_000,
  });
  if (!data.length) return null;
  return (
    <section className="shelf">
      <SectionHeader title={t("Badges ({n})", { n: `${data.length}${data.length === 50 ? "+" : ""}` })} />
      <div className="badge-row hscroll">
        {data.map((b) => (
          <button key={b.id} className="badge-card clickable" onClick={() => setOpen(b.id)} title={b.displayName || b.name}>
            <Thumb type="BadgeIcon" id={b.id} className="square" />
            <div className="item-name two-line">{b.displayName || b.name}</div>
          </button>
        ))}
      </div>
      {open ? <BadgePopup id={open} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}

function lastPlayedLabel(ms: number) {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return t("Today");
  if (days === 1) return t("Yesterday");
  if (days < 30) return t("{n} days ago", { n: days });
  return fmtDate(ms, { month: "short", day: "numeric", year: "numeric" });
}

type Place = { id: number; name: string; description?: string };
const subplaces = (universeId: number) =>
  rbx<{ data: Place[] }>(`https://develop.roblox.com/v1/universes/${universeId}/places?sortOrder=Asc&limit=100`).then((r) => r.data ?? []);

/** Every place in the experience (lobbies, maps, side modes). Some only accept players sent by the game itself. */
function Subplaces({ universeId, rootPlaceId }: { universeId: number; rootPlaceId: number }) {
  const { play } = useUi();
  const q = useQuery({ queryKey: ["subplaces", universeId], queryFn: () => subplaces(universeId), staleTime: 30 * 60_000, retry: false });
  const others = (q.data ?? []).filter((p) => p.id !== rootPlaceId);
  if (!others.length) return null;
  return (
    <section className="shelf">
      <h3 className="sub-title">{t("Places in this experience")}</h3>
      <p className="muted small">{t("Some places only let you in when the game itself sends you there.")}</p>
      <div className="subplace-list">
        {others.map((p) => (
          <div key={p.id} className="subplace">
            <Thumb type="PlaceIcon" id={p.id} size="150x150" className="subplace-icon" />
            <span className="subplace-text">
              <b className="ellipsis">{p.name}</b>
              <span className="muted tiny">{t("Place {id}", { id: String(p.id) })}</span>
            </span>
            <button className="btn btn-secondary btn-small" onClick={() => play(p.id, p.name)}>
              {t("Join")}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function Store({ universeId, gameName }: { universeId: number; gameName?: string }) {
  const [info, setInfo] = useState<GamePass | null>(null);
  const me = useMe();
  const qc = useQueryClient();
  const { toast } = useUi();
  const { refresh } = useSession();
  const [buying, setBuying] = useState<GamePass | null>(null);
  const { data = [] } = useQuery({ queryKey: ["passes", universeId], queryFn: () => gamePasses(universeId, me.id) });
  if (!data.length) return null;
  return (
    <section className="shelf">
      <SectionHeader title={t("Store")} />
      <div className="pass-row hscroll">
        {data.map((p) => (
          <div key={p.id} className="pass-card" title={p.name}>
            <button className="pass-open" onClick={() => setInfo(p)} aria-label={t("About {name}", { name: p.name })}>
              <Thumb type="GamePass" id={p.id} className="square" />
            </button>
            <div className="item-name two-line">{p.name}</div>
            <button className="price-pill" disabled={p.owned} onClick={() => !p.owned && setBuying(p)}>
              {p.owned ? t("Owned") : <Robux amount={p.price ?? 0} size={13} />}
            </button>
          </div>
        ))}
      </div>
      {info ? (
        <PassPopup
          id={info.id}
          owned={info.owned}
          gameName={gameName}
          universeId={universeId}
          onClose={() => setInfo(null)}
          onBuy={() => {
            setBuying(info);
            setInfo(null);
          }}
        />
      ) : null}
      {buying ? (
        <PurchaseDialog
          title={buying.name}
          price={buying.price ?? 0}
          thumb={<Thumb type="GamePass" id={buying.id} className="square" />}
          onClose={() => setBuying(null)}
          roundUp={universeId !== RUBY_UNIVERSE_ID}
          onConfirm={async () => {
            await purchaseGamePass(buying);
            toast(t("You now own {name}.", { name: buying.name }));
            await refresh();
            qc.invalidateQueries({ queryKey: ["passes", universeId] });
          }}
        />
      ) : null}
    </section>
  );
}

function PeopleAlsoJoin({ universeId }: { universeId: number }) {
  const { data = [] } = useQuery({ queryKey: ["alsoJoin", universeId], queryFn: () => peopleAlsoJoin(universeId) });
  if (!data.length) return null;
  return (
    <section className="shelf">
      <SectionHeader title={t("People Also Join")} />
      <TileRow games={data} />
    </section>
  );
}

function InfoRow({ label, children, onClick }: { label: string; children: ReactNode; onClick?: () => void }) {
  const inner = (
    <>
      <span className="info-label">{label}</span>
      <span className="info-value">
        {children}
        {onClick ? <Icon name="chevron-small-right" size={16} /> : null}
      </span>
    </>
  );
  return onClick ? (
    <button className="info-row clickable" onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className="info-row">{inner}</div>
  );
}

/** Media carousel: auto-advances, arrows on hover, pill-shaped active dot, fullscreen button. */
function Media({ universeId, onFirst }: { universeId: number; onFirst: (url: string) => void }) {
  const { data = [] } = useQuery({ queryKey: ["media", universeId], queryFn: () => gameMedia(universeId) });
  const [i, setI] = useState(0);
  const [hover, setHover] = useState(false);
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (data[0]) onFirst(data[0]);
    // Warm the cache so slides swap without a blank frame.
    data.slice(1).forEach((u) => {
      const img = new Image();
      img.src = u;
    });
  }, [data[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (data.length < 2 || hover || full) return;
    const timer = setInterval(() => setI((n) => (n + 1) % data.length), 5000);
    return () => clearInterval(timer);
  }, [data.length, hover, full]);
  const cur = data[Math.min(i, data.length - 1)];
  const step = (d: number) => setI((n) => (n + d + data.length) % data.length);
  return (
    <div className="media" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="thumb wide">{cur ? <img key={cur} className="fade-in" src={cur} alt="" draggable={false} /> : null}</div>
      {cur ? (
        <button className="media-expand" onClick={() => setFull(true)} aria-label={t("Full screen")}>
          <Icon name="two-arrows-from-center" size={18} />
        </button>
      ) : null}
      {data.length > 1 ? (
        <>
          <button className="media-nav left" onClick={() => step(-1)} aria-label={t("Previous")}>
            <Icon name="chevron-small-left" size={28} />
          </button>
          <button className="media-nav right" onClick={() => step(1)} aria-label={t("Next")}>
            <Icon name="chevron-small-right" size={28} />
          </button>
          <div className="media-dots">
            {data.map((_, n) => (
              <button key={n} className={n === i ? "on" : ""} onClick={() => setI(n)} aria-label={t("Image {n}", { n: n + 1 })} />
            ))}
          </div>
        </>
      ) : null}
      {full && cur ? (
        <div className="lightbox" onClick={() => setFull(false)}>
          <img src={cur} alt="" onClick={(e) => e.stopPropagation()} />
          <button className="lightbox-close icon-btn" onClick={() => setFull(false)} aria-label={t("Close")}>
            <Icon name="x-small" size={26} />
          </button>
          {data.length > 1 ? (
            <>
              <button className="media-nav left" onClick={(e) => (e.stopPropagation(), step(-1))} aria-label={t("Previous")}>
                <Icon name="chevron-small-left" size={28} />
              </button>
              <button className="media-nav right" onClick={(e) => (e.stopPropagation(), step(1))} aria-label={t("Next")}>
                <Icon name="chevron-small-right" size={28} />
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SocialMedia({ universeId, groupId }: { universeId: number; groupId?: number }) {
  const { go } = useNav();
  const { data = [] } = useQuery({ queryKey: ["social", universeId], queryFn: () => gameSocialLinks(universeId), staleTime: 30 * 60_000 });
  if (!data.length && !groupId) return null;
  const label = (ty: string) => ({ Twitter: "X", YouTube: "YouTube", Discord: "Discord", Facebook: "Facebook", Twitch: "Twitch", Guilded: "Guilded" })[ty] ?? ty;
  return (
    <section className="shelf">
      <SectionHeader title={t("Social Media")} />
      <div className="social-row">
        {data.map((s) => (
          <button key={s.id} className="social-link" onClick={() => win.openExternal(s.url)} title={s.title || s.url}>
            <span className="social-circle"><SocialIcon type={s.type} /></span>
            <span>{label(s.type)}</span>
          </button>
        ))}
        {groupId ? (
          <button className="social-link" onClick={() => go({ name: "community", groupId })}>
            <span className="social-circle">
              <Icon name="two-people" size={22} />
            </span>
            <span>{t("Community")}</span>
          </button>
        ) : null}
      </div>
    </section>
  );
}

function FriendsHere({ universeId, placeId, name }: { universeId: number; placeId: number; name: string }) {
  const me = useMe();
  const { go } = useNav();
  const { play } = useUi();
  const { data = [] } = useFriends(me.id);
  const here = data.filter((f) => f.presence?.userPresenceType === 2 && (f.presence.universeId === universeId || f.presence.rootPlaceId === placeId));
  if (!here.length) return null;
  return (
    <section className="shelf" id="friends-here">
      <SectionHeader title={t("Friends playing ({n})", { n: here.length })} />
      <div className="friends-here">
        {here.map((f) => (
          <div key={f.id} className="friend-here">
            <button className="friend-here-id" onClick={() => go({ name: "profile", userId: f.id })}>
              <Headshot userId={f.id} size={40} presence={2} />
              <span>{f.displayName}</span>
            </button>
            {f.presence?.gameId ? (
              <button className="btn btn-secondary btn-small" onClick={() => play(f.presence!.placeId || placeId, name, f.presence!.gameId!)}>
                {t("Join")}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function Hero({ universeId }: { universeId: number }) {
  const q = useQuery({ queryKey: ["gameHero", universeId], queryFn: () => gameHero(universeId), staleTime: Infinity });
  const [playingVideo, setPlayingVideo] = useState(false);
  const [muted, setMuted] = useState(true);
  const h = q.data;
  return (
    <div className={`game-hero ${h?.poster || h?.video ? "has-art" : ""}`}>
      {h?.poster ? <div className="game-hero-poster" style={{ backgroundImage: `url("${h.poster}")` }} /> : null}
      {h?.video ? (
        <video
          className={`game-hero-video ${playingVideo ? "on" : ""}`}
          src={h.video}
          autoPlay
          loop
          muted={muted}
          playsInline
          onPlaying={() => setPlayingVideo(true)}
        />
      ) : null}
      <div className="game-hero-fade" />
      {h?.video && playingVideo ? (
        <button className="round-btn game-hero-mute" onClick={() => setMuted((m) => !m)} aria-label={muted ? t("Unmute") : t("Mute")}>
          <Icon name={muted ? "speaker-x" : "speaker"} size={18} />
        </button>
      ) : null}
    </div>
  );
}

function Events({ universeId, placeId, name }: { universeId: number; placeId: number; name: string }) {
  const { toast, play } = useUi();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["gameEvents", universeId], queryFn: () => gameEvents(universeId) });
  if (!q.data?.length) return null;
  const toggle = async (e: GameEvent) => {
    const going = e.rsvp !== "going";
    try {
      await rsvpEvent(e.id, going);
      qc.setQueryData<GameEvent[]>(["gameEvents", universeId], (old) => old?.map((x) => (x.id === e.id ? { ...x, rsvp: going ? "going" : "notGoing" } : x)));
      toast(going ? t("We'll notify you when it starts.") : t("You won't be notified."));
    } catch (err) {
      toast(t("Couldn't update: {error}", { error: (err as Error).message }), "error");
    }
  };
  return (
    <section className="shelf">
      <SectionHeader title={t("Events")} />
      <div className="event-cards hscroll">
        {q.data.map((e) => {
          const live = Date.parse(e.start) <= Date.now();
          return (
            <div key={e.id} className="event-card">
              <div className="event-art">
                {e.imageId ? <Thumb type="Asset" id={e.imageId} size="768x432" className="wide" /> : <div className="thumb wide" />}
                <span className={`event-when ${live ? "live" : ""}`}>
                  {live ? t("Live now") : fmtDate(e.start, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
              </div>
              <div className="event-text">
                <b className="ellipsis">{e.title}</b>
                {e.subtitle ? <span className="muted small ellipsis">{e.subtitle}</span> : null}
              </div>
              {live ? (
                <button className="btn btn-primary btn-small btn-block" onClick={() => play(placeId, name)}>
                  {t("Join Event")}
                </button>
              ) : (
                <button className={`btn btn-small btn-block ${e.rsvp === "going" ? "btn-secondary" : "btn-secondary"}`} onClick={() => toggle(e)}>
                  {e.rsvp === "going" ? t("✓ Notifying") : t("Notify Me")}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function Game({ universeId }: { universeId: number }) {
  const me = useMe();
  const { play, playing, toast } = useUi();
  const { go, back, canBack } = useNav();
  const qc = useQueryClient();
  const headRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  // Pre-fetch version + launch ticket so pressing Play spawns the client instantly.
  useEffect(() => {
    launcher.prewarm();
  }, [universeId]);
  const detail = useQuery({ queryKey: ["game", universeId], queryFn: async () => (await gameDetails([universeId])).get(universeId)! });
  const votes = useQuery({ queryKey: ["votes", universeId], queryFn: async () => (await gameVotes([universeId])).get(universeId) });
  const fav = useQuery({ queryKey: ["fav", universeId], queryFn: () => isFavorited(universeId) });
  const notify = useQuery({ queryKey: ["followGame", universeId], queryFn: () => isFollowingGame(me.id, universeId), retry: false });
  const myVote = useQuery({ queryKey: ["myVote", universeId], queryFn: () => userVote(universeId), retry: false });
  const maturity = useQuery({ queryKey: ["gameMaturity", universeId], queryFn: () => gameMaturity(universeId), staleTime: 60 * 60_000 });
  const extras = useQuery({ queryKey: ["gameExtras", universeId], queryFn: () => gameExtras(universeId), staleTime: 60 * 60_000 });
  const g = detail.data;
  const playTime = useQuery({
    queryKey: ["playtime", g?.rootPlaceId],
    queryFn: () => launcher.playTime([g!.rootPlaceId]),
    enabled: !!g,
  });

  // Like the app, open with the header near the top: most of the artwork sits above it and you
  // scroll up to see all of it.
  useEffect(() => {
    if (!g?.id) return;
    const raf = requestAnimationFrame(() => {
      const content = document.querySelector<HTMLElement>(".content");
      const head = headRef.current;
      if (!content || !head) return;
      const top = head.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop;
      content.scrollTop = Math.max(0, top - 96);
    });
    return () => cancelAnimationFrame(raf);
  }, [g?.id]);

  // Sticky mini header once the title block scrolls out of view (as in the app).
  useEffect(() => {
    const el = headRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [g?.id]);

  const playable = useQuery({ queryKey: ["playability", universeId], queryFn: () => playability(universeId), staleTime: 60_000 });
  if (detail.isLoading) return <SkeletonPage hero={320} />;
  if (detail.error || !g) return <ErrorState error={detail.error} retry={() => detail.refetch()} />;

  const toggleFav = async () => {
    const next = !fav.data;
    qc.setQueryData(["fav", universeId], next);
    await setFavorited(universeId, next).catch((e) => {
      qc.setQueryData(["fav", universeId], !next);
      if (isChallenge(e)) {
        win.showRobloxPage(`https://www.roblox.com/games/${g.rootPlaceId}`, g.name);
        toast(t("Roblox asked for a quick verification. Use the Favorite button on this page."));
      } else toast(e instanceof Error ? e.message : t("Couldn't update favorites."), "error");
    });
    qc.invalidateQueries({ queryKey: ["favorites"] });
  };
  const toggleNotify = async () => {
    const next = !notify.data;
    qc.setQueryData(["followGame", universeId], next);
    try {
      await setFollowingGame(me.id, universeId, next);
      toast(next ? t("You'll be notified about updates.") : t("Notifications turned off."));
    } catch {
      qc.setQueryData(["followGame", universeId], !next);
      toast(t("Couldn't update notifications."), "error");
    }
  };
  // 👍/👎: clicking your current vote again clears it, like the app.
  // Roblox's "can vote" flag goes stale (it's cached on their side), so always just try the
  // vote and only explain the refusal if Roblox actually refuses.
  const vote = async (up: boolean) => {
    const next = myVote.data?.userVote === up ? null : up;
    qc.setQueryData(["myVote", universeId], { ...(myVote.data ?? { canVote: true }), userVote: next });
    try {
      await setUserVote(universeId, next, g.rootPlaceId);
    } catch (e) {
      const msg = (e as Error).message;
      toast(/play/i.test(msg) ? t("Roblox says you need to play this experience before voting.") : t("Couldn't vote: {error}", { error: msg }), "error");
    } finally {
      await Promise.all([myVote.refetch(), votes.refetch()]);
    }
  };
  const share = async () => {
    try {
      await navigator.clipboard.writeText(`https://www.roblox.com/games/${g.rootPlaceId}`);
      toast(t("Link copied."));
    } catch {
      toast(t("Couldn't copy the link."), "error");
    }
  };
  const report = () => win.openRobloxWeb(`https://www.roblox.com/abusereport/asset?id=${g.rootPlaceId}`, t("Report"));
  const openServers = (create = false) => go({ name: "servers", universeId, placeId: g.rootPlaceId, gameName: g.name, ...(create ? { openCreate: true } : {}) });
  const close = () => (canBack ? back() : go({ name: "home" }));
  const minutes = Math.round((playTime.data?.[String(g.rootPlaceId)]?.totalMs ?? 0) / 60000);
  const lastPlayed = playTime.data?.[String(g.rootPlaceId)]?.lastPlayedAt ?? 0;
  const isPlayingThis = playing?.placeId === g.rootPlaceId;
  const openCreator = () =>
    g.creator.type === "Group" ? go({ name: "community", groupId: g.creator.id }) : go({ name: "profile", userId: g.creator.id });

  const block = playBlock(playable.data);
  const buyPage = () => win.showRobloxPage(`https://www.roblox.com/games/${g.rootPlaceId}`, g.name);
  const playBtn = (big: boolean) =>
    block?.kind === "robux" ? (
      <button className={`btn btn-play buy ${big ? "" : "small"}`} onClick={buyPage} title={block.text}>
        {t("Buy")} <Robux amount={g.price ?? 0} size={big ? 18 : 14} />
      </button>
    ) : block?.kind === "fiat" ? (
      <button className={`btn btn-play buy ${big ? "" : "small"}`} onClick={buyPage} title={block.text}>
        {t("Buy access")}
      </button>
    ) : block ? (
      <button className={`btn btn-play locked ${big ? "" : "small"}`} disabled title={block.text} aria-label={block.text}>
        <Icon name="lock" size={big ? 22 : 18} />
      </button>
    ) : (
      <button className={`btn btn-play ${big ? "" : "small"}`} onClick={() => play(g.rootPlaceId, g.name)} disabled={isPlayingThis} aria-label={t("Play")}>
        {isPlayingThis ? t("Playing") : <Icon name="play-small" size={big ? 30 : 24} />}
      </button>
    );
  const menus = (
    <>
      <MenuButton icon={<Icon name="person-play" size={22} />} label={t("Play with friends")}>
        {(done) => (
          <>
            <MenuItem icon="person-plus" onClick={() => (done(), share())}>
              {t("Invite Friends")}
            </MenuItem>
            <MenuItem icon="plus-small" onClick={() => (done(), openServers(true))}>
              {t("Create Private Server")}
            </MenuItem>
            <MenuItem icon="two-people" onClick={() => (done(), openServers())}>
              {t("Join Friends")}
            </MenuItem>
          </>
        )}
      </MenuButton>
      <MenuButton icon={<Icon name="dots-horizontal" size={22} />} label={t("More")}>
        {(done) => (
          <>
            <MenuItem icon="person-plus" onClick={() => (done(), share())}>
              {t("Invite Friends")}
            </MenuItem>
            <MenuItem icon="arrow-curl-to-right" onClick={() => (done(), share())}>
              {t("Share")}
            </MenuItem>
            <MenuItem icon="triangle-exclamation" onClick={() => (done(), report())}>
              {t("Report")}
            </MenuItem>
          </>
        )}
      </MenuButton>
    </>
  );

  return (
    <div className="page game-page">
      <Hero universeId={universeId} />

      <div className={`game-sticky ${stuck ? "on" : ""}`}>
        <button className="round-btn" onClick={close} aria-label={t("Close")}>
          <Icon name="x-small" size={22} />
        </button>
        {playBtn(false)}
        {menus}
        <div className="game-sticky-title">
          <Thumb type="GameIcon" id={universeId} className="square" />
          <span>{g.name}</span>
        </div>
      </div>

      <button className="round-btn game-close" onClick={close} aria-label={t("Close")}>
        <Icon name="x-small" size={22} />
      </button>

      <div className="game-column">
        <div className="game-head" ref={headRef}>
          <Thumb type="GameIcon" id={universeId} className="square game-icon" />
          <div className="game-head-body">
            <h1 className="game-title">{g.name}</h1>
            {maturity.data ? (
              <span className="muted small game-maturity" title={maturity.data.descriptors.join(" · ") || undefined}>
                {t("Maturity: {label}", { label: maturity.data.label })}
              </span>
            ) : null}
            {block ? (
              <div className={`play-block ${block.kind}`}>
                <Icon name={block.kind === "robux" || block.kind === "fiat" ? "robux" : "lock"} size={16} /> {block.text}
              </div>
            ) : null}
            <button className="creator link" onClick={openCreator}>
              {g.creator.name} {g.creator.hasVerifiedBadge ? <Verified size={13} /> : null}
            </button>
            <div className="game-play-row">
              {playBtn(true)}
              {menus}
            </div>
          </div>
        </div>

        <div className="chip-row game-chips">
          <span className="chip split vote-chip">
            <button className={myVote.data?.userVote === true ? "voted" : ""} onClick={() => vote(true)} aria-label={t("Like")}>
              <Icon name="thumb-up" size={16} /> {rating(votes.data?.upVotes, votes.data?.downVotes)}
            </button>
            <span className="split-sep" />
            <button className={myVote.data?.userVote === false ? "voted" : ""} onClick={() => vote(false)} aria-label={t("Dislike")}>
              <Icon name="thumb-down" size={16} />
            </button>
          </span>
          <span className="chip">
            <Icon name="two-people" size={16} /> {t("{n} active", { n: compact(g.playing) })}
          </span>
          <button className={`chip ${notify.data ? "on" : ""}`} onClick={toggleNotify}>
            <Icon name="bell" size={16} /> {notify.data ? t("Notifying") : t("Notify")}
          </button>
          <button className={`chip ${fav.data ? "on" : ""}`} onClick={toggleFav}>
            <Icon name="star" size={16} /> {fav.data ? t("Favorited") : t("Favorite")}
          </button>
          <button className="chip" onClick={share}>
            <Icon name="arrow-curl-to-right" size={16} /> {t("Share")}
          </button>
          <button className="chip" onClick={report}>
            <Icon name="triangle-exclamation" size={16} /> {t("Report")}
          </button>
        </div>

        <Media universeId={universeId} onFirst={() => undefined} />

        <Events universeId={universeId} placeId={g.rootPlaceId} name={g.name} />

        <section className="shelf">
          <h3 className="sub-title">{t("Description")}</h3>
          <p className="description">{g.description || t("No description.")}</p>
        </section>

        <FriendsHere universeId={universeId} placeId={g.rootPlaceId} name={g.name} />

        <Store universeId={universeId} gameName={g.name} />
        <GameBadges universeId={universeId} />

        <section className="shelf">
          <h3 className="sub-title">{t("Information")}</h3>
          <div className="info-table">
            <InfoRow label={t("Visits")}>{compact(g.visits)}</InfoRow>
            {maturity.data ? <InfoRow label={t("Content Maturity")}>{maturity.data.label}</InfoRow> : null}
            <InfoRow label={t("Developer")} onClick={openCreator}>
              {g.creator.name} {g.creator.hasVerifiedBadge ? <Verified size={13} /> : null}
            </InfoRow>
            <InfoRow label={t("Server Size")}>{g.maxPlayers}</InfoRow>
            <InfoRow label={t("Genre")}>{extras.data?.genre || g.genre || "--"}</InfoRow>
            {extras.data?.subgenre ? <InfoRow label={t("Subgenre")}>{extras.data.subgenre}</InfoRow> : null}
            <InfoRow label={t("Favorites")}>{thousands(g.favoritedCount)}</InfoRow>
            <InfoRow label={t("Created")}>{longDate(g.created)}</InfoRow>
            <InfoRow label={t("Updated")}>{longDate(g.updated)}</InfoRow>
            {extras.data?.voice != null ? <InfoRow label={t("Voice Chat")}>{extras.data.voice ? t("Supported") : t("Not supported")}</InfoRow> : null}
            {extras.data?.camera != null ? <InfoRow label={t("Camera")}>{extras.data.camera ? t("Supported") : t("Not supported")}</InfoRow> : null}
            {minutes > 0 ? (
              <InfoRow label={t("Your play time")}>{minutes >= 60 ? t("{h}h {m}m", { h: Math.floor(minutes / 60), m: minutes % 60 }) : t("{m}m", { m: minutes })}</InfoRow>
            ) : null}
            {lastPlayed ? <InfoRow label={t("Last played")}>{lastPlayedLabel(lastPlayed)}</InfoRow> : null}
            <InfoRow label={t("Servers")} onClick={() => openServers()}>
              {t("View")}
            </InfoRow>
          </div>
        </section>

        <Subplaces universeId={universeId} rootPlaceId={g.rootPlaceId} />

        <SocialMedia universeId={universeId} groupId={g.creator.type === "Group" ? g.creator.id : undefined} />

        <PeopleAlsoJoin universeId={universeId} />
      </div>
    </div>
  );
}

function ServerCard({ s, onJoin, placeId }: { s: Server; onJoin: () => void; placeId: number }) {
  const tokens = s.playerTokens ?? [];
  const region = useQuery({ queryKey: ["serverRegion", s.id], queryFn: () => serverRegion(placeId, s.id), staleTime: Infinity, retry: false });
  const { data: faces } = useQuery({
    queryKey: ["serverFaces", s.id],
    queryFn: () => playerTokenHeadshots(tokens.slice(0, 5)),
    enabled: tokens.length > 0,
    staleTime: 5 * 60_000,
  });
  const extra = Math.max(0, s.playing - 5);
  return (
    <div className="server-card">
      <div className="server-faces">
        {tokens.slice(0, 5).map((tok) => (
          <span key={tok} className="face">
            {faces?.get(tok) ? <img src={faces.get(tok)} alt="" /> : null}
          </span>
        ))}
        {extra > 0 ? <span className="face more">+{extra}</span> : null}
      </div>
      <div className="server-count">
        {t("{playing} of {max} people max", { playing: s.playing, max: s.maxPlayers })}{s.ping != null ? ` · ${t("{ms} ms", { ms: s.ping })}` : ""}
      </div>
      <div className="server-bar">
        <div style={{ width: `${Math.min(100, (s.playing / s.maxPlayers) * 100)}%` }} />
      </div>
      <button className="btn btn-secondary btn-small" disabled={s.playing >= s.maxPlayers} onClick={onJoin}>
        {t("Join")}
      </button>
      <div className="server-region" title={region.error ? (region.error as Error).message : t("Where this server is")}>
        <Icon name="compass" size={13} />
        {region.isLoading ? <span className="muted">{t("Finding region…")}</span> : region.data ? regionLabel(region.data) : <span className="muted">{t("Region unknown")}</span>}
      </div>
      <div className="server-id pii">{t("ID: {id}", { id: `${s.id.slice(0, 4)}-${s.id.slice(-4)}` })}</div>
    </div>
  );
}

/** "Create a private server": price (with any discount), name field, and a confirm step that runs the real purchase. */
function CreatePrivateServerDialog({
  universeId,
  gameName,
  settings,
  onClose,
  onCreated,
}: {
  universeId: number;
  gameName: string;
  settings: PrivateServerSettings;
  onClose: () => void;
  onCreated: () => void;
}) {
  const me = useMe();
  const { toast } = useUi();
  const { refresh } = useSession();
  const [name, setName] = useState(t("{name}'s server", { name: me.displayName }));
  const [busy, setBusy] = useState(false);
  const balance = me.robux ?? 0;
  const short = balance < settings.price;
  const discount = settings.discounts.reduce((n, d) => n + (d.robux || 0), 0);
  // Roblox Plus makes private servers free: the discount covers the whole price.
  const freeWithPlus = settings.price === 0 && discount > 0;
  const buy = async () => {
    setBusy(true);
    try {
      await createPrivateServer(universeId, name.trim() || t("{name}'s server", { name: me.displayName }), settings.price);
      toast(t("Private server created."));
      await refresh();
      onCreated();
      onClose();
    } catch (e) {
      toast(t("Couldn't create the server: {error}", { error: (e as Error).message }), "error");
      setBusy(false);
    }
  };
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="buy-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="buy-head">
          <h2>{t("Create Private Server")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("Close")}>
            <Icon name="x-small" size={20} />
          </button>
        </div>
        <div className="muted small">{gameName}</div>
        <label className="muted small">{t("Server name")}</label>
        <input className="text-input" value={name} maxLength={50} onChange={(e) => setName(e.target.value)} />
        {freeWithPlus ? (
          <div className="ps-plus">
            <Icon name="roblox-plus" size={22} />
            <div>
              <b>{t("Free with Roblox Plus")}</b>
              <span className="muted small">
                {t("Usually")} <Robux amount={discount} size={12} />{t("/month")}. {t("Your Plus membership covers it.")}
              </span>
            </div>
          </div>
        ) : null}
        <div className="ps-price" hidden={freeWithPlus}>
          <span>{t("Price")}</span>
          <span>
            {discount > 0 ? (
              <s className="muted">
                <Robux amount={settings.price + discount} size={13} />
              </s>
            ) : null}{" "}
            <Robux amount={settings.price} size={15} />
            <span className="muted"> {t("/ month")}</span>
          </span>
        </div>
        <div className="muted small">
          {freeWithPlus
            ? t("No Robux will be charged while you have Plus. It stays active as long as your membership does.")
            : <>{t("This is a monthly Robux subscription that renews until you cancel it.")} {t("Your balance:")} <Robux amount={balance} size={12} /></>}
        </div>
        <div className="buy-actions">
          {short ? (
            <button className="btn btn-primary btn-block" onClick={() => (onClose(), win.showRobloxPage("https://www.roblox.com/upgrades/robux", t("Buy Robux")))}>
              {t("Buy Robux")}
            </button>
          ) : (
            <button className="btn btn-primary btn-block" onClick={buy} disabled={busy}>
              {busy ? t("Creating...") : freeWithPlus ? t("Create for Free") : t("Buy Now")}
            </button>
          )}
          <button className="btn btn-secondary btn-block" onClick={onClose} disabled={busy}>
            {t("Cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

function PrivateServers({ universeId, placeId, gameName, openCreate }: { universeId: number; placeId: number; gameName: string; openCreate?: boolean }) {
  const { play } = useUi();
  const [creating, setCreating] = useState(!!openCreate);
  const [editing, setEditing] = useState<number | null>(null);
  const settings = useQuery({ queryKey: ["psSettings", universeId], queryFn: () => privateServerSettings(universeId), staleTime: 10 * 60_000 });
  const list = useInfiniteQuery({
    queryKey: ["privateServers", placeId],
    queryFn: ({ pageParam }) => privateServers(placeId, pageParam),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextPageCursor || undefined,
  });
  const meId = useMe().id;
  // Your own servers first, then friends' ones you can join, then the rest.
  const rows = [...(list.data?.pages.flatMap((p) => p.data) ?? [])].sort((a, b) => {
    const rank = (p: (typeof a)) => (p.owner?.id === meId ? 0 : p.accessCode ? 1 : 2);
    return rank(a) - rank(b);
  });
  const s = settings.data;
  if (!s?.isAvailable && !rows.length) return null;
  const discount = s ? s.discounts.reduce((n, d) => n + (d.robux || 0), 0) : 0;
  return (
    <section className="shelf">
      <h3 className="sub-title">{t("Private servers")}</h3>
      <p className="muted small" style={{ marginTop: -6 }}>
        {t("Yours, plus friends' private servers you've been given access to")}
      </p>
      <div className="ps-list">
        {s?.isAvailable ? (
          <div className="ps-row">
            <span className="ps-avatar">
              <Icon name="person-plus" size={18} />
            </span>
            <div className="ps-text">
              <b>{t("Create a private server")}</b>
              <span className="muted small">
                {discount > 0 ? (
                  <s>
                    <Robux amount={s.price + discount} size={11} />
                    {t("/month")}
                  </s>
                ) : null}{" "}
                {s.price === 0 && discount > 0 ? (
                  <span className="ps-plus-tag">
                    <Icon name="roblox-plus" size={13} /> {t("Free with Plus")}
                  </span>
                ) : (
                  <>
                    <Robux amount={s.price} size={11} />
                    {t("/month")}
                  </>
                )}
              </span>
            </div>
            <button className="btn btn-secondary btn-small" onClick={() => setCreating(true)}>
              {t("Create")}
            </button>
          </div>
        ) : null}
        {list.isLoading ? <Skel h={48} r={10} /> : null}
        {rows.map((p) => (
          <div key={p.vipServerId} className="ps-row">
            {p.owner ? <Headshot userId={p.owner.id} size={36} /> : <span className="ps-avatar" />}
            <div className="ps-text">
              <b>{p.name || t("Private server")}</b>
              <span className="muted small">
                {t("{playing} of {max} people", { playing: p.playing ?? 0, max: p.maxPlayers })} · {p.owner?.id === meId ? t("Yours") : p.owner ? t("{name}'s server", { name: p.owner.displayName }) : t("Shared with you")}
              </span>
            </div>
            {p.owner?.id === meId ? (
              <button className="icon-btn ps-edit" onClick={() => setEditing(p.vipServerId)} aria-label={t("Edit private server")} title={t("Edit")}>
                <Icon name="pencil-square" size={18} />
              </button>
            ) : null}
            <button
              className="btn btn-primary btn-small"
              disabled={!p.accessCode}
              title={p.accessCode ? undefined : t("This server's owner hasn't given you access")}
              onClick={() => play(placeId, gameName, privateJoinToken(p.accessCode))}
            >
              {t("Join")}
            </button>
          </div>
        ))}
        {list.hasNextPage ? (
          <button className="btn btn-secondary btn-small" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
            {t("Load More")}
          </button>
        ) : null}
      </div>
      {editing ? <PrivateServerConfig id={editing} universeId={universeId} onClose={() => setEditing(null)} /> : null}
      {creating && s ? (
        <CreatePrivateServerDialog universeId={universeId} gameName={gameName} settings={s} onClose={() => setCreating(false)} onCreated={() => list.refetch()} />
      ) : null}
    </section>
  );
}

export function ServersPage({
  universeId,
  placeId,
  gameName,
  openCreate,
}: {
  universeId: number;
  placeId: number;
  gameName: string;
  openCreate?: boolean;
}) {
  const me = useMe();
  const { back } = useNav();
  const { play } = useUi();
  const [excludeFull, setExcludeFull] = useState(true);
  const [sort, setSort] = useState<"most" | "fewest" | "ping">("most");
  const friends = useFriends(me.id);
  const q = useInfiniteQuery({
    queryKey: ["servers", placeId, excludeFull, sort === "fewest" ? 1 : 2],
    queryFn: ({ pageParam }) => servers(placeId, pageParam, excludeFull, sort === "fewest" ? 1 : 2),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextPageCursor || undefined,
  });
  const loaded = q.data?.pages.flatMap((p) => p.data) ?? [];
  // Roblox only sorts by player count; ping is sorted here across the pages loaded so far.
  const rows = sort === "ping" ? [...loaded].sort((a, b) => (a.ping ?? 9999) - (b.ping ?? 9999)) : loaded;
  const friendServers = (friends.data ?? []).filter(
    (f) => f.presence?.userPresenceType === 2 && f.presence.gameId && (f.presence.rootPlaceId === placeId || f.presence.universeId === universeId),
  );
  return (
    <div className="sheet">
      <div className="sheet-head">
        <button className="icon-btn" onClick={back} aria-label={t("Close")}>
          <Icon name="x-small" size={24} />
        </button>
        <div className="sheet-title">
          <span className="muted small">{gameName}</span>
          <b>{t("Servers")}</b>
        </div>
      </div>
      <div className="sheet-body">
        <PrivateServers universeId={universeId} placeId={placeId} gameName={gameName} openCreate={openCreate} />

        <section className="shelf">
          <div className="row-between">
            <h3 className="sub-title">{t("Servers My Friends Are In")}</h3>
            <button className="link refresh" onClick={() => friends.refetch()}>
              {t("Refresh")} <Icon name="arrow-spin-clockwise" size={16} />
            </button>
          </div>
          {friendServers.length ? (
            <div className="friends-here">
              {friendServers.map((f) => (
                <div key={f.id} className="friend-here">
                  <span className="friend-here-id">
                    <Headshot userId={f.id} size={40} presence={2} />
                    <span>{f.displayName}</span>
                  </span>
                  <button className="btn btn-secondary btn-small" onClick={() => play(f.presence!.placeId || placeId, gameName, f.presence!.gameId!)}>
                    {t("Join")}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted center-text">{t("No Servers Found.")}</p>
          )}
        </section>

        <section className="shelf">
          <div className="row-between">
            <h3 className="sub-title">{t("Other Servers")}</h3>
            <button className="link refresh" onClick={() => q.refetch()}>
              {t("Refresh")} <Icon name="arrow-spin-clockwise" size={16} />
            </button>
          </div>
          <div className="server-tools">
            <div className="segmented small" role="group" aria-label={t("Sort servers")}>
              {(
                [
                  ["most", t("Most players")],
                  ["fewest", t("Fewest players")],
                  ["ping", t("Lowest ping")],
                ] as const
              ).map(([k, l]) => (
                <button key={k} className={sort === k ? "active" : ""} onClick={() => setSort(k)}>
                  {l}
                </button>
              ))}
            </div>
            <label className="check-row">
              <input type="checkbox" checked={excludeFull} onChange={(e) => setExcludeFull(e.target.checked)} /> {t("Exclude Full Servers")}
            </label>
          </div>
          {sort === "ping" && q.hasNextPage ? <p className="muted small">{t("Sorted by ping across the servers loaded so far. Load more to compare more.")}</p> : null}
          {q.isLoading ? (
            <div className="server-grid">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <Skel key={i} h={190} r={12} />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="muted center-text">{t("No Servers Found.")}</p>
          ) : (
            <>
              <div className="server-grid">
                {rows.map((s) => (
                  <ServerCard key={s.id} s={s} placeId={placeId} onJoin={() => play(placeId, gameName, s.id)} />
                ))}
              </div>
              {q.hasNextPage ? (
                <button className="btn btn-secondary btn-block load-more" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                  {q.isFetchingNextPage ? t("Loading...") : t("Load More")}
                </button>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
