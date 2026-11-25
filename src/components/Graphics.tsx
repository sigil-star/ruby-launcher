import { useEffect, useState } from "react";
import { call } from "../lib/ipc";
import { rangeFill, Select } from "./ui";
import { t } from "../lib/i18n";

/*
 * Graphics FastFlags. Roblox only honours its allowlist now (Sept 2025), so every control here
 * maps to an allowlisted flag; nothing else is ever written.
 */

type G = {
  quality: number;
  textures: "auto" | "lowest" | "low" | "medium" | "high";
  msaa: number;
  api: "auto" | "d3d11" | "vulkan" | "opengl";
  noGrass: boolean;
  lowDetailMeshes: boolean;
  graySky: boolean;
  noDpiScale: boolean;
  altEnterFullscreen: boolean;
  pauseVoxelizer: boolean;
};
type Resp = { settings: G; flags: Record<string, unknown> };

const qualityNames = () => [t("Auto"), t("Potato"), t("Very low"), t("Low"), t("Low+"), t("Medium"), t("Medium+"), t("High"), t("High+"), t("Very high"), t("Ultra")];

/** Real in-game screenshots at 7 quality levels (07 = lowest … 01 = highest). */
const shot = (q: number) => {
  const step = q ? Math.round(((q - 1) / 9) * 6) : 3;
  return `${import.meta.env.BASE_URL}GraphicPreviews/0${7 - step}.png`;
};

function QualityPreview({ g }: { g: G }) {
  const src = shot(g.quality);
  const [shown, setShown] = useState([src]);
  useEffect(() => setShown((l) => (l[l.length - 1] === src ? l : [...l.slice(-1), src])), [src]);
  return (
    <div className="gfx-preview">
      {shown.map((u, i) => (
        <img key={u} src={u} alt="" className={i === shown.length - 1 ? "in" : "out"} draggable={false} />
      ))}
      <span className="gfx-preview-tag">{g.quality ? qualityNames()[g.quality] : t("Auto")}</span>
    </div>
  );
}

/** Saved graphics settings, for the Mods page to hold as part of its draft. */
export const graphicsQuery = { queryKey: ["graphicsFlags"], queryFn: () => call<Resp>("getGraphicsFlags") };
export const saveGraphics = (g: G) => call("setGraphicsFlags", g);
export type GraphicsSettings = G;

/** The graphics controls. Changes go into the Mods page's draft and apply with its Apply bar. */
export function GraphicsPanel({ g, onChange }: { g: G | null; onChange: (g: G) => void }) {
  if (!g) return null;
  const set = (p: Partial<G>) => onChange({ ...g, ...p });
  const toggle = (k: keyof G, label: string, hint: string) => (
    <label className="gfx-toggle">
      <span>
        <b>{label}</b>
        <span className="muted small">{hint}</span>
      </span>
      <input type="checkbox" className="switch" checked={!!g[k]} onChange={(e) => set({ [k]: e.target.checked } as Partial<G>)} />
    </label>
  );
  return (
    <section className="client-card mod-section gfx">
      <div className="row-between">
        <div>
          <h2 className="sub-title">{t("Graphics & performance")}</h2>
          <p className="muted small">{t("Uses only the FastFlags Roblox still allows. Takes effect the next time a game starts.")}</p>
        </div>
      </div>
      <div className="gfx-grid">
        <div className="gfx-left">
          <QualityPreview g={g} />
          <div className="gfx-slider">
            <div className="row-between">
              <b>{t("Quality")}</b>
              <span className="gfx-level">{g.quality ? `${g.quality} · ${qualityNames()[g.quality]}` : t("Auto (Roblox decides)")}</span>
            </div>
            <input type="range" min={0} max={10} step={1} value={g.quality} style={rangeFill(g.quality, 0, 10)} onChange={(e) => set({ quality: Number(e.target.value) })} aria-label={t("Quality level")} />
            <div className="gfx-ticks muted tiny">
              <span>{t("Auto")}</span>
              <span>{t("Faster")}</span>
              <span>{t("Prettier")}</span>
            </div>
          </div>
        </div>
        <div className="gfx-right">
          <label className="gfx-field">
            <span>{t("Texture quality")}</span>
            <Select value={g.textures} onChange={(v) => set({ textures: v })} options={[{ value: "auto", label: t("Automatic") }, { value: "lowest", label: t("Lowest") }, { value: "low", label: t("Low") }, { value: "medium", label: t("Medium") }, { value: "high", label: t("High") }]} />
          </label>
          <label className="gfx-field">
            <span>{t("Anti-aliasing")}</span>
            <Select value={String(g.msaa) as "0"} onChange={(v) => set({ msaa: Number(v) })} options={[{ value: "0", label: t("Automatic") }, { value: "1", label: t("Off") }, { value: "2", label: "2×" }, { value: "4", label: "4×" }, { value: "8", label: "8×" }]} />
          </label>
          <label className="gfx-field">
            <span>{t("Graphics API")}</span>
            <Select value={g.api} onChange={(v) => set({ api: v })} options={[{ value: "auto", label: t("Automatic") }, { value: "d3d11", label: "Direct3D 11" }, { value: "vulkan", label: "Vulkan" }, { value: "opengl", label: "OpenGL" }]} />
          </label>
          {toggle("noGrass", t("No grass"), t("Removes terrain grass. Big FPS win on grassy maps."))}
          {toggle("lowDetailMeshes", t("Low-detail meshes"), t("Unions and meshes always use their simplest version."))}
          {toggle("pauseVoxelizer", t("Freeze lighting updates"), t("Stops lighting recalculating as things move. Faster, can look off."))}
          {toggle("graySky", t("Gray sky"), t("Plain gray sky instead of the skybox."))}
          {toggle("noDpiScale", t("Ignore Windows scaling"), t("Sharper UI on high-DPI screens (it gets smaller)."))}
          {toggle("altEnterFullscreen", t("Alt+Enter fullscreen"), t("Alt+Enter switches to exclusive fullscreen."))}
        </div>
      </div>
    </section>
  );
}
