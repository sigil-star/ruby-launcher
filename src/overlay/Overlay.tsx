import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { call, on, rbx } from "../lib/ipc";
import { friends, presences, type Friend } from "../lib/api";
import { Headshot, Icon, Skel, type IconName } from "../components/ui";
import { t } from "../lib/i18n";

type Session = { placeId: string | null; jobId: string | null; running: boolean; startedAt: number };
type Where = { placeId: number; universeId: number | null; jobId: string | null };
type GameInfo = { name: string; icon: string | null; maxPlayers: number };
type Server = { id: string; playing: number; maxPlayers: number; ping?: number; fps?: number };
type ServerInfo = { ok: boolean; ip?: string; pingMs?: number | null; location?: { city?: string; region?: string; country?: string } | null };
type View = "home" | "servers" | "friends";

async function gameInfo(placeId: number, universeId: number | null): Promise<GameInfo> {
  const uni = universeId ?? (await rbx<{ universeId: number }>(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`)).universeId;
  const [g, icon] = await Promise.all([
    rbx<{ data: { name: string; maxPlayers: number }[] }>(`https://games.roblox.com/v1/games?universeIds=${uni}`),
    rbx<{ data: { imageUrl: string | null }[] }>(`https://thumbnails.roblox.com/v1/places/gameicons?placeIds=${placeId}&returnPolicy=PlaceHolder&size=150x150&format=Webp&isCircular=false`).catch(() => ({ data: [] })),
  ]);
  return { name: g.data?.[0]?.name ?? "Experience", maxPlayers: g.data?.[0]?.maxPlayers ?? 0, icon: icon.data?.[0]?.imageUrl ?? null };
}

/** Public servers (up to 2 pages). Each carries Roblox's measured ping, FPS and player count. */
async function publicServers(placeId: number): Promise<Server[]> {
  const out: Server[] = [];
  let cursor = "";
  for (let i = 0; i < 2; i++) {
    const r = await rbx<{ data: Server[]; nextPageCursor: string | null }>(
      `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    out.push(...(r.data ?? []));
    if (!r.nextPageCursor) break;
    cursor = r.nextPageCursor;
  }
  return out;
}

const elapsed = (from: number, now: number) => {
  const s = Math.max(0, Math.floor((now - from) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};
const flag = (cc?: string) => (cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "");

function Action({ icon, label, onClick, disabled, danger, busy }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean; danger?: boolean; busy?: boolean }) {
  return (
    <button className={`ov-action ${danger ? "danger" : ""}`} onClick={onClick} disabled={disabled || busy} title={label}>
      <span className="ov-action-icon">{busy ? <span className="ov-spin" /> : <Icon name={icon} size={20} />}</span>
      <span className="ov-action-label">{label}</span>
    </button>
  );
}

function Stat({ label, value, cls }: { label: string; value: React.ReactNode; cls?: string }) {
  return (
    <div className="ov-stat">
      <span className="ov-stat-label">{label}</span>
      <b className={`ov-stat-value ${cls ?? ""}`}>{value}</b>
    </div>
  );
}

function OverlayPanel() {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [hotkey, setHotkey] = useState("F6");
  const [now, setNow] = useState(Date.now());
  const [shownAt, setShownAt] = useState(0);
  const [view, setView] = useState<View>("home");
  const [info, setInfo] = useState<ServerInfo | null>(null);

  const me = useQuery({ queryKey: ["ovMe"], queryFn: () => rbx<{ id: number }>("https://users.roblox.com/v1/users/authenticated"), staleTime: Infinity });
  // Where we are, straight from Roblox: works whichever launcher started the game.
  const self = useQuery({
    queryKey: ["ovWhere", me.data?.id, shownAt],
    queryFn: async (): Promise<Where | null> => {
      const p = (await presences([me.data!.id])).get(me.data!.id);
      if (!p || p.userPresenceType !== 2 || !p.placeId) return null;
      return { placeId: p.placeId, universeId: p.universeId, jobId: p.gameId };
    },
    enabled: !!me.data?.id,
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const load = () => {
      setShownAt(Date.now());
      call<Session>("getGameSession").then(setSession).catch(() => undefined);
      call<ServerInfo>("getServerInfo").then(setInfo).catch(() => undefined);
    };
    load();
    call<{ hotkey: string }>("overlayInfo").then((i) => setHotkey(i.hotkey)).catch(() => undefined);
    const subs = [on("overlay-shown", load), on("roblox-session-state", load)];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") call("overlayHide");
    };
    window.addEventListener("keydown", onKey);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearInterval(timer);
      subs.forEach((s) => s.then((u) => u()));
    };
  }, []);

  const where: Where | null = useMemo(() => {
    if (self.data) return self.data;
    if (session?.running && session.placeId) return { placeId: Number(session.placeId), universeId: null, jobId: session.jobId };
    return null;
  }, [self.data, session]);
  const placeId = where?.placeId ?? 0;
  const jobId = where?.jobId ?? null;

  const game = useQuery({ queryKey: ["ovGame", placeId], queryFn: () => gameInfo(placeId, where?.universeId ?? null), enabled: !!placeId, staleTime: 10 * 60_000 });
  const servers = useQuery({ queryKey: ["ovServers", placeId, shownAt], queryFn: () => publicServers(placeId), enabled: !!placeId, staleTime: 20_000 });
  const fr = useQuery({ queryKey: ["ovFriends", me.data?.id, shownAt], queryFn: () => friends(me.data!.id), enabled: !!me.data?.id && !!placeId, staleTime: 20_000 });
  const here = useMemo(
    () => (fr.data ?? []).filter((f: Friend) => f.presence?.userPresenceType === 2 && (f.presence.placeId === placeId || (!!where?.universeId && f.presence.universeId === where.universeId))),
    [fr.data, placeId, where],
  );
  const mine = servers.data?.find((s) => s.id === jobId);
  // Lowest ping first; full servers and the one you're on are left out.
  const hops = useMemo(
    () => (servers.data ?? []).filter((s) => s.id !== jobId && s.playing < s.maxPlayers).sort((a, b) => (a.ping ?? 9999) - (b.ping ?? 9999) || b.playing - a.playing),
    [servers.data, jobId],
  );

  const flash = (m: string) => {
    setNote(m);
    window.setTimeout(() => setNote(null), 1800);
  };
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      flash(String((e as Error)?.message ?? e) || t("Something went wrong"));
    } finally {
      setBusy(null);
    }
  };
  const copy = (text: string, label: string) =>
    call("overlayCopy", text).then(
      () => flash(t("{label} copied", { label })),
      () => flash(t("Couldn't copy")),
    );
  const join = (id: string, key: string) => run(key, () => call("overlayRejoin", placeId, id));
  const bestHop = () => {
    const best = hops[0];
    if (!best) return flash(servers.isLoading ? t("Still loading servers…") : t("No other servers have room"));
    void join(best.id, "best");
  };

  const startedAt = session?.running && session.startedAt ? session.startedAt : 0;
  const g = game.data;
  const invite = placeId && jobId ? `https://www.roblox.com/games/start?placeId=${placeId}&gameInstanceId=${jobId}` : "";
  const loc = info?.ok ? info.location : null;
  const region = loc ? [loc.city, loc.region !== loc.city ? loc.region : null].filter(Boolean).join(", ") : "";
  const ping = mine?.ping ?? (info?.ok ? info.pingMs : null) ?? null;

  if (!self.isLoading && !where) {
    return (
      <div className="ov-panel ov-empty-state">
        <Icon name="circle-i" size={28} />
        <b>{t("Not in an experience")}</b>
        <span className="ov-muted">{t("Join a game, then press {hotkey} to open this menu.", { hotkey })}</span>
        <button className="btn btn-secondary btn-small" onClick={() => call("overlayHide")}>
          {t("Close")}
        </button>
      </div>
    );
  }

  return (
    <div className="ov-panel" onPointerUp={() => window.setTimeout(() => call("overlayRefocus").catch(() => undefined), 0)}>
      <header className="ov-head">
        <div className="ov-icon">{g?.icon ? <img src={g.icon} alt="" /> : <Skel w={48} h={48} r={10} />}</div>
        <div className="ov-title">
          {g ? <b className="ellipsis">{g.name}</b> : <Skel w="70%" h={14} />}
          <span className="ov-muted">
            {startedAt ? t("Playing for {time}", { time: elapsed(startedAt, now) }) : t("Playing")}
          </span>
        </div>
        <button className="ov-x" onClick={() => call("overlayHide")} aria-label={t("Close")} title={t("Close ({hotkey})", { hotkey })}>
          <Icon name="x-small" size={18} />
        </button>
      </header>

      <div className="ov-stats">
        <Stat label={t("Region")} value={region ? `${flag(loc?.country)} ${loc?.city ?? region}` : "—"} />
        <Stat label={t("Ping")} value={ping != null ? t("{n} ms", { n: ping }) : "—"}  />
        <Stat label={t("Players")} value={mine ? `${mine.playing}/${mine.maxPlayers}` : g?.maxPlayers ? `—/${g.maxPlayers}` : "—"} />
      </div>

      <div className="ov-tabs" role="tablist">
        {(
          [
            ["home", t("Actions")],
            ["servers", `${t("Servers")}${hops.length ? ` · ${hops.length}` : ""}`],
            ["friends", `${t("Friends")}${here.length ? ` · ${here.length}` : ""}`],
          ] as [View, string][]
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={view === k} className={view === k ? "on" : ""} onClick={() => setView(k)}>
            {l}
          </button>
        ))}
      </div>

      <div className="ov-body" key={view}>
        {view === "home" ? (
          <div className="ov-actions">
            <Action icon="arrow-spin-clockwise" label={t("Rejoin")} busy={busy === "rejoin"} disabled={!!busy || !placeId} onClick={() => run("rejoin", () => call("overlayRejoin", placeId, jobId ?? ""))} />
            <Action icon="two-arrows-left-right" label={t("Best ping server")} busy={busy === "best"} disabled={!!busy || !placeId} onClick={bestHop} />
            <Action icon="chain-link" label={t("Copy invite")} disabled={!invite} onClick={() => copy(invite, t("Invite link"))} />
            <Action icon="house" label={t("Open Ruby")} onClick={() => call("showMain")} />
          </div>
        ) : view === "servers" ? (
          <div className="ov-list-scroll">
            {servers.isLoading ? (
              <>
                <Skel h={44} r={10} />
                <Skel h={44} r={10} />
                <Skel h={44} r={10} />
              </>
            ) : hops.length ? (
              hops.slice(0, 40).map((s) => (
                <div key={s.id} className="ov-server">
                  <span className="ov-server-main">
                    <b>{s.ping != null ? t("{n} ms", { n: s.ping }) : "—"}</b>
                    <span className="ov-muted">
                      {t("{playing}/{max} players", { playing: s.playing, max: s.maxPlayers })}{s.fps ? ` · ${t("{n} fps", { n: Math.round(s.fps) })}` : ""}
                    </span>
                  </span>
                  <button className="ov-join" disabled={!!busy} onClick={() => join(s.id, `s${s.id}`)}>
                    {busy === `s${s.id}` ? <span className="ov-spin" /> : t("Join")}
                  </button>
                </div>
              ))
            ) : (
              <p className="ov-muted ov-none">{t("No other servers have room right now.")}</p>
            )}
          </div>
        ) : (
          <div className="ov-list-scroll">
            {fr.isLoading ? (
              <Skel h={44} r={10} />
            ) : here.length ? (
              here.map((f) => {
                const same = !!jobId && f.presence?.gameId === jobId;
                const canJoin = !same && !!f.presence?.gameId && f.presence.placeId === placeId;
                return (
                  <div key={f.id} className="ov-server">
                    <Headshot userId={f.id} size={32} presence={2} />
                    <span className="ov-server-main">
                      <b className="ellipsis">{f.displayName}</b>
                      <span className="ov-muted">{same ? t("In your server") : t("Different server")}</span>
                    </span>
                    {canJoin ? (
                      <button className="ov-join" disabled={!!busy} onClick={() => join(f.presence!.gameId!, `f${f.id}`)}>
                        {busy === `f${f.id}` ? <span className="ov-spin" /> : t("Join")}
                      </button>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <p className="ov-muted ov-none">{t("None of your friends are here.")}</p>
            )}
          </div>
        )}
      </div>

      <footer className="ov-foot">
        <button className="ov-leave" disabled={!!busy} onClick={() => run("leave", () => call("overlayLeave"))}>
          <Icon name="arrow-large-left" size={18} /> {t("Leave experience")}
        </button>
        <span className="ov-hint">
          <kbd>{hotkey}</kbd> {t("close")}
        </span>
      </footer>
      {note ? <div className="ov-flash">{note}</div> : null}
    </div>
  );
}

export function OverlayApp() {
  const client = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }), []);
  useEffect(() => {
    document.documentElement.classList.add("overlay-mode");
  }, []);
  return (
    <QueryClientProvider client={client}>
      <OverlayPanel />
    </QueryClientProvider>
  );
}
