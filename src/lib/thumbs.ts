import { useEffect, useState } from "react";
import { rbx } from "./ipc";

/**
 * Thumbnail batcher. Components ask for one image; requests made in the same
 * tick are coalesced into a single thumbnails.roblox.com/v1/batch call.
 */
export type ThumbType =
  | "AvatarHeadShot"
  | "Avatar"
  | "GameIcon"
  | "Asset"
  | "BundleThumbnail"
  | "GroupIcon"
  | "GamePass"
  | "Outfit"
  | "BadgeIcon"
  | "PlaceIcon";

const DEFAULT_SIZE: Record<ThumbType, string> = {
  AvatarHeadShot: "150x150",
  BadgeIcon: "150x150",
  Avatar: "420x420",
  GameIcon: "256x256",
  Asset: "150x150",
  BundleThumbnail: "150x150",
  GroupIcon: "150x150",
  GamePass: "150x150",
  Outfit: "150x150",
  PlaceIcon: "150x150",
};

const cache = new Map<string, string | null>();
const listeners = new Map<string, Set<(url: string | null) => void>>();
let queue: { key: string; type: ThumbType; id: number; size: string }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function publish(key: string, url: string | null) {
  cache.set(key, url);
  listeners.get(key)?.forEach((fn) => fn(url));
}

async function flush() {
  timer = null;
  const batch = queue.splice(0, queue.length);
  for (let i = 0; i < batch.length; i += 100) {
    const chunk = batch.slice(i, i + 100);
    try {
      const res = await rbx<{ data: { requestId: string; state: string; imageUrl: string | null }[] }>(
        "https://thumbnails.roblox.com/v1/batch",
        {
          method: "POST",
          body: chunk.map((r) => ({
            requestId: r.key,
            type: r.type,
            targetId: r.id,
            size: r.size,
            format: "Png",
            isCircular: false,
            // Profile frames (Roblox Plus) are drawn onto headshots, as on roblox.com.
            ...(r.type === "AvatarHeadShot" ? { includeProfileFrame: true } : {}),
          })),
        },
      );
      for (const row of res.data ?? []) {
        if (row.state === "Pending") {
          const req = chunk.find((c) => c.key === row.requestId);
          if (req) setTimeout(() => enqueue(req.type, req.id, req.size, true), 2500);
          continue;
        }
        publish(row.requestId, row.imageUrl ?? null);
      }
    } catch {
      chunk.forEach((r) => publish(r.key, null));
    }
  }
}

function enqueue(type: ThumbType, id: number, size: string, force = false) {
  const key = `${type}:${id}:${size}`;
  if (!force && (cache.has(key) || queue.some((q) => q.key === key))) return key;
  queue.push({ key, type, id, size });
  if (!timer) timer = setTimeout(flush, 16);
  return key;
}

export function useThumb(type: ThumbType, id: number | undefined | null, size?: string): string | null {
  const sz = size ?? DEFAULT_SIZE[type];
  const key = id ? `${type}:${id}:${sz}` : "";
  const [url, setUrl] = useState<string | null>(() => (key ? cache.get(key) ?? null : null));

  useEffect(() => {
    if (!id) return;
    setUrl(cache.get(key) ?? null);
    const set = listeners.get(key) ?? new Set();
    set.add(setUrl);
    listeners.set(key, set);
    if (!cache.has(key)) enqueue(type, id, sz);
    return () => {
      set.delete(setUrl);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return url;
}

/** Force a fresh render of an avatar (after changing what's worn). */
export function invalidateAvatar(userId: number) {
  for (const k of [...cache.keys()]) {
    if (k.startsWith(`Avatar:${userId}:`) || k.startsWith(`AvatarHeadShot:${userId}:`)) {
      cache.delete(k);
      const [type, id, size] = k.split(":");
      enqueue(type as ThumbType, Number(id), size, true);
    }
  }
}

/* Wide game thumbnails come from a different endpoint. */
const wideCache = new Map<number, string | null>();
const wideListeners = new Map<number, Set<(u: string | null) => void>>();
let wideQueue: number[] = [];
let wideTimer: ReturnType<typeof setTimeout> | null = null;

async function flushWide() {
  wideTimer = null;
  const ids = [...new Set(wideQueue.splice(0, wideQueue.length))];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      const res = await rbx<{ data: { universeId: number; thumbnails: { imageUrl: string }[] }[] }>(
        `https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${chunk.join(",")}&countPerUniverse=1&defaults=true&size=768x432&format=Png&isCircular=false`,
      );
      for (const row of res.data ?? []) {
        const u = row.thumbnails?.[0]?.imageUrl ?? null;
        wideCache.set(row.universeId, u);
        wideListeners.get(row.universeId)?.forEach((fn) => fn(u));
      }
    } catch {
      /* leave blank */
    }
  }
}

export function useGameThumb(universeId: number | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (universeId ? wideCache.get(universeId) ?? null : null));
  useEffect(() => {
    if (!universeId) return;
    setUrl(wideCache.get(universeId) ?? null);
    const set = wideListeners.get(universeId) ?? new Set();
    set.add(setUrl);
    wideListeners.set(universeId, set);
    if (!wideCache.has(universeId)) {
      wideQueue.push(universeId);
      if (!wideTimer) wideTimer = setTimeout(flushWide, 16);
    }
    return () => {
      set.delete(setUrl);
    };
  }, [universeId]);
  return url;
}
