// @ts-nocheck — BTR is plain browser JS that talks through a handful of globals.
/**
 * Loader for the BTRoblox avatar renderer (public/BTR). Unlike the OBJ snapshot from
 * thumbnails.roblox.com, BTR builds the real rigged character from Roblox's own mesh/model
 * assets, so it can play animations.
 */
import * as THREE from "three";
import { call } from "./ipc";
import { t } from "./i18n";

/** Bump when anything in public/BTR changes. */
const BTR_VERSION = "2026-11-11b";

const SCRIPTS = [
  "BTR/Misc/EventEmitter.js",
  "BTR/Misc/Constants.js",
  "BTR/Parser/ByteReader.js",
  "BTR/Parser/DracoBitstream.js",
  "BTR/Parser/MeshParser.js",
  "BTR/Parser/ModelParser.js",
  "BTR/Parser/AnimationParser.js",
  "BTR/Misc/AssetCache.js",
  "BTR/Avatar/Composites.js",
  "BTR/Avatar/Animator.js",
  "BTR/Avatar/AvatarRigs.js",
  "BTR/Avatar/Avatar.js",
  "BTR/Effects/Effects.js",
  "BTR/Misc/Scene.js",
];

type ProxyRes = { ok: boolean; status: number; headers?: Record<string, string>; data: unknown };
const proxy = (url: string, opts?: Record<string, unknown>) => call<ProxyRes>("fetchRobloxAPI", url, opts ?? null);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fnv1a(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

function installGlobals() {
  const g = globalThis as any;
  g.THREE = THREE;
  g.$ ??= {
    assert(c: boolean, m = "Assertion failed") {
      if (!c) throw new Error(m);
    },
    assert_warn(c: boolean, m = "Assertion warning") {
      if (!c) console.warn(m);
    },
    bufferToString(buffer: ArrayBuffer | Uint8Array) {
      const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
      let out = "";
      for (let i = 0; i < bytes.length; i += 4096) out += String.fromCharCode(...bytes.subarray(i, i + 4096));
      return out;
    },
    stringToBuffer(value: string) {
      const arr = new Uint8Array(value.length);
      for (let i = 0; i < value.length; i++) arr[i] = value.charCodeAt(i) & 0xff;
      return arr.buffer;
    },
    hashString: fnv1a,
    ready: (fn: () => void) => fn(),
  };
  g.loadOptionalFeature ??= () => Promise.resolve();
  g.SETTINGS ??= { get: (k: string) => k === "general.previewLayeredClothing", set: () => {} };
  g.btrLocalStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {}, keys: () => [] };
  g.BTR_HEAD_WRAP_OFFSET ??= 0.2;
  g.BTR_MAX_PIXEL_RATIO ??= 1.5;
  g.BTR_PAUSE_WHEN_UNFOCUSED ??= false;
  g.__robloxFireDataUrl ??= null;

  const json = (res: ProxyRes) => (typeof res.data === "string" ? JSON.parse(res.data || "{}") : res.data);
  g.RobloxApi ??= {
    assetdelivery: {
      // Asset locations need the session cookie, so they go through the native proxy (with 429 backoff).
      async requestAssetV2(urlParams: URLSearchParams | Record<string, string> | string, params: { format?: string; browserAssetRequest?: boolean } = {}) {
        const qp = urlParams instanceof URLSearchParams ? urlParams : new URLSearchParams(typeof urlParams === "string" ? { id: urlParams } : urlParams);
        const headers: Record<string, string> = {};
        if (params.format) headers["Roblox-AssetFormat"] = params.format;
        if (params.browserAssetRequest) headers["Roblox-Browser-Asset-Request"] = "true";
        let status = 0;
        for (let attempt = 0; attempt < 8; attempt++) {
          const res = await proxy(`https://assetdelivery.roblox.com/v2/asset/?${qp}`, { method: "GET", headers });
          status = res.status;
          if (res.ok) return json(res) ?? {};
          if (status !== 429) break;
          const retry = Number(Object.entries(res.headers ?? {}).find(([k]) => k.toLowerCase() === "retry-after")?.[1]);
          await sleep(Number.isFinite(retry) ? Math.min(Math.max(retry * 1000, 400), 15_000) : Math.min(900 * 1.45 ** attempt, 14_000));
        }
        throw new Error(`Asset request failed (${status})`);
      },
    },
    avatar: {
      async renderAvatar(body: unknown) {
        const res = await proxy("https://avatar.roblox.com/v1/avatar/render", { method: "POST", body });
        return res.ok ? json(res) : null;
      },
    },
  };
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-btr="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = false;
    s.dataset.btr = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Couldn't load ${src}`));
    document.head.appendChild(s);
  });
}

let ready: Promise<void> | null = null;

export function ensureBTR(): Promise<void> {
  ready ??= (async () => {
    installGlobals();
    const base = new URL("./", window.location.href).href;
    // Versioned so a patched BTR file is never served stale from the webview cache.
    for (const path of SCRIPTS) await loadScript(`${base}${path}?v=${BTR_VERSION}`);
    if (!(globalThis as any).RBXScene?.AvatarScene) throw new Error(t("Avatar renderer failed to load."));
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

function loadClip(id: number, timeout = 8000): Promise<any | null> {
  const AssetCache = (globalThis as any).AssetCache;
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeout);
    try {
      AssetCache.loadAnimation(id, (clip: any) => {
        clearTimeout(t);
        resolve(clip ?? null);
      });
    } catch {
      clearTimeout(t);
      resolve(null);
    }
  });
}

const usable = (clip: any) => !!clip && Number(clip.length) > 0.001 && clip.keyframes && Object.keys(clip.keyframes).length > 1;

/**
 * An emote asset (type 61) is a model holding Animation instances that point at the real
 * KeyframeSequence; follow them to the first playable clip.
 */
export async function loadEmoteClip(assetId: number): Promise<any | null> {
  const AssetCache = (globalThis as any).AssetCache;
  let model: any[] | null = null;
  try {
    model = await AssetCache.loadModel(assetId);
  } catch {
    model = null;
  }
  // Loading the container itself "succeeds" with a 1-joint stub, so follow its Animation first.
  if (!Array.isArray(model)) {
    const direct = await loadClip(assetId);
    return usable(direct) ? direct : null;
  }
  const stack = [...model];
  while (stack.length) {
    const inst = stack.pop();
    if (inst?.ClassName === "Animation" && inst.AnimationId) {
      const id = Number(AssetCache.getAssetIdFromUrl?.(inst.AnimationId) ?? String(inst.AnimationId).match(/(\d{5,})/)?.[1]);
      if (id > 0) {
        const clip = await loadClip(id);
        if (usable(clip)) return clip;
      }
    }
    if (Array.isArray(inst?.Children)) stack.push(...inst.Children);
  }
  const direct = await loadClip(assetId); // a raw KeyframeSequence asset
  return usable(direct) ? direct : null;
}

