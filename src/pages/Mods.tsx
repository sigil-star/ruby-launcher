import { useQuery } from "@tanstack/react-query";
import { usePluginCustomizeTabs, type PluginCustomizeTab } from "../lib/plugins";
import { RubyPrefsSections } from "./Settings";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { call } from "../lib/ipc";
import { useUi } from "../app/store";
import { Icon, Skel, type IconName } from "../components/ui";
import { GraphicsPanel, graphicsQuery, saveGraphics, type GraphicsSettings } from "../components/Graphics";
import { t } from "../lib/i18n";

type Theme = {
  enabled: boolean;
  color: string;
  rubyLogos: boolean;
  forceField: string | null;
  skybox: string | null;
  customFont: boolean;
  cursor: string | null;
  cursorColor: string | null;
  shiftLock: string | null;
  emoteWheel: string | null;
  extraMods: string[];
  fontPreset: string | null;
  micPack: string | null;
  surface?: string | null;
  deathSound?: string | null;
  customFontName?: string | null;
};
type MicPack = { id: string; name: string; frames: (string | null)[]; imported: boolean };

/** Plays a mic pack like it would in-game: muted, quiet, then talking and pausing. */
function MicCard({ p, on, onPick }: { p: MicPack; on: boolean; onPick: () => void }) {
  // Frames: 0 muted, 1 quiet, 2 talking.
  const seq = [0, 0, 0, 1, 1, 2, 1, 2, 2, 1, 2, 1, 1];
  const [i, setI] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setI((x) => (x + 1) % seq.length), 260);
    return () => window.clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const frame = p.frames[seq[i]] ?? p.frames.find(Boolean) ?? null;
  return (
    <button className={`pick-card ${on ? "on" : ""}`} onClick={onPick} title={p.name}>
      <span className="pick-art mic">{frame ? <img src={frame} alt="" draggable={false} /> : null}</span>
      <span className="pick-name ellipsis">{p.name}</span>
      {p.imported ? <span className="pick-tag">{t("Imported")}</span> : null}
    </button>
  );
}
type FontItem = { file: string; name: string };
type FfPreset = { name: string; color: string };

/** Shows a font's name in that font (the file comes from the Roblox install, loaded once). */
function FontCard({ f, on, onPick }: { f: FontItem; on: boolean; onPick: () => void }) {
  const family = `ruby-font-${f.file.replace(/[^a-z0-9]/gi, "")}`;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    call<{ url: string }>("fontPreview", f.file)
      .then(async ({ url }) => {
        const face = new FontFace(family, `url(${url})`);
        await face.load();
        document.fonts.add(face);
        if (alive) setReady(true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [f.file, family]);
  return (
    <button className={`font-card ${on ? "on" : ""}`} onClick={onPick}>
      <span className="font-sample" style={ready ? { fontFamily: family } : { opacity: 0.4 }}>
        Aa
      </span>
      <span className="pick-name ellipsis">{f.name}</span>
    </button>
  );
}

/** The force field in a colour, rendered from Roblox's own textures (see force_field_preview). */
function FfCard({ p, on, onPick }: { p: FfPreset; on: boolean; onPick: () => void }) {
  const q = useQuery({ queryKey: ["ffPreview", p.color], queryFn: () => call<{ url: string }>("forceFieldPreview", p.color), staleTime: Infinity, retry: false });
  return (
    <button className={`pick-card ${on ? "on" : ""}`} onClick={onPick}>
      <span className="pick-art ff">{q.data ? <img src={q.data.url} alt="" draggable={false} /> : <span className="skel" />}</span>
      <span className="pick-name">{p.name}</span>
    </button>
  );
}
type UserPack = { name: string; kind: "cursor" | "wheel" | "mod" | "mic"; files: number; preview: string | null; bundled?: boolean };
const kindLabel = (k: UserPack["kind"]) => (k === "cursor" ? t("Cursor") : k === "wheel" ? t("Emote wheel") : k === "mod" ? t("Texture mod") : t("Mic pack"));

const readB64 = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });
type Pack = { id: string; name: string };
type CursorSet = { hover: string | null; text: string | null; lock: string | null; dragOpen: string | null; dragClosed: string | null };
type CursorPack = { id: string; name: string; credit: string; preview: string | null; set?: CursorSet };
type ShiftLock = { id: string; name: string; preview: string | null };
type WheelStyle = { id: string; name: string; bg: string; lines: string; selected: string; bgAlpha: number };
const PRESETS = ["#e0245e", "#ff5c8a", "#ff7a00", "#ffd60a", "#3ddc84", "#00c2ff", "#335fff", "#9b5cff", "#ffffff"];

function Swatches({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div className="theme-swatches" role="radiogroup" aria-label={label}>
      {PRESETS.map((c) => (
        <button key={c} role="radio" aria-checked={value.toLowerCase() === c} className={`swatch ${value.toLowerCase() === c ? "on" : ""}`} style={{ background: c }} onClick={() => onChange(c)} aria-label={c} />
      ))}
      <label className="swatch custom" title={t("Custom colour")} style={{ background: value }}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        <Icon name="plus-small" size={16} />
      </label>
    </div>
  );
}

function SkyThumb({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["skyThumb", id], queryFn: () => call<{ url: string }>("skyboxThumb", id), staleTime: Infinity, retry: false });
  return q.data ? <img src={q.data.url} alt="" draggable={false} /> : <span className="skel" />;
}

/** A small drawing of the wheel style (Roblox's real wheel layers are recoloured in-game). */
function WheelPreview({ w }: { w: WheelStyle }) {
  const spokes = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4 + Math.PI / 8);
  return (
    <svg viewBox="0 0 100 100" className="wheel-preview" aria-hidden>
      <circle cx="50" cy="50" r="46" fill={w.bg} fillOpacity={Math.min(1, 0.72 * w.bgAlpha)} stroke={w.lines} strokeWidth="1.2" />
      <path d="M50 50 L50 4 A46 46 0 0 1 82.5 17.5 Z" fill={w.selected} fillOpacity="0.28" />
      {spokes.map((a, i) => (
        <line key={i} x1={50 + Math.cos(a) * 20} y1={50 + Math.sin(a) * 20} x2={50 + Math.cos(a) * 46} y2={50 + Math.sin(a) * 46} stroke={w.lines} strokeWidth="1.2" />
      ))}
      <circle cx="50" cy="50" r="20" fill={w.bg} fillOpacity="0.95" />
    </svg>
  );
}

/** Side-menu categories, and which section lives in which. */
const CATS = [
  { id: "look", label: () => t("Ruby look"), icon: "star" },
  { id: "interface", label: () => t("Cursor & UI"), icon: "paint-brush" },
  { id: "social", label: () => t("Emote wheel & Voice"), icon: "person-play" },
  { id: "world", label: () => t("World & Sounds"), icon: "compass" },
  { id: "graphics", label: () => t("Graphics"), icon: "three-sliders-horizontal" },
  { id: "packs", label: () => t("Imported Packs"), icon: "two-folders" },
] as const;
type Cat = (typeof CATS)[number]["id"];
const CAT_OF: Record<string, Cat> = {
  "Ruby logo": "interface",
  "UI tint": "interface",
  Font: "interface",
  Cursor: "interface",
  Surfaces: "world",
  "Force field": "world",
  Skybox: "world",
  "Emote wheel": "social",
  Microphone: "social",
  "Death sound": "world",
  "Imported packs": "packs",
};
const CatCtx = createContext<string>("graphics");

function Section({ title, name, sub, action, children }: { title: string; name: string; sub: string; action?: ReactNode; children?: ReactNode }) {
  const cat = useContext(CatCtx);
  if ((CAT_OF[title] ?? "interface") !== cat) return null;
  return (
    <section className="client-card mod-section">
      <div className="mod-head">
        <div>
          <h2 className="sub-title">{name}</h2>
          <div className="muted small">{sub}</div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Mods: change how Roblox looks in-game. Everything is reversible: Ruby backs up each original
 * file per Roblox version and re-applies your choices after Roblox updates.
 */
export function ModsPage({ initialCat }: { initialCat?: string } = {}) {
  const { toast } = useUi();
  const q = useQuery({ queryKey: ["ingameTheme"], queryFn: () => call<Theme>("getIngameTheme") });
  const packs = useQuery({ queryKey: ["skyboxes"], queryFn: () => call<{ packs: Pack[] }>("listSkyboxes") });
  const [draft, setDraft] = useState<Theme | null>(null);
  const gq = useQuery(graphicsQuery);
  const others = useQuery({ queryKey: ["otherBootstrappers"], queryFn: () => call<{ found: { name: string }[] }>("otherBootstrappers"), staleTime: 60_000 });
  const sounds = useQuery({ queryKey: ["deathSounds"], queryFn: () => call<{ sounds: { id: string; name: string; url: string }[]; roblox?: string | null }>("deathSounds"), staleTime: Infinity });
  const [gfx, setGfx] = useState<GraphicsSettings | null>(null);
  useEffect(() => {
    if (gq.data && !gfx) setGfx(gq.data.settings);
  }, [gq.data, gfx]);
  const catalog = useQuery({
    queryKey: ["modCatalog", draft?.cursorColor ?? ""],
    queryFn: () => call<{ cursors: CursorPack[]; wheels: WheelStyle[]; shiftLocks: ShiftLock[] }>("modCatalog", draft?.cursorColor ?? ""),
    enabled: !!draft,
    placeholderData: (prev) => prev,
  });
  const userPacks = useQuery({ queryKey: ["userPacks"], queryFn: () => call<{ packs: UserPack[] }>("listUserPacks") });
  const fonts = useQuery({ queryKey: ["robloxFonts"], queryFn: () => call<{ fonts: FontItem[] }>("listFonts"), staleTime: Infinity });
  const mics = useQuery({ queryKey: ["micPacks"], queryFn: () => call<{ packs: MicPack[] }>("micPacks"), staleTime: 60_000 });
  const ffPresets = useQuery({ queryKey: ["ffPresets"], queryFn: () => call<FfPreset[]>("forceFieldPresets"), staleTime: Infinity });
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    if (q.data && !draft) setDraft({ ...q.data, extraMods: q.data.extraMods ?? [] });
  }, [q.data, draft]);
  // Zips dropped in the packs folder are picked up whenever the window regains focus.
  useEffect(() => {
    const onFocus = () => {
      userPacks.refetch().then(() => packs.refetch());
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // `cat` is a built-in category id, or `plugin:<pluginId>:<tabId>` for a plugin's Customize tab.
  const [cat, setCatState] = useState<string>(() => {
    if (initialCat && CATS.some((c) => c.id === initialCat)) return initialCat;
    try {
      const saved = localStorage.getItem("ruby.modsCat");
      return saved && CATS.some((c) => c.id === saved) ? saved : "look";
    } catch {
      return "look";
    }
  });
  const setCat = (c: string) => {
    setCatState(c);
    try {
      // Only built-in categories are remembered; plugin tabs shouldn't stick across restarts.
      if (CATS.some((x) => x.id === c)) localStorage.setItem("ruby.modsCat", c);
    } catch {
      /* preference only */
    }
  };
  const pluginTabs = usePluginCustomizeTabs();
  const activePluginTab = pluginTabs.find((p) => cat === `plugin:${p.pluginId}:${p.id}`);

  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<{ ctx: AudioContext; src?: AudioBufferSourceNode } | null>(null);
  if (!draft)
    return (
      <div className="page narrow mods-page">
        <h1 className="page-title">{t("Customize")}</h1>
        <Skel h={160} r={14} />
        <Skel h={160} r={14} />
      </div>
    );

  const strip = (th?: Theme | null) => {
    if (!th) return "";
    const { customFontName: _n, ...rest } = th;
    return JSON.stringify(rest);
  };
  const gfxDirty = !!gfx && JSON.stringify(gfx) !== JSON.stringify(gq.data?.settings);
  const dirty = strip(draft) !== strip(q.data) || gfxDirty;
  const set = (patch: Partial<Theme>) => setDraft({ ...draft, ...patch });

  const apply = async () => {
    setBusy(true);
    try {
      const { customFontName: _n, ...settings } = draft;
      if (strip(draft) !== strip(q.data)) {
        await call<{ files: number }>("setIngameTheme", settings);
        await q.refetch();
      }
      if (gfxDirty && gfx) {
        await saveGraphics(gfx);
        await gq.refetch();
      }
    } catch (e) {
      toast(t("Couldn't apply: {error}", { error: String((e as Error)?.message ?? e) }), "error");
    } finally {
      setBusy(false);
    }
  };

  /** Import one zip, or several loose files as one pack. */
  const importPack = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length || !draft) return;
    setImporting(true);
    try {
      const r =
        files.length === 1
          ? await call<{ kind: string; name: string; id?: string }>("importPack", files[0].name, await readB64(files[0]))
          : await call<{ kind: string; name: string; id?: string }>("importPackFiles", files[0].name.replace(/\.[^.]+$/, ""), await Promise.all(files.map(async (f) => [f.name, await readB64(f)])));
      await Promise.all([userPacks.refetch(), packs.refetch(), q.refetch(), mics.refetch()]);
      // Select what was imported, so Apply puts it straight in.
      if (r.kind === "cursor") setDraft((d) => d && { ...d, cursor: `user:${r.name}` });
      else if (r.kind === "wheel") setDraft((d) => d && { ...d, emoteWheel: `user:${r.name}` });
      else if (r.kind === "mod") setDraft((d) => d && { ...d, extraMods: [...new Set([...(d.extraMods ?? []), r.name])] });
      else if (r.kind === "skybox" && r.id) setDraft((d) => d && { ...d, skybox: r.id! });
      else if (r.kind === "font") setDraft((d) => d && { ...d, customFont: true, customFontName: r.name });
      else if (r.kind === "mic") setDraft((d) => d && { ...d, micPack: `user:${r.name}` });
      toast(t("Imported {name} ({kind}). Press Apply to use it.", { name: r.name, kind: r.kind === "mod" ? t("texture mod") : r.kind === "cursor" ? t("cursor") : r.kind === "wheel" ? t("emote wheel") : r.kind === "skybox" ? t("skybox") : r.kind === "font" ? t("font") : r.kind === "mic" ? t("mic pack") : r.kind }));
    } catch (e) {
      toast(String((e as Error)?.message ?? e), "error");
    } finally {
      setImporting(false);
    }
  };

  const importOther = async (name: string) => {
    setImporting(true);
    try {
      const r = await call<{ kind: string; name: string }>("importBootstrapper", name);
      await Promise.all([userPacks.refetch(), packs.refetch(), mics.refetch()]);
      if (r.kind === "mod") setDraft((d) => d && { ...d, extraMods: [...new Set([...(d.extraMods ?? []), r.name])] });
      toast(t("Imported your {name} mods. Press Apply to use them.", { name }));
    } catch (e) {
      toast(String((e as Error)?.message ?? e), "error");
    } finally {
      setImporting(false);
    }
  };
  // WebView2 can't play .ogg in an <audio> tag, so decode it with Web Audio instead.
  const playSound = async (id: string, url?: string | null) => {
    const cur = audioRef.current ?? (audioRef.current = { ctx: new AudioContext() });
    try { cur.src?.stop(); } catch { /* already stopped */ }
    cur.src = undefined;
    if (!url || playing === id) return setPlaying(null);
    setPlaying(id);
    try {
      const data = Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) => c.charCodeAt(0)).buffer;
      const buf = await cur.ctx.decodeAudioData(data);
      const src = cur.ctx.createBufferSource();
      const gain = cur.ctx.createGain();
      gain.gain.value = 0.6;
      src.buffer = buf;
      src.connect(gain).connect(cur.ctx.destination);
      src.onended = () => setPlaying((p) => (p === id ? null : p));
      cur.src = src;
      await cur.ctx.resume();
      src.start();
    } catch (e) {
      setPlaying(null);
      toast(t("Couldn't play that sound: {error}", { error: String((e as Error)?.message ?? e) }), "error");
    }
  };
  const pickDeathSound = async (list: FileList | null) => {
    const f = list?.[0];
    if (!f) return;
    try {
      await call("setDeathSound", await readB64(f));
      // A new file: bump the setting so Apply sees a change even if "custom" was already on.
      setDraft((d) => d && { ...d, deathSound: "custom" });
      await sounds.refetch();
      toast(t("Using {name}. Press Apply to put it in.", { name: f.name }));
    } catch (e) {
      toast(String((e as Error)?.message ?? e), "error");
    }
  };

  const removePack = async (pk: UserPack) => {
    try {
      await call("deleteUserPack", pk.name);
      const ref = `user:${pk.name}`;
      setDraft((d) => d && { ...d, cursor: d.cursor === ref ? null : d.cursor, emoteWheel: d.emoteWheel === ref ? null : d.emoteWheel, micPack: d.micPack === ref ? null : d.micPack, extraMods: (d.extraMods ?? []).filter((m) => m !== pk.name) });
      await Promise.all([userPacks.refetch(), mics.refetch()]);
      toast(t("Removed {name}. Press Apply to restore Roblox's files.", { name: pk.name }));
    } catch (e) {
      toast(String((e as Error)?.message ?? e), "error");
    }
  };

  const mine = userPacks.data?.packs ?? [];

  const pickFont = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const b64 = String(reader.result).split(",")[1] ?? "";
      try {
        await call("setCustomFont", file.name, b64);
        setDraft({ ...draft, customFont: true, customFontName: file.name });
        toast(t("{name} is ready. Press Apply to use it.", { name: file.name }));
      } catch (e) {
        toast(String((e as Error)?.message ?? e), "error");
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <CatCtx.Provider value={cat}>
    <div className="page mods-page">
      <div className="mods-top">
        <div>
          <h1 className="page-title">{t("Customize")}</h1>
          <p className="muted small">{t("Make Ruby and Roblox look how you like. In-game originals are backed up, so anything you turn off goes back exactly as it was.")}</p>
        </div>
        <div className="client-actions">
          <button className="btn btn-secondary btn-small" onClick={() => call("openPacksFolder")} title={t("Drop big zips here; Ruby imports them automatically")}>
            {t("Packs folder")}
          </button>
          <label className={`btn btn-primary btn-small file-btn ${importing ? "disabled" : ""}`}>
            {importing ? t("Importing…") : t("Import pack")}
            <input type="file" multiple accept=".zip,.png,.tex,.ttf,.otf" disabled={importing} onChange={(e) => {
              importPack(e.target.files);
              e.target.value = "";
            }} />
          </label>
        </div>
      </div>

      <div className="mods-layout">
        <nav className="mods-nav" aria-label={t("Mod categories")}>
          {CATS.map((c) => (
            <button key={c.id} className={cat === c.id ? "on" : ""} onClick={() => setCat(c.id)} aria-current={cat === c.id ? "page" : undefined}>
              <Icon name={c.icon} size={24} />
              <span className="ellipsis">{c.label()}</span>
              {c.id === "packs" && mine.length ? <span className="mods-nav-count">{mine.length}</span> : null}
            </button>
          ))}
          {pluginTabs.map((p) => {
            const key = `plugin:${p.pluginId}:${p.id}`;
            return (
              <button key={key} className={cat === key ? "on" : ""} onClick={() => setCat(key)}>
                <Icon name={(p.icon as IconName) ?? "squares-grid-qr"} size={24} />
                <span className="ellipsis">{p.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="mods-body" key={cat}>
      {activePluginTab ? <PluginTabMount tab={activePluginTab} /> : null}
      {cat === "graphics" ? <GraphicsPanel g={gfx} onChange={setGfx} /> : null}
      {cat === "look" ? (
        <section className="client-card mod-section look-section">
          <div className="mod-head">
            <div>
              <h2 className="sub-title">{t("Ruby look")}</h2>
              <div className="muted small">{t("Background, colours and fonts for Ruby itself. These change straight away, no Apply needed.")}</div>
            </div>
          </div>
          <RubyPrefsSections part="look" />
        </section>
      ) : null}

      <Section
        title="Ruby logo"
        name={t("Ruby logo")}
        sub={t("Ruby's logo in place of Roblox's in-game, including the menu button icon.")}
        action={<input type="checkbox" className="switch" aria-label={t("Ruby logo")} checked={draft.rubyLogos} onChange={(e) => set({ rubyLogos: e.target.checked })} />}
      />

      <Section
        title="Cursor"
        name={t("Cursor")}
        sub={t("Your mouse pointer in-game.")}
        action={draft.cursor && !draft.cursor.startsWith("user:") ? <input type="checkbox" className="switch" aria-label={t("Colour the cursor")} title={t("Colour the cursor")} checked={!!draft.cursorColor} onChange={(e) => set({ cursorColor: e.target.checked ? (draft.cursorColor ?? "#e0245e") : null })} /> : null}
      >
        <div className="pick-grid cursors">
          <button className={`pick-card ${!draft.cursor ? "on" : ""}`} onClick={() => set({ cursor: null, cursorColor: null })}>
            <span className="pick-art default">Roblox</span>
            <span className="pick-name">{t("Default")}</span>
          </button>
          {mine
            .filter((pk) => pk.kind === "cursor")
            .map((pk) => (
              <button key={pk.name} className={`pick-card ${draft.cursor === `user:${pk.name}` ? "on" : ""}`} onClick={() => set({ cursor: `user:${pk.name}`, cursorColor: null })} title={t("{name} (imported)", { name: pk.name })}>
                <span className="pick-art">{pk.preview ? <img src={pk.preview} alt="" draggable={false} /> : null}</span>
                <span className="pick-name ellipsis">{pk.name}</span>
                <span className="pick-tag">{t("Imported")}</span>
              </button>
            ))}
          {(catalog.data?.cursors ?? []).map((c) => (
            <button key={c.id} className={`pick-card ${draft.cursor === c.id ? "on" : ""}`} onClick={() => set({ cursor: c.id })} title={`${c.name} · ${c.credit}`}>
              <span className="pick-art">{c.preview ? <img src={c.preview} alt="" draggable={false} /> : null}</span>
              <span className="pick-name">{c.name}</span>
            </button>
          ))}
        </div>
        {draft.cursor && draft.cursorColor ? <Swatches label={t("Cursor colour")} value={draft.cursorColor} onChange={(c) => set({ cursorColor: c })} /> : null}
        {(() => {
          const c = catalog.data?.cursors.find((x) => x.id === draft.cursor);
          if (!c?.set) return null;
          const lockPreview = draft.shiftLock === "roblox" ? null : draft.shiftLock ? catalog.data?.shiftLocks.find((l) => l.id === draft.shiftLock)?.preview : c.set.lock;
          const parts: [string, string | null | undefined][] = [
            [t("Normal"), c.preview],
            [t("Button"), c.set.hover],
            [t("Text"), c.set.text],
            [t("Shift lock"), lockPreview],
            [t("Drag"), c.set.dragOpen],
            [t("Grab"), c.set.dragClosed],
          ];
          return (
            <div className="cursor-set">
              <span className="muted small">{t("Changes together:")}</span>
              {parts.map(([label, img]) => (
                <span key={label} className="cursor-set-item" title={label}>
                  <span className="cursor-set-art">{img ? <img src={img} alt="" draggable={false} /> : <span className="cursor-set-roblox">Roblox</span>}</span>
                  <span className="tiny muted">{label}</span>
                </span>
              ))}
            </div>
          );
        })()}

        <div className="shiftlock-row">
          <div>
            <b>{t("Shift lock")}</b>
            <div className="muted small">{t("The reticle shown while shift lock is on.")}</div>
          </div>
          <div className="segmented small" role="radiogroup" aria-label={t("Shift lock reticle")}>
            <button className={!draft.shiftLock ? "active" : ""} disabled={!draft.cursor || draft.cursor.startsWith("user:")} onClick={() => set({ shiftLock: null })} title={t("Use the reticle that goes with your cursor")}>
              {t("Match cursor")}
            </button>
            <button className={draft.shiftLock === "roblox" ? "active" : ""} onClick={() => set({ shiftLock: "roblox" })}>
              Roblox
            </button>
            {(catalog.data?.shiftLocks ?? []).map((l) => (
              <button key={l.id} className={`sl-btn ${draft.shiftLock === l.id ? "active" : ""}`} onClick={() => set({ shiftLock: l.id })} title={l.name}>
                {l.preview ? <img src={l.preview} alt="" draggable={false} /> : null}
                {l.name}
              </button>
            ))}
          </div>
        </div>
        <p className="muted tiny">{t("Cursors by Kenney (CC0) and Shira (RedGlow, CC BY). Picking a cursor also changes its text, shift lock and drag cursors to match.")}</p>
      </Section>

      <Section title="Emote wheel" name={t("Emote wheel")} sub={t("The wheel you open to pick an emote.")}>
        <div className="pick-grid wheels">
          <button className={`pick-card ${!draft.emoteWheel ? "on" : ""}`} onClick={() => set({ emoteWheel: null })}>
            <span className="pick-art default">Roblox</span>
            <span className="pick-name">{t("Default")}</span>
          </button>
          {mine
            .filter((pk) => pk.kind === "wheel")
            .map((pk) => (
              <button key={pk.name} className={`pick-card ${draft.emoteWheel === `user:${pk.name}` ? "on" : ""}`} onClick={() => set({ emoteWheel: `user:${pk.name}` })} title={pk.bundled ? pk.name : t("{name} (imported)", { name: pk.name })}>
                {pk.preview ? (
                  <span className="pick-art">
                    <img src={pk.preview} alt="" draggable={false} />
                  </span>
                ) : (
                  <span className="pick-art default">{t("Custom")}</span>
                )}
                <span className="pick-name ellipsis">{pk.name}</span>
                <span className="pick-tag">{pk.bundled ? t("Built-in") : t("Imported")}</span>
              </button>
            ))}
          {(catalog.data?.wheels ?? []).map((w) => (
            <button key={w.id} className={`pick-card ${draft.emoteWheel === w.id ? "on" : ""}`} onClick={() => set({ emoteWheel: w.id })}>
              <span className="pick-art">
                <WheelPreview w={w} />
              </span>
              <span className="pick-name">{w.name}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="Microphone"
        name={t("Microphone")}
        sub={t("Your voice chat mic icon: one picture for muted, one for quiet, one for talking.")}
        action={
          <label className="btn btn-secondary btn-small file-btn" title={t("Pick 3 pictures named Muted, Quiet and Talking (Roblox's Unmuted0…100 names work too)")}>
            {t("Import mic pack")}
            <input type="file" multiple accept=".png,.zip" onChange={(e) => {
              importPack(e.target.files);
              e.target.value = "";
            }} />
          </label>
        }
      >
        <div className="pick-grid wheels">
          <button className={`pick-card ${!draft.micPack ? "on" : ""}`} onClick={() => set({ micPack: null })}>
            <span className="pick-art default mic">Roblox</span>
            <span className="pick-name">{t("Default")}</span>
          </button>
          {(mics.data?.packs ?? []).map((m) => (
            <MicCard key={m.id} p={m} on={draft.micPack === m.id} onPick={() => set({ micPack: m.id })} />
          ))}
        </div>
      </Section>

      <Section
        title="UI tint"
        name={t("UI tint")}
        sub={t("Recolour the top bar, menus, chat, backpack, voice and loading screen.")}
        action={<input type="checkbox" className="switch" aria-label={t("UI tint")} checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />}
      >
        {draft.enabled ? <Swatches label={t("Tint colour")} value={draft.color} onChange={(c) => set({ color: c })} /> : null}
      </Section>

      <Section title="Surfaces" name={t("Surfaces")} sub={t("Restyles the plastic and stud textures Roblox ships with the client. Other materials (brick, grass, wood…) now stream from Roblox, so they can't be changed.")}>
        <div className="pick-grid surf-grid">
          {([
            [null, t("Default"), "surf-default"],
            ["dark", t("Dark"), "surf-dark"],
            ["pixel", t("Blocky"), "surf-pixel"],
          ] as const).map(([id, name, cls]) => (
            <button key={cls} className={`pick-card ${(draft.surface ?? null) === id ? "on" : ""}`} onClick={() => set({ surface: id })}>
              <span className={`surf-swatch ${cls}`} aria-hidden />
              <span className="small">{name}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="Force field"
        name={t("Force field")}
        sub={t("The bubble you spawn with.")}
      >
        <div className="pick-grid cursors">
          <button className={`pick-card ${!draft.forceField ? "on" : ""}`} onClick={() => set({ forceField: null })}>
            <span className="pick-art default">Roblox</span>
            <span className="pick-name">{t("Default")}</span>
          </button>
          {(ffPresets.data ?? []).map((p) => (
            <FfCard key={p.color} p={p} on={draft.forceField?.toLowerCase() === p.color} onPick={() => set({ forceField: p.color })} />
          ))}
          {draft.forceField && !(ffPresets.data ?? []).some((p) => p.color === draft.forceField?.toLowerCase()) ? (
            <FfCard p={{ name: t("Your colour"), color: draft.forceField }} on onPick={() => {}} />
          ) : null}
        </div>
        {draft.forceField && draft.forceField !== "rainbow" ? <Swatches label={t("Force field colour")} value={draft.forceField} onChange={(c) => set({ forceField: c })} /> : null}
      </Section>

      <Section
        title="Skybox"
        name={t("Skybox")}
        sub={t("Replaces Roblox's default sky. Games with their own sky keep theirs.")}
        action={
          <button className="btn btn-secondary btn-small" onClick={() => call("openSkyboxFolder")}>
            {t("Add skyboxes")}
          </button>
        }
      >
        <div className="sky-grid">
          <button className={`sky-card ${!draft.skybox ? "on" : ""}`} onClick={() => set({ skybox: null })}>
            <span className="sky-default">{t("Default")}</span>
            <span className="sky-name">{t("Roblox default")}</span>
          </button>
          {(packs.data?.packs ?? []).map((p) => (
            <button key={p.id} className={`sky-card ${draft.skybox === p.id ? "on" : ""}`} onClick={() => set({ skybox: p.id })} title={p.name}>
              <SkyThumb id={p.id} />
              <span className="sky-name ellipsis">{p.name.replace(/[-_]/g, " ")}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="Font"
        name={t("Font")}
        sub={draft.customFont && draft.customFontName ? t("Using your font: {name}", { name: draft.customFontName }) : t("Pick one of Roblox's fonts for all in-game text, or use your own .ttf or .otf.")}
        action={
          <div className="client-actions">
            <label className="btn btn-secondary btn-small file-btn">
              {t("Choose font")}
              <input type="file" accept=".ttf,.otf" onChange={(e) => pickFont(e.target.files?.[0])} />
            </label>
            <input type="checkbox" className="switch" aria-label={t("Use my font")} title={t("Use my font")} disabled={!draft.customFontName} checked={draft.customFont} onChange={(e) => set({ customFont: e.target.checked })} />
          </div>
        }
      >
        <div className={`font-grid ${draft.customFont ? "dim" : ""}`}>
          <button className={`font-card ${!draft.fontPreset && !draft.customFont ? "on" : ""}`} onClick={() => set({ fontPreset: null, customFont: false })}>
            <span className="font-sample default">Aa</span>
            <span className="pick-name">{t("Default")}</span>
          </button>
          {(fonts.data?.fonts ?? []).map((f) => (
            <FontCard key={f.file} f={f} on={!draft.customFont && draft.fontPreset === f.file} onPick={() => set({ fontPreset: f.file, customFont: false })} />
          ))}
        </div>
      </Section>

      <Section
        title="Death sound"
        name={t("Death sound")}
        sub={t("The sound when your character dies.")}
        action={
          <label className="btn btn-secondary btn-small file-btn" title={t("An .ogg sound file")}>
            {t("Pick a sound")}
            <input type="file" accept=".ogg,audio/ogg" onChange={(e) => {
              void pickDeathSound(e.target.files);
              e.target.value = "";
            }} />
          </label>
        }
      >
        <div className="sound-grid">
          <button className={`sound-card ${!draft.deathSound ? "on" : ""}`} onClick={() => set({ deathSound: null })}>
            {sounds.data?.roblox && (
              <span className="sound-play" role="button" aria-label={t("Play Roblox")} onClick={(e) => (e.stopPropagation(), void playSound("roblox", sounds.data?.roblox))}>
                <Icon name={playing === "roblox" ? "x-small" : "play-small"} size={16} />
              </span>
            )}
            <span className="sound-name">Roblox</span>
          </button>
          {(sounds.data?.sounds ?? []).map((snd) => (
            <button key={snd.id} className={`sound-card ${draft.deathSound === snd.id ? "on" : ""}`} onClick={() => (set({ deathSound: snd.id }), void playSound(snd.id, snd.url))}>
              <span
                className="sound-play"
                role="button"
                aria-label={t("Play {name}", { name: snd.name })}
                onClick={(e) => (e.stopPropagation(), void playSound(snd.id, snd.url))}
              >
                <Icon name={playing === snd.id ? "x-small" : "play-small"} size={16} />
              </span>
              <span className="sound-name ellipsis">{snd.name}</span>
            </button>
          ))}
        </div>
      </Section>

      {others.data?.found.length ? (
        <Section title="Imported packs" name={t("Imported packs")} sub={t("Found mods from another launcher on this PC. Bring them into Ruby with one click.")}>
          <div className="seg-row">
            {others.data.found.map((o) => (
              <button key={o.name} className="btn btn-secondary btn-small" disabled={importing} onClick={() => void importOther(o.name)}>
                {t("Import from {name}", { name: o.name })}
              </button>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Imported packs" name={t("Imported packs")} sub={mine.length ? t("Texture mods switch on and off here. Cursors and emote wheels show up in their pickers above.") : t("Nothing imported yet. Import a .zip (Bloxstrap-style mods, cursors, emote wheels, skyboxes) or a font.")}>
        {mine.length ? (
          <div className="pack-list">
            {mine.map((pk) => (
              <div key={pk.name} className="pack-row">
                <div className="pack-text">
                  <b className="ellipsis">{pk.name}</b>
                  <span className="muted small">
                    {kindLabel(pk.kind)} · {pk.files === 1 ? t("1 file") : t("{n} files", { n: pk.files })}
                  </span>
                </div>
                {pk.kind === "mod" ? (
                  <input
                    type="checkbox"
                    className="switch"
                    aria-label={t("Use {name}", { name: pk.name })}
                    checked={(draft.extraMods ?? []).includes(pk.name)}
                    onChange={(e) => set({ extraMods: e.target.checked ? [...(draft.extraMods ?? []), pk.name] : (draft.extraMods ?? []).filter((m) => m !== pk.name) })}
                  />
                ) : null}
                <button className="btn btn-secondary btn-small" onClick={() => removePack(pk)}>
                  {t("Delete")}
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </Section>

        </div>
      </div>

      <div className={`mods-apply ${dirty ? "show" : ""}`}>
        <span>{t("You have changes that aren't applied yet.")}</span>
        <button className="btn btn-secondary btn-small" disabled={busy} onClick={() => (q.data && setDraft(q.data), setGfx(gq.data?.settings ?? null))}>
          {t("Discard")}
        </button>
        <button className="btn btn-primary btn-small" disabled={busy} onClick={apply}>
          {busy ? t("Applying…") : t("Apply")}
        </button>
      </div>
    </div>
    </CatCtx.Provider>
  );
}

/** Mounts a plugin-contributed Customize tab into a DOM container. */
function PluginTabMount({ tab }: { tab: PluginCustomizeTab }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.replaceChildren();
    let cleanup: void | (() => void);
    try {
      cleanup = tab.mount(el);
    } catch (e) {
      console.error("[plugin customize tab]", e);
    }
    return () => {
      try {
        if (typeof cleanup === "function") cleanup();
      } catch {
        /* ignore */
      }
      el.replaceChildren();
    };
  }, [tab]);
  return <div className="plugin-host" ref={host} />;
}
