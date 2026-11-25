import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { call, win } from "../lib/ipc";
import { setBackgroundFile } from "../lib/appearance";
import { useUi } from "../app/store";
import { Icon, Spinner } from "./ui";
import { t } from "../lib/i18n";

type Credit = { author?: string | null; source?: string | null; page?: string | null; site: "Wallhaven" | "MoeWalls"; title?: string };
type Result = { id: string; kind: "picture" | "video"; title?: string; thumb: string; file?: string; page: string; wallhavenId?: string; credit?: Credit; resolution?: string };
type Page = { items: Result[]; lastPage?: number };

const CREDIT_KEY = "ruby.bgCredit";

export function backgroundCredit(): Credit | null {
  try {
    return JSON.parse(localStorage.getItem(CREDIT_KEY) ?? "null");
  } catch {
    return null;
  }
}
export function setBackgroundCredit(c: Credit | null) {
  try {
    if (c) localStorage.setItem(CREDIT_KEY, JSON.stringify(c));
    else localStorage.removeItem(CREDIT_KEY);
  } catch {
    /* credit display only */
  }
}

/** Where the current background came from, linking back to it. */
export function CreditLine() {
  const c = backgroundCredit();
  if (!c) return null;
  const link = c.source || c.page;
  return (
    <span className="muted small wp-credit">
      {c.title ? <b>{c.title}</b> : t("Background")}
      {c.author ? <> {t("by {author}", { author: c.author })}</> : null} · {t("from {site}", { site: c.site })}
      {link ? (
        <>
          {" · "}
          <button className="link small" onClick={() => void win.openExternal(link)}>
            {c.source ? t("original") : t("view")}
          </button>
        </>
      ) : null}
    </span>
  );
}

const b64ToBlob = (data: string, mime: string) => {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new Blob([out], { type: mime });
};

/** A search preview, fetched by Ruby and shown as a data URL. */
function Preview({ url }: { url: string }) {
  const q = useQuery({ queryKey: ["wpThumb", url], queryFn: () => call<string>("wallpaperThumb", url), staleTime: Infinity, retry: 1 });
  return q.data ? <img src={q.data} alt="" draggable={false} /> : <span className={`wp-ph ${q.isError ? "err" : "skel"}`} />;
}

/** Live wallpapers from MoeWalls and pictures from Wallhaven; picking one makes it the background. */
export function WallpaperSearch({ onPicked }: { onPicked: () => void }) {
  const { toast } = useUi();
  const [kind, setKind] = useState<"video" | "picture">("video");
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // Search as you type, once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => setQ(draft.trim()), 450);
    return () => clearTimeout(timer);
  }, [draft]);

  const search = useInfiniteQuery({
    queryKey: ["wallpapers", kind, q],
    queryFn: ({ pageParam }) => call<Page>(kind === "picture" ? "wallpaperPictures" : "wallpaperVideos", q, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.lastPage && all.length < last.lastPage ? all.length + 1 : undefined),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const items = search.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  // Load the next page when the end of the grid scrolls into view.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage();
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [search.hasNextPage, search.isFetchingNextPage, search.fetchNextPage, items.length]);

  const pick = async (r: Result) => {
    setBusy(r.id);
    try {
      const file = r.kind === "video" ? await call<string>("wallpaperVideoFile", r.page) : r.file!;
      const credit: Credit | null =
        r.credit ?? (r.wallhavenId ? await call<Credit>("wallpaperCredit", r.wallhavenId).catch(() => ({ site: "Wallhaven" as const, page: r.page })) : null);
      const { mime, data } = await call<{ mime: string; data: string }>("wallpaperDownload", file);
      const ext = mime.split("/")[1] ?? "bin";
      const thumb = await call<string>("wallpaperThumb", r.thumb).catch(() => null);
      setBackgroundCredit(credit);
      await setBackgroundFile(new File([b64ToBlob(data, mime)], `${r.id}.${ext}`, { type: mime }), { id: r.id, title: r.title ?? r.credit?.title ?? (r.kind === "video" ? t("Live wallpaper") : t("Wallhaven picture")), thumb, credit });
      toast(r.title ? t("Background set: {title}.", { title: r.title }) : t("Background set."));
      onPicked();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="wp-search">
      <div className="wp-search-bar">
        <label className="wp-search-input">
          <Icon name="magnifying-glass" size={18} />
          <input
            placeholder={kind === "video" ? t("Search live wallpapers: rain, genshin, lofi…") : t("Search pictures: night city, landscape…")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          {draft ? (
            <button className="icon-btn" aria-label={t("Clear search")} onClick={() => setDraft("")}>
              <Icon name="x-small" size={16} />
            </button>
          ) : null}
        </label>
        <div className="segmented small">
          <button className={kind === "video" ? "active" : ""} onClick={() => setKind("video")}>
            {t("Live")}
          </button>
          <button className={kind === "picture" ? "active" : ""} onClick={() => setKind("picture")}>
            {t("Pictures")}
          </button>
        </div>
      </div>
      {search.isLoading ? (
        <div className="wp-grid">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className="wp-tile">
              <span className="wp-ph skel" />
            </span>
          ))}
        </div>
      ) : search.error ? (
        <div className="muted small">{search.error instanceof Error ? search.error.message : t("Search isn't available right now.")}</div>
      ) : !items.length ? (
        <div className="muted small">{t("Nothing found. Try other words.")}</div>
      ) : (
        <>
          <div className="wp-grid">
            {items.map((r) => (
              <button key={r.id} className="wp-tile" disabled={!!busy} onClick={() => void pick(r)} title={r.title ?? r.resolution ?? ""}>
                <Preview url={r.thumb} />
                {r.kind === "video" ? <span className="bg-tile-tag">{t("LIVE")}</span> : null}
                {r.title ? <span className="wp-title ellipsis">{r.title}</span> : null}
                {busy === r.id ? (
                  <span className="wp-busy">
                    <Spinner size={20} />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div ref={sentinel} className="wp-sentinel">
            {search.isFetchingNextPage ? <Spinner size={20} /> : null}
          </div>
        </>
      )}
      <span className="muted tiny">{t("Live wallpapers from MoeWalls, pictures from Wallhaven (safe for work only). Picked wallpapers stay on this PC, credited to where they came from.")}</span>
    </div>
  );
}
