import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { avatarRules, setAvatarType, setBodyColors, setScales, type BodyPart, type MyAvatar, type Scales } from "../lib/api";
import { Icon, rangeFill, Thumb } from "./ui";
import { t } from "../lib/i18n";

/** One tile in a Customize tab's slot bar, like the Roblox app's. */
export type Slot = {
  key: string;
  /** Translated at render time. */
  label: () => string;
  /** Asset types this slot shows. Empty for panels (Build, Skin). */
  types: number[];
  panel?: "build" | "skin";
};

export const BODY_PARTS: { label: () => string; type: number }[] = [
  { label: () => t("Torso"), type: 27 },
  { label: () => t("Right Arm"), type: 28 },
  { label: () => t("Left Arm"), type: 29 },
  { label: () => t("Left Leg"), type: 30 },
  { label: () => t("Right Leg"), type: 31 },
];

export const SLOTS: Record<string, Slot[]> = {
  Body: [
    { key: "full", label: () => t("Full Body"), types: [27, 28, 29, 30, 31] },
    { key: "hair", label: () => t("Hair"), types: [41] },
    { key: "head", label: () => t("Head"), types: [17, 79, 18] },
    { key: "build", label: () => t("Build"), types: [], panel: "build" },
    { key: "skin", label: () => t("Skin"), types: [], panel: "skin" },
  ],
  Clothing: [
    { key: "top", label: () => t("Top"), types: [64, 65] },
    { key: "outer", label: () => t("Outerwear"), types: [67, 68] },
    { key: "bottom", label: () => t("Bottom"), types: [66, 69, 72] },
    { key: "shoes", label: () => t("Shoes"), types: [70, 71] },
    { key: "shirt", label: () => t("Shirt Classic"), types: [11] },
    { key: "pants", label: () => t("Pants Classic"), types: [12] },
    { key: "tshirt", label: () => t("T-Shirt Classic"), types: [2] },
  ],
  Accessories: [
    { key: "head", label: () => t("Head"), types: [8] },
    { key: "face", label: () => t("Face"), types: [42] },
    { key: "neck", label: () => t("Neck"), types: [43] },
    { key: "back", label: () => t("Back"), types: [46] },
    { key: "waist", label: () => t("Waist"), types: [47] },
    { key: "shoulder", label: () => t("Shoulder"), types: [44] },
    { key: "front", label: () => t("Front"), types: [45] },
    { key: "gear", label: () => t("Gear"), types: [19] },
  ],
  Animations: [
    { key: "all", label: () => t("Full Set"), types: [51, 55, 53, 52, 50, 48, 54] },
    { key: "idle", label: () => t("Idle"), types: [51] },
    { key: "walk", label: () => t("Walk"), types: [55] },
    { key: "run", label: () => t("Run"), types: [53] },
    { key: "jump", label: () => t("Jump"), types: [52] },
    { key: "fall", label: () => t("Fall"), types: [50] },
    { key: "climb", label: () => t("Climb"), types: [48] },
    { key: "swim", label: () => t("Swim"), types: [54] },
  ],
};

/** Makeup filters under the layer tiles. */
export const MAKEUP_FILTERS: { label: () => string; types: number[] }[] = [
  { label: () => t("Looks"), types: [88, 89, 90, 76, 77] },
  { label: () => t("Eyes"), types: [90] },
  { label: () => t("Lips"), types: [89] },
  { label: () => t("Face"), types: [88] },
  { label: () => t("Eyelashes"), types: [76] },
  { label: () => t("Eyebrows"), types: [77] },
];
export const MAKEUP_LAYER_TYPES = [88, 89, 90];

/** The row of slot tiles: each shows what's worn there, or a plus when it's empty. */
export function SlotBar({
  slots,
  active,
  onPick,
  wornOf,
  onClear,
}: {
  slots: Slot[];
  active: string;
  onPick: (key: string) => void;
  wornOf: (types: number[]) => number | undefined;
  onClear?: () => void;
}) {
  return (
    <div className="slot-bar hscroll">
      {slots.map((s) => {
        const worn = s.types.length ? wornOf(s.types) : undefined;
        return (
          <button key={s.key} className={`slot-tile ${active === s.key ? "on" : ""}`} onClick={() => onPick(s.key)}>
            <span className="slot-art">
              {worn ? (
                <Thumb type="Asset" id={worn} className="square" />
              ) : s.panel === "build" ? (
                <Icon name="two-arrows-from-center" size={22} />
              ) : s.panel === "skin" ? (
                <span className="slot-skin" />
              ) : (
                <Icon name="plus-small" size={22} />
              )}
            </span>
            <span className="slot-label">{s.label()}</span>
          </button>
        );
      })}
      {onClear ? (
        <button className="slot-tile" onClick={onClear} title={t("Take off everything in this tab")}>
          <span className="slot-art">
            <Icon name="arrow-spin-clockwise" size={22} />
          </span>
          <span className="slot-label">{t("Clear")}</span>
        </button>
      ) : null}
    </div>
  );
}

const SCALE_ROWS: { key: keyof Scales; label: () => string; hint?: () => [string, string] }[] = [
  { key: "bodyType", label: () => t("Body Type"), hint: () => [t("Blocky"), t("Realistic")] },
  { key: "proportion", label: () => t("Proportions"), hint: () => [t("Standard"), t("Slender")] },
  { key: "height", label: () => t("Height"), hint: () => [t("Short"), t("Tall")] },
  { key: "width", label: () => t("Width"), hint: () => [t("Narrow"), t("Wide")] },
  { key: "head", label: () => t("Head Size"), hint: () => [t("Small"), t("Large")] },
];

/** Body scales and R6/R15. Saved when you let go of a slider. */
export function BuildPanel({ avatar, onSaved, onError }: { avatar: MyAvatar | undefined; onSaved: () => void; onError: (e: unknown) => void }) {
  const rules = useQuery({ queryKey: ["avatarRules"], queryFn: avatarRules, staleTime: 60 * 60_000 });
  const [scales, setLocal] = useState<Scales | null>(null);
  useEffect(() => {
    if (avatar?.scales) setLocal({ height: 1, width: 1, head: 1, depth: 1, proportion: 0, bodyType: 0, ...avatar.scales } as Scales);
  }, [avatar?.scales]);
  const save = async (next: Scales) => {
    try {
      await setScales(next);
      onSaved();
    } catch (e) {
      onError(e);
    }
  };
  const r15 = avatar?.playerAvatarType !== "R6";
  return (
    <div className="build-panel">
      {scales
        ? SCALE_ROWS.map((row) => {
            const rule = rules.data?.scales[row.key] ?? { min: 0, max: 1, increment: 0.01 };
            return (
              <label key={row.key} className={`build-row ${r15 ? "" : "disabled"}`}>
                <span className="build-label">{row.label()}</span>
                <input
                  type="range"
                  min={rule.min}
                  max={rule.max}
                  step={rule.increment || 0.01}
                  value={scales[row.key]}
                  style={rangeFill(scales[row.key], rule.min, rule.max)}
                  disabled={!r15}
                  onChange={(e) => setLocal({ ...scales, [row.key]: Number(e.target.value), ...(row.key === "width" ? { depth: Number(e.target.value) } : {}) })}
                  onPointerUp={() => void save(scales)}
                  onKeyUp={() => void save(scales)}
                />
                {row.hint ? (
                  <span className="build-hint muted tiny">
                    <span>{row.hint()[0]}</span>
                    <span>{row.hint()[1]}</span>
                  </span>
                ) : null}
              </label>
            );
          })
        : null}
      {!r15 ? <p className="muted small">{t("Body scales only apply to R15 avatars.")}</p> : null}
      <div className="build-row">
        <span className="build-label">R6/R15</span>
        <div className="segmented small">
          {(["R6", "R15"] as const).map((rig) => (
            <button
              key={rig}
              className={(avatar?.playerAvatarType ?? "R15") === rig ? "active" : ""}
              onClick={async () => {
                try {
                  await setAvatarType(rig);
                  onSaved();
                } catch (e) {
                  onError(e);
                }
              }}
            >
              {rig}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const PARTS: { key: BodyPart | "all"; label: () => string }[] = [
  { key: "all", label: () => t("All") },
  { key: "head", label: () => t("Head") },
  { key: "torso", label: () => t("Torso") },
  { key: "leftArm", label: () => t("Left Arm") },
  { key: "rightArm", label: () => t("Right Arm") },
  { key: "leftLeg", label: () => t("Left Leg") },
  { key: "rightLeg", label: () => t("Right Leg") },
];
const ALL_PARTS: BodyPart[] = ["head", "torso", "leftArm", "rightArm", "leftLeg", "rightLeg"];

/** Skin colours: Roblox's palette, per body part, plus any colour in Advanced. */
export function SkinPanel({ avatar, onSaved, onError }: { avatar: MyAvatar | undefined; onSaved: () => void; onError: (e: unknown) => void }) {
  const rules = useQuery({ queryKey: ["avatarRules"], queryFn: avatarRules, staleTime: 60 * 60_000 });
  const [advanced, setAdvanced] = useState(false);
  const [part, setPart] = useState<BodyPart | "all">("all");
  const [picking, setPicking] = useState<string | null>(null);
  const current = (p: BodyPart) => (avatar?.bodyColor3s?.[`${p}Color3`] ?? "").replace("#", "").toUpperCase();
  const shown = part === "all" ? current("torso") : current(part);
  const apply = async (hex: string) => {
    const parts = part === "all" ? ALL_PARTS : [part];
    try {
      await setBodyColors(Object.fromEntries(parts.map((p) => [p, hex])));
      onSaved();
    } catch (e) {
      onError(e);
    }
  };
  const palette = (advanced ? rules.data?.all : rules.data?.basic) ?? [];
  return (
    <div className={`skin-panel ${advanced ? "advanced" : ""}`}>
      {advanced ? (
        <div className="skin-parts" role="radiogroup" aria-label={t("Body part")}>
          {PARTS.map((p) => (
            <label key={p.key} className="radio-row">
              <input type="radio" name="skin-part" checked={part === p.key} onChange={() => setPart(p.key)} />
              {p.label()}
            </label>
          ))}
        </div>
      ) : null}
      <div className="skin-main">
        <div className="skin-swatches">
          {palette.map((c) => {
            const hex = c.hexColor.replace("#", "").toUpperCase();
            const on = hex === shown;
            return (
              <button key={c.hexColor + c.name} className={`skin-swatch ${on ? "on" : ""}`} style={{ background: c.hexColor }} title={c.name} onClick={() => void apply(hex)}>
                {on ? <Icon name="check" size={16} /> : null}
              </button>
            );
          })}
        </div>
        <div className="skin-foot">
          <label className="skin-custom" title={t("Any colour")}>
            <input
              type="color"
              value={picking ?? `#${shown || "A3A2A5"}`}
              onChange={(e) => setPicking(e.target.value)}
              onBlur={() => {
                if (picking) void apply(picking.slice(1).toUpperCase());
                setPicking(null);
              }}
            />
            <span className="small">{t("Custom colour")}</span>
          </label>
          <button className="link small" onClick={() => (setAdvanced((v) => !v), setPart("all"))}>
            {advanced ? t("Standard") : t("Advanced")}
          </button>
        </div>
      </div>
    </div>
  );
}
