import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMe, useNav, useUi } from "../app/store";
import { friends, gamePreviewVideo, isChallenge, isFavorited, setFavorited, type Friend, type GameSummary } from "../lib/api";
import { compact, rating } from "../lib/format";
import { useGameThumb } from "../lib/thumbs";
import { call, rbx, win } from "../lib/ipc";
import { Headshot, Icon, Thumb } from "./ui";
import { t } from "../lib/i18n";

/** Games you marked "Not interested" (kept between launches). */
const DISMISS_KEY = "ruby.notInterested";
const dismissed = new Set<number>(
  (() => {
    try {
      return JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]") as number[];
    } catch {
      return [];
    }
  })(),
);
const saveDismissed = () => {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissed].slice(-500)));
  } catch {
    /* storage off: still hidden this session */
  }
};

/** The right-click menu on a game: favourite, desktop shortcut, not interested, report. */
function GameMenu({ game, x, y, onClose, onHide }: { game: GameSummary; x: number; y: number; onClose: () => void; onHide: () => void }) {
  const { toast } = useUi();
  const qc = useQueryClient();
  const ref = useRef<HTMLDivElement>(null);
  const fav = useQuery({ queryKey: ["isFavorited", game.universeId], queryFn: () => isFavorited(game.universeId) });
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    // Keep the menu on screen.
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close);
    window.addEventListener("blur", onClose);
    window.addEventListener("wheel", onClose, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("wheel", onClose);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (f: () => Promise<void> | void) => () => {
    onClose();
    void Promise.resolve(f()).catch((e) => toast(String((e as Error)?.message ?? e), "error"));
  };
  const toggleFav = run(async () => {
    const next = !fav.data;
    try {
      await setFavorited(game.universeId, next);
    } catch (e) {
      if (!isChallenge(e)) throw e;
      // Roblox wants its verification step: finish it on the real page, inside Ruby.
      win.showRobloxPage(`https://www.roblox.com/games/${game.placeId}`, game.name);
      toast(t("Roblox asked for a quick verification. Use the Favorite button on this page."));
      return;
    }
    qc.setQueryData(["isFavorited", game.universeId], next);
    qc.invalidateQueries({ queryKey: ["favorites"] });
    qc.invalidateQueries({ queryKey: ["favGames"] });
    toast(next ? t("Added to Favorites") : t("Removed from Favorites"));
  });
  const shortcut = run(async () => {
    if (!game.placeId) throw new Error(t("This experience can't be launched."));
    const icon = await rbx<{ data: { imageUrl?: string }[] }>(
      `https://thumbnails.roblox.com/v1/games/icons?universeIds=${game.universeId}&size=256x256&format=Png&isCircular=false`,
    ).catch(() => ({ data: [] }));
    await call("createGameShortcut", game.placeId, game.name, icon.data[0]?.imageUrl ?? "");
    toast(t("Shortcut added to your desktop"));
  });
  const notInterested = run(() => {
    dismissed.add(game.universeId);
    saveDismissed();
    onHide();
    toast(t("Got it. You won't see this experience here again."));
  });
  const report = run(() => void win.showRobloxPage(`https://www.roblox.com/abusereport/asset?id=${game.placeId}`, t("Report")));

  return createPortal(
    <div ref={ref} className="ctx-menu" style={{ left: pos.x, top: pos.y }} role="menu" onContextMenu={(e) => (e.preventDefault(), e.stopPropagation())}>
      <div className="ctx-title ellipsis">{game.name}</div>
      <button role="menuitem" onClick={toggleFav} disabled={fav.isLoading}>
        <Icon name="star" size={16} /> {fav.data ? t("Remove from Favorites") : t("Add to Favorites")}
      </button>
      <button role="menuitem" onClick={shortcut} disabled={!game.placeId}>
        <Icon name="play-small" size={16} /> {t("Add shortcut to desktop")}
      </button>
      <div className="ctx-sep" />
      <button role="menuitem" onClick={notInterested}>
        <Icon name="x-small" size={16} /> {t("Not interested")}
      </button>
      <button role="menuitem" className="danger" onClick={report} disabled={!game.placeId}>
        <Icon name="triangle-exclamation" size={16} /> {t("Report experience")}
      </button>
    </div>,
    document.body,
  );
}

/**
 * The app's hover card: after a short hover the card lifts onto a lighter panel that grows
 * over the row below, with a full-width blue Play button. Right-click opens the game menu.
 */
function HoverCard({
  game,
  className,
  children,
  bind,
}: {
  game: GameSummary;
  className: string;
  children: ReactNode;
  bind?: { onMouseEnter: () => void; onMouseLeave: () => void };
}) {
  const { go } = useNav();
  const { play } = useUi();
  const [hidden, setHidden] = useState(() => dismissed.has(game.universeId));
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  if (hidden) return null;
  return (
    <div
      className={`hover-card ${className}`}
      {...bind}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <button className="hc-main" onClick={() => go({ name: "game", universeId: game.universeId })} aria-label={game.name}>
        {children}
      </button>
      {game.placeId ? (
        <button className="hc-play" aria-label={t("Play {name}", { name: game.name })} onClick={() => play(game.placeId, game.name)}>
          <Icon name="play-small" size={26} />
        </button>
      ) : null}
      {menu ? <GameMenu game={game} x={menu.x} y={menu.y} onClose={() => setMenu(null)} onHide={() => setHidden(true)} /> : null}
    </div>
  );
}

/** True once the pointer has rested on the element for the hover-card delay. */
function useHoverIntent(delay = 450) {
  const [on, setOn] = useState(false);
  const tm = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(tm.current), []);
  return {
    on,
    bind: {
      onMouseEnter: () => {
        clearTimeout(tm.current);
        tm.current = setTimeout(() => setOn(true), delay);
      },
      onMouseLeave: () => {
        clearTimeout(tm.current);
        setOn(false);
      },
    },
  };
}

/** The hover preview the app plays: the game's own preview video, muted and looping. */
function HoverVideo({ universeId }: { universeId: number }) {
  const { data } = useQuery({ queryKey: ["previewVideo", universeId], queryFn: () => gamePreviewVideo(universeId), staleTime: 30 * 60_000 });
  const [ready, setReady] = useState(false);
  if (!data) return null;
  return <video className={`hover-video ${ready ? "ready" : ""}`} src={data} muted autoPlay loop playsInline onPlaying={() => setReady(true)} />;
}

/** Friends currently in this experience (same shared, cached list as the Home friends row). */
function useFriendsIn(universeId: number, placeId: number): Friend[] {
  const me = useMe();
  const q = useQuery({ queryKey: ["friends", me.id], queryFn: () => friends(me.id), refetchInterval: 45_000, enabled: !!me.id });
  return (q.data ?? []).filter(
    (f) => f.presence?.userPresenceType === 2 && (f.presence.universeId === universeId || (!!placeId && (f.presence.rootPlaceId === placeId || f.presence.placeId === placeId))),
  );
}

/** Like the app: stacked friend headshots and "Name" / "Name +5". */
function FriendsPlaying({ list }: { list: Friend[] }) {
  const first = list[0];
  const more = list.length - 1;
  return (
    <div className="friends-playing" title={list.map((f) => f.displayName).join(", ")}>
      <span className="fp-stack">
        {list.slice(0, 3).map((f) => (
          <Headshot key={f.id} userId={f.id} size={20} />
        ))}
      </span>
      <span className="fp-name ellipsis">{first.displayName || first.name}</span>
      {more > 0 ? <span className="fp-more">+{more}</span> : null}
    </div>
  );
}

export function GameCard({ game }: { game: GameSummary }) {
  const thumb = useGameThumb(game.universeId);
  const hover = useHoverIntent();
  const here = useFriendsIn(game.universeId, game.placeId);
  return (
    <HoverCard game={game} className="game-card" bind={hover.bind}>
      <div className="thumb wide">
        {thumb ? <img src={thumb} alt="" draggable={false} loading="lazy" /> : null}
        {hover.on ? <HoverVideo universeId={game.universeId} /> : null}
      </div>
      <div className="game-name">{game.name}</div>
      {here.length ? (
        <FriendsPlaying list={here} />
      ) : (
        <div className="game-meta">
          <Icon name="thumb-up" size={14} />
          <span>{t("{rating} Rating", { rating: rating(game.upVotes, game.downVotes) })}</span>
        </div>
      )}
    </HoverCard>
  );
}

/** Square icon tile used in rows ("Continue", charts, lists). */
export function GameTile({ game }: { game: GameSummary }) {
  const here = useFriendsIn(game.universeId, game.placeId);
  return (
    <HoverCard game={game} className="game-tile">
      <div className="thumb-wrap">
        <Thumb type="GameIcon" id={game.universeId} className="square" />
      </div>
      <div className="tile-body">
        <div className="game-name two-line">{game.name}</div>
        {here.length ? <FriendsPlaying list={here} /> : null}
        <div className="game-meta" style={here.length ? { display: "none" } : undefined}>
          <Icon name="thumb-up" size={14} />
          <span>{rating(game.upVotes, game.downVotes)}</span>
          {game.playing != null ? (
            <>
              <Icon name="person" size={14} />
              <span>{compact(game.playing)}</span>
            </>
          ) : null}
        </div>
      </div>
    </HoverCard>
  );
}

export function GameGrid({ games }: { games: GameSummary[] }) {
  return (
    <div className="game-grid">
      {games.map((g) => (
        <GameCard key={g.universeId} game={g} />
      ))}
    </div>
  );
}

export function TileRow({ games }: { games: GameSummary[] }) {
  return (
    <div className="tile-row hscroll">
      {games.map((g) => (
        <GameTile key={g.universeId} game={g} />
      ))}
    </div>
  );
}

export function TileGrid({ games }: { games: GameSummary[] }) {
  return (
    <div className="tile-grid">
      {games.map((g) => (
        <GameTile key={g.universeId} game={g} />
      ))}
    </div>
  );
}
