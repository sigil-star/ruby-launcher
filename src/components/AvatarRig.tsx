// @ts-nocheck — drives the BTR renderer through its untyped globals.
import { useEffect, useRef, useState } from "react";
import { myAvatar, outfitWith, previewAnimationId, userAvatar, type MyAvatar } from "../lib/api";
import { ensureBTR, loadEmoteClip } from "../lib/btr";
import { Avatar3D } from "./Avatar3D";
import { t } from "../lib/i18n";

/** Movement/emote animations aren't worn on the body; classic head/face yield to a Dynamic Head. */
const SKIP_TYPES = new Set([24, 48, 49, 50, 51, 52, 53, 54, 55, 56, 61]);
const DEFAULT_IDLE = { R15: 507766388, R6: 180435571 };
/** Roblox's classic R6 idle animations (looked-around + breathing). */
const R6_IDLES = [180435571, 180435792];
const R6_PARTS = new Set(["Torso", "Head", "Left Arm", "Right Arm", "Left Leg", "Right Leg", "HumanoidRootPart"]);

export type AvatarRigProps = {
  userId: number;
  /** True when `userId` is the signed-in user (uses their own, uncached avatar endpoint). */
  self?: boolean;
  /** Bump to reload after the avatar changed. */
  version?: number;
  /** An item to try on (rendered locally, nothing saved). Emotes play instead of being worn. */
  tryOn?: { id: number; itemType: "Asset" | "Bundle"; assetType?: number } | null;
  /** Emote to loop instead of the first equipped one (e.g. the one being previewed). */
  emoteId?: number | null;
  backdrop?: string | null;
  /** Preview as this rig without saving (e.g. R15 to show an emote on an R6 avatar). */
  rigType?: "R6" | "R15" | null;
  /** Fixed camera (profile picture editor): zoom distance, turn in degrees, and look height. */
  view?: { zoom: number; yawDeg: number; focusY: number; zoomMin?: number; zoomMax?: number; yawMin?: number; yawMax?: number } | null;
  /** Called when the person drags or scrolls the preview themselves (zoom distance, turn in degrees). */
  onViewChange?: (v: { zoom: number; yawDeg: number }) => void;
  className?: string;
};

function bodyColors(c: Record<string, string> = {}) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(c)) {
    const key = k.replace(/Color3?$/, "");
    out[key.charAt(0).toLowerCase() + key.slice(1)] = v.startsWith("#") ? v : `#${v}`;
  }
  return out;
}

async function dress(avatar: any, data: MyAvatar, assets: { id: number; type: number; meta?: unknown }[]) {
  for (const a of [...(avatar.assets ?? [])]) {
    try {
      a.remove();
    } catch {
      /* already gone */
    }
  }
  avatar.setScales(data.scales ?? { width: 1, height: 1, head: 1, depth: 1, proportion: 0, bodyType: 0 });
  avatar.wrapScales = { ...(data.scales ?? {}) };
  avatar.setBodyColors(bodyColors(data.bodyColor3s));
  avatar.setPlayerType(data.playerAvatarType ?? "R15");
  const dynamicHead = assets.find((a) => a.type === 79);
  avatar.headAssetId = dynamicHead?.id ?? assets.find((a) => a.type === 17)?.id ?? null;
  for (const a of assets) {
    if (SKIP_TYPES.has(a.type)) continue;
    if (dynamicHead && (a.type === 17 || a.type === 18)) continue;
    avatar.addAsset(a.id, a.type, a.meta ?? null);
  }
  avatar.startLoadingAssets();
  await Promise.race([avatar.waitForAppearance(), new Promise((r) => setTimeout(r, 60_000))]);
  avatar.root?.traverse?.((o: any) => {
    if (o?.isMesh || o?.isSkinnedMesh) o.frustumCulled = false;
  });
}

/**
 * The rigged, animated avatar (BTR renderer): wears the real assets and loops the first
 * equipped emote. Falls back to the static 3D snapshot if it can't load.
 */
export function AvatarRig({ userId, self = false, version = 0, tryOn, emoteId, backdrop, rigType, view, onViewChange, className = "" }: AvatarRigProps) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<any>(null);
  const track = useRef<any>(null);
  const framed = useRef(false);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [busy, setBusy] = useState(false);
  const [rawData, setData] = useState<MyAvatar | null>(null);
  // Dev-only diagnostics go to the console (what the rig played, or why it fell back).
  const setDiag = (m: string) => import.meta.env.DEV && console.info(`[AvatarRig] ${m}`);

  useEffect(() => {
    let cancelled = false;
    ensureBTR()
      .then(() => {
        if (cancelled || !host.current) return;
        const s = new (globalThis as any).RBXScene.AvatarScene({ showAstral: false, enableShadows: true });
        Object.assign(s.canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", touchAction: "none" });
        host.current.appendChild(s.canvas);
        s.start();
        scene.current = s;
        // BTR zooms on the wheel but its listener is passive, so the page would scroll too.
        // Over the avatar the wheel should only zoom (like the app's avatar viewer).
        host.current.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
        if (import.meta.env.DEV) (window as any).__rubyRig = s; // inspection hook for development only
      })
      .catch((e) => {
        if (import.meta.env.DEV) setDiag(`BTR load failed: ${e?.message ?? e}`);
        if (!cancelled) setState("failed");
      });
    return () => {
      cancelled = true;
      try {
        scene.current?.stop?.();
      } catch {
        /* ignore */
      }
      scene.current?.canvas?.remove();
      scene.current = null;
    };
  }, []);

  // Avatar data: `self` reads the signed-in user's own (always fresh) avatar.
  useEffect(() => {
    let cancelled = false;
    (self ? myAvatar() : userAvatar(userId))
      .then((d) => !cancelled && setData(d))
      .catch((e) => {
        if (import.meta.env.DEV) setDiag(`avatar data failed: ${e?.message ?? e}`);
        if (!cancelled) setState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [userId, version, self]);

  // Dress + animate whenever the avatar or the try-on changes.
  useEffect(() => {
    if (!rawData || state === "failed") return;
    const data: MyAvatar = rigType ? { ...rawData, playerAvatarType: rigType } : rawData;
    let cancelled = false;
    const wait = async () => {
      for (let i = 0; i < 100 && !scene.current; i++) await new Promise((r) => setTimeout(r, 50));
      return scene.current;
    };
    setBusy(true);
    let stage = "scene";
    (async () => {
      const s = await wait();
      if (!s || cancelled) return;
      // Animations and emotes play rather than being worn (packs: their walk/idle/etc. clip).
      const animTry = tryOn ? await previewAnimationId(tryOn) : null;
      const isEmoteTry = tryOn?.assetType === 61;
      const assets =
        tryOn && !isEmoteTry && tryOn.assetType !== 92
          ? await outfitWith(data, tryOn)
          : data.assets.map((a) => ({ id: a.id, type: a.assetType.id, meta: a.meta }));
      if (cancelled) return;
      stage = "dress";
      await dress(s.avatar, data, assets);
      if (cancelled) return;
      stage = "animate";
      // Full-body framing like the app's avatar preview (BTR defaults to a head-and-shoulders shot).
      if (s.cameraFocus) s.cameraFocus.y = 2.9;
      if (view) framed.current = true;
      if (!framed.current) {
        // Wide banners (profiles) frame closer than the tall Avatar-page preview.
        const wide = (host.current?.clientWidth ?? 0) > (host.current?.clientHeight ?? 0) * 1.6;
        s.cameraZoom = wide ? 9 : 12.5;
        framed.current = true;
      }

      // Loop an emote: the one being previewed, else the first equipped (lowest slot).
      const first = [...(data.emotes ?? [])].sort((a, b) => a.position - b.position)[0]?.assetId;
      // emoteId 0 = deliberately no emote (just the idle).
      const play = animTry ?? (emoteId === 0 ? null : (emoteId ?? first ?? null));
      const r6 = data.playerAvatarType === "R6";
      // Emotes (and animation packs) are R15-only: their joints (UpperTorso, LeftUpperArm…) don't
      // exist on an R6 rig, so on R6 only clips that animate R6 parts can play.
      const fits = (c: any) => !c || !r6 || Object.keys(c.keyframes ?? {}).some((k) => R6_PARTS.has(k));
      let clip = play ? await loadEmoteClip(play) : null;
      if (!fits(clip)) clip = null;
      // That emote didn't load (newer emotes can use an animation format the viewer can't read):
      // try their other equipped emotes in slot order before falling back to an idle.
      if (!clip && !animTry && emoteId == null) {
        const rest = [...(data.emotes ?? [])].sort((a, b) => a.position - b.position).map((e) => e.assetId).filter((id) => id !== play);
        for (const id of rest) {
          if (cancelled) return;
          const c = await loadEmoteClip(id);
          if (fits(c)) {
            clip = c;
            break;
          }
        }
      }
      if (!clip && !r6) {
        const idlePack = assets.find((a) => a.type === 51)?.id;
        clip = idlePack ? await loadEmoteClip(idlePack) : null;
      }
      for (const id of r6 ? R6_IDLES : [DEFAULT_IDLE.R15]) {
        if (clip) break;
        clip = await loadEmoteClip(id);
      }
      if (cancelled) return;
      const animator = s.avatar?.animator;
      try {
        animator?.stopAll?.(0.15);
      } catch {
        /* ignore */
      }
      if (clip && animator?.play) track.current = animator.play(clip, { loop: true, priority: 1000, fadeIn: 0.15, fadeOut: 0.15, weight: 1, speed: 1 });
      if (import.meta.env.DEV) setDiag(`${data.playerAvatarType} · play ${play ?? "-"} · clip ${clip ? `${Number(clip.length).toFixed(2)}s/${Object.keys(clip.keyframes ?? {}).length}j [${Object.keys(clip.keyframes ?? {}).slice(0, 4).join(",")}]` : "none"}`);
      setState("ready");
    })()
      .catch((e) => {
        if (import.meta.env.DEV) {
          const where = String(e?.stack ?? "").split(/\r?\n/).slice(1, 3).map((l) => l.replace(/https?:\/\/[^/]+\//g, "").trim()).join(" | ");
          setDiag(`rig failed at ${stage}: ${e?.message ?? e} @ ${where}`);
        }
        if (!cancelled) setState((st) => (st === "ready" ? st : "failed"));
      })
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [rawData, rigType, tryOn?.id, tryOn?.itemType, emoteId]); // eslint-disable-line react-hooks/exhaustive-deps

  // In the editor the camera is driven only by us: drags and scrolls are taken before the viewer
  // sees them, clamped to the editor limits and reported live, so nothing overshoots or snaps back.
  const onViewRef = useRef(onViewChange);
  onViewRef.current = onViewChange;
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const el = host.current;
    if (!el || state !== "ready" || !onViewChange) return;
    const clampZoom = (z: number) => {
      const v = viewRef.current;
      return Math.min(v?.zoomMax ?? Infinity, Math.max(v?.zoomMin ?? 0, z));
    };
    const clampYaw = (y: number) => {
      const v = viewRef.current;
      return Math.min(v?.yawMax ?? Infinity, Math.max(v?.yawMin ?? -Infinity, y));
    };
    let drag: { x: number; yaw: number; id: number } | null = null;
    const down = (e: PointerEvent) => {
      e.stopPropagation();
      const v = viewRef.current;
      if (!v || e.button !== 0) return;
      drag = { x: e.clientX, yaw: v.yawDeg, id: e.pointerId };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      e.stopPropagation();
      const v = viewRef.current;
      if (!drag || !v) return;
      // 0.4° per pixel: a full sweep of the allowed turn is ~300px.
      onViewRef.current?.({ zoom: v.zoom, yawDeg: clampYaw(drag.yaw - (e.clientX - drag.x) * 0.4) });
    };
    const up = (e: PointerEvent) => {
      e.stopPropagation();
      if (drag) el.releasePointerCapture?.(drag.id);
      drag = null;
    };
    const wheel = (e: WheelEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const v = viewRef.current;
      if (!v) return;
      onViewRef.current?.({ zoom: clampZoom(v.zoom * Math.exp(e.deltaY * 0.0015)), yawDeg: v.yawDeg });
    };
    const opts = { capture: true } as const;
    el.addEventListener("pointerdown", down, opts);
    el.addEventListener("pointermove", move, opts);
    el.addEventListener("pointerup", up, opts);
    el.addEventListener("pointercancel", up, opts);
    el.addEventListener("wheel", wheel, { capture: true, passive: false });
    return () => {
      el.removeEventListener("pointerdown", down, opts);
      el.removeEventListener("pointermove", move, opts);
      el.removeEventListener("pointerup", up, opts);
      el.removeEventListener("pointercancel", up, opts);
      el.removeEventListener("wheel", wheel, opts);
    };
  }, [state, !!onViewChange]); // eslint-disable-line react-hooks/exhaustive-deps

  // A fixed camera follows the editor's zoom / turn controls.
  useEffect(() => {
    const s = scene.current;
    if (!view || !s || state !== "ready") return;
    s.cameraZoom = view.zoom;
    if (s.cameraFocus) s.cameraFocus.y = view.focusY;
    const yaw = (view.yawDeg * Math.PI) / 180;
    s.cameraRotation.y = yaw;
    s._launcherLookTargetY = yaw;
    s.cameraRotation.x = 0.05;
    s._launcherLookTargetX = 0.05;
  }, [view?.zoom, view?.yawDeg, view?.focusY, state]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === "failed")
    return (
      <div className={`avatar-rig-fallback ${className}`} style={{ position: "relative", width: "100%", height: "100%" }}>
        <Avatar3D userId={userId} version={version} backdrop={backdrop} className={className} />
      </div>
    );

  return (
    <div
      className={`avatar-3d ${backdrop ? "has-backdrop" : ""} ${className}`}
      ref={host}
      style={backdrop ? { backgroundImage: `url("${backdrop}")` } : undefined}
    >
      {state === "loading" ? (
        <div className="avatar-3d-state">
          <div className="model-loader" aria-busy="true" aria-label={t("Loading 3D")}><span /></div>
        </div>
      ) : null}
      {busy && state === "ready" ? <div className="avatar-3d-busy" /> : null}
    </div>
  );
}
