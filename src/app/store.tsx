import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { launcher, playability, playBlock, session, universeOfPlace, type Me } from "../lib/api";
import { call, on, rbx, setSessionExpiredHandler } from "../lib/ipc";
import { pref } from "../lib/appearance";
import { t } from "../lib/i18n";

function startRoute(): Route {
  const p = pref("startPage");
  return p === "friends" || p === "chat" || p === "mods" || p === "avatar" ? { name: p } : { name: "home" };
}

export type Route =
  | { name: "home"; tab?: "foryou" | "charts" }
  | { name: "game"; universeId: number }
  | { name: "servers"; universeId: number; placeId: number; gameName: string; openCreate?: boolean }
  | { name: "search"; q: string }
  | { name: "list"; kind: string }
  | { name: "friends"; tab?: "friends" | "requests" }
  | { name: "chat"; conversationId?: string; withUserId?: number }
  | { name: "avatar"; tab?: "marketplace" | "customize" | "profile" }
  | { name: "profile"; userId: number }
  | { name: "connections"; userId: number; kind: "friends" | "followers" | "following" | "mutuals" }
  | { name: "communities" }
  | { name: "communitySearch"; q?: string }
  | { name: "community"; groupId: number; tab?: string }
  | { name: "item"; itemType: "Asset" | "Bundle"; id: number }
  | { name: "settings" }
  | { name: "robux" }
  | { name: "editProfile" }
  | { name: "captures" }
  | { name: "help" }
  | { name: "inbox" }
  | { name: "inventory" }
  | { name: "trades"; box?: "Inbound" | "Outbound" | "Completed" | "Inactive" | "Values" }
  | { name: "trade"; userId: number; counterId?: number }
  | { name: "client" }
  | { name: "mods"; cat?: "look" | "graphics" | "interface" | "world" | "social" | "packs" }
  | { name: "rubySettings"; tab?: "general" | "roblox" | "about" }
  | { name: "plugins" }
  | { name: "plugin"; pluginId: string; pageId: string }
  | { name: "web"; url: string; title: string }
  | { name: "create"; section?: string; universeId?: number };

/** `replace` swaps the current entry (e.g. remembering a tab) so Back returns to it as you left it. */
type Nav = { route: Route; go: (r: Route) => void; replace: (r: Route) => void; back: () => void; canBack: boolean };
const NavCtx = createContext<Nav>(null!);

export function NavProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>(() => [startRoute()]);
  const go = useCallback((r: Route) => setStack((s) => (JSON.stringify(s[s.length - 1]) === JSON.stringify(r) ? s : [...s.slice(-30), r])), []);
  const replace = useCallback((r: Route) => setStack((s) => [...s.slice(0, -1), r]), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const value = useMemo(() => ({ route: stack[stack.length - 1], go, replace, back, canBack: stack.length > 1 }), [stack, go, replace, back]);
  useEffect(() => {
    const f = (e: Event) => {
      const d = (e as CustomEvent<{ url: string; title: string }>).detail;
      go({ name: "web", url: d.url, title: d.title });
    };
    window.addEventListener("ruby-web", f);
    return () => window.removeEventListener("ruby-web", f);
  }, [go]);
  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>;
}
export const useNav = () => useContext(NavCtx);

type SessionState = {
  status: "loading" | "signedOut" | "signedIn";
  me: Me;
  refresh: () => Promise<void>;
};
const SessionCtx = createContext<SessionState>(null!);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me>({});
  const [status, setStatus] = useState<SessionState["status"]>("loading");

  const apply = useCallback((u: Me | null | undefined) => {
    if (u && u.id) {
      setMe(u);
      setStatus("signedIn");
    }
  }, []);

  const refresh = useCallback(async () => {
    apply(await session.refresh().catch(() => null));
  }, [apply]);

  useEffect(() => {
    let revalidating = false;
    setSessionExpiredHandler(async () => {
      // A 401 means the stored cookie may be dead. Confirm with one authenticated
      // call before tearing the session down, so a single flaky request can't log us out.
      if (revalidating) return;
      revalidating = true;
      const u = await session.refresh().catch(() => ({}) as Me);
      if (!u.id) {
        setMe({});
        setStatus("signedOut");
      }
      revalidating = false;
    });
    const subs = [
      on<Me>("user-data", (u) => {
        if (u && u.id) apply(u);
        else {
          setMe({});
          setStatus("signedOut");
        }
      }),
      on<boolean>("login-bar-visible", (visible) => {
        if (visible) setStatus("signedOut");
      }),
      // After buying/redeeming in the Roblox popup, pick up the new Robux balance.
      on("roblox-web-closed", () => {
        session.refresh().then(apply).catch(() => undefined);
      }),
    ];
    // The backend may still be restoring the session (it emits user-data when done), but after
    // a page reload that event has already fired, so don't just wait: keep asking until we
    // know, backing off so a rate-limited Roblox isn't hammered.
    let cancelled = false;
    (async () => {
      for (let attempt = 0; !cancelled; attempt++) {
        const u = await (attempt < 2 ? session.me() : session.refresh()).catch(() => ({}) as Me);
        if (cancelled) return;
        if (u?.id) return apply(u);
        const st = await session.authState().catch(() => null);
        if (st?.loginBarVisible) return setStatus("signedOut");
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 15_000)));
      }
    })();
    return () => {
      cancelled = true;
      subs.forEach((p) => p.then((un) => un()));
    };
  }, [apply]);

  return <SessionCtx.Provider value={{ status, me, refresh }}>{children}</SessionCtx.Provider>;
}
export const useSession = () => useContext(SessionCtx);
export const useMe = () => {
  const { me } = useSession();
  return { ...me, id: me.id! };
};

type Toast = { id: number; text: string; kind: "info" | "error" };
type Launch = { name: string; placeId: number } | null;
type UiState = {
  launching: Launch;
  playing: { placeId: number } | null;
  play: (placeId: number, name: string, jobId?: string) => Promise<void>;
  toast: (text: string, kind?: Toast["kind"]) => void;
  toasts: Toast[];
  dismissLaunch: () => void;
};
const UiCtx = createContext<UiState>(null!);

export function UiProvider({ children }: { children: ReactNode }) {
  const [launching, setLaunching] = useState<Launch>(null);
  const [playing, setPlaying] = useState<UiState["playing"]>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  // Ruby opened mid-game: show it as playing right away (the backend adopts the session).
  useEffect(() => {
    call<{ running: boolean; placeId?: string | null }>("getGameSession")
      .then((s) => s.running && s.placeId && setPlaying((p) => p ?? { placeId: Number(s.placeId) }))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const sub = on<{ running: boolean; placeId?: number }>("roblox-session-state", (s) => {
      setPlaying(s.running && s.placeId ? { placeId: s.placeId } : null);
      if (s.running) setTimeout(() => setLaunching(null), 2500);
      else setLaunching(null);
    });
    return () => void sub.then((un) => un());
  }, []);

  const play = useCallback(
    async (placeId: number, name: string, jobId?: string) => {
      if (!placeId) return toast(t("This experience can't be launched."), "error");
      if (!jobId) {
        const uid = await universeOfPlace(placeId);
        const block = uid ? playBlock(await playability(uid)) : null;
        if (block) {
          if (block.kind === "robux" || block.kind === "fiat") {
            // Buying access happens on Roblox's own page (Robux checkout or real-money purchase).
            window.dispatchEvent(new CustomEvent("ruby-web", { detail: { url: `https://www.roblox.com/games/${placeId}`, title: name } }));
          }
          return toast(block.text, "error");
        }
      }
      setLaunching({ name, placeId });
      try {
        await launcher.launch(placeId, jobId, { name });
      } catch (e) {
        setLaunching(null);
        toast(String(e).includes("not found") ? t("Roblox isn't installed. Install it from roblox.com/download.") : t("Couldn't start Roblox: {error}", { error: String(e) }), "error");
      }
    },
    [toast],
  );

  // Desktop game shortcuts start Ruby with `--play <placeId>` (or reach the running Ruby).
  useEffect(() => {
    const start = async (placeId: number) => {
      const r = await rbx<{ name?: string }[]>(`https://games.roblox.com/v1/games/multiget-place-details?placeIds=${placeId}`).catch(() => []);
      void play(placeId, r[0]?.name ?? "Roblox");
    };
    void call<number | null>("takeStartupPlay").then((p) => void (p && start(p))).catch(() => {});
    const sub = on<number>("ruby-play", (p) => void start(p));
    return () => void sub.then((un) => un());
  }, [play]);

  return (
    <UiCtx.Provider value={{ launching, playing, play, toast, toasts, dismissLaunch: () => setLaunching(null) }}>
      {children}
    </UiCtx.Provider>
  );
}
export const useUi = () => useContext(UiCtx);
