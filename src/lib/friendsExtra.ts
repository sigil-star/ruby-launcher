import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { rbx } from "./ipc";

/*
 * Favorite friends (Ruby-only, saved on this PC per account; Roblox has no API for them) and
 * friend nicknames (Roblox's own "Alias", set with the same calls roblox.com uses).
 */

const favKey = (meId: number) => `ruby.favFriends.${meId}`;
const FAV_EVENT = "ruby-favorites";

export function loadFavorites(meId: number): Set<number> {
  try {
    return new Set((JSON.parse(localStorage.getItem(favKey(meId)) ?? "[]") as number[]).filter(Number.isFinite));
  } catch {
    return new Set();
  }
}

function saveFavorites(meId: number, s: Set<number>) {
  try {
    localStorage.setItem(favKey(meId), JSON.stringify([...s]));
  } catch {
    /* preference only */
  }
  window.dispatchEvent(new Event(FAV_EVENT));
}

/** Favorites for the signed-in account, kept in sync across components. */
export function useFavorites(meId: number | undefined) {
  const [favs, setFavs] = useState<Set<number>>(() => (meId ? loadFavorites(meId) : new Set()));
  useEffect(() => {
    if (!meId) return;
    const reload = () => setFavs(loadFavorites(meId));
    reload();
    window.addEventListener(FAV_EVENT, reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener(FAV_EVENT, reload);
      window.removeEventListener("storage", reload);
    };
  }, [meId]);
  const toggle = useCallback(
    (id: number) => {
      if (!meId) return;
      const next = loadFavorites(meId);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveFavorites(meId, next);
    },
    [meId],
  );
  return { favs, isFav: (id: number) => favs.has(id), toggle };
}

/* Nicknames */

type ProfileNames = { userId: number; names: { alias: string | null; displayName: string; username: string; combinedName: string } };

/** Nicknames you've given these people (null = none). Batched like roblox.com. */
export async function aliases(userIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (let i = 0; i < userIds.length; i += 100) {
    const chunk = userIds.slice(i, i + 100);
    const r = await rbx<{ profileDetails: ProfileNames[] }>("https://apis.roblox.com/user-profile-api/v1/user/profiles/get-profiles", {
      method: "POST",
      body: { userIds: chunk, fields: ["names.alias"] },
    }).catch(() => ({ profileDetails: [] as ProfileNames[] }));
    for (const p of r.profileDetails ?? []) if (p.names?.alias) out.set(p.userId, p.names.alias);
  }
  return out;
}

/** Set (or clear, with "") the nickname you see for someone. */
export const setAlias = (userId: number, alias: string) =>
  rbx<{ status?: string }>("https://contacts.roblox.com/v1/user/tag", { method: "POST", body: { targetUserId: userId, userTag: alias.trim() } });

export function useAlias(userId: number) {
  return useQuery({ queryKey: ["alias", userId], queryFn: () => aliases([userId]).then((m) => m.get(userId) ?? null), staleTime: 5 * 60_000 });
}

export function useAliases(userIds: number[]) {
  const key = userIds.slice().sort((a, b) => a - b).join(",");
  return useQuery({ queryKey: ["aliases", key], queryFn: () => aliases(userIds), enabled: userIds.length > 0, staleTime: 5 * 60_000 });
}

export function useSetAlias() {
  const qc = useQueryClient();
  return async (userId: number, alias: string) => {
    await setAlias(userId, alias);
    qc.setQueryData(["alias", userId], alias.trim() || null);
    qc.invalidateQueries({ queryKey: ["aliases"] });
  };
}
