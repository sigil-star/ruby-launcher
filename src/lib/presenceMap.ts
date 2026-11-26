// Who's online, in a game or in Studio, by user id. Filled from the friends list (and your own
// game session) so every avatar in Ruby can show it, e.g. for plugin frames.

import { useSyncExternalStore } from "react";

export type PresenceKind = "offline" | "online" | "ingame" | "studio";

let map = new Map<number, PresenceKind>();
const listeners = new Set<() => void>();

export function kindOf(type: number | undefined | null): PresenceKind {
  return type === 1 ? "online" : type === 2 ? "ingame" : type === 3 ? "studio" : "offline";
}

export function setPresenceMap(next: Map<number, PresenceKind>) {
  // Skip no-op updates so avatars don't re-render every poll.
  if (next.size === map.size && [...next].every(([k, v]) => map.get(k) === v)) return;
  map = next;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The known presence of a user, or undefined if Ruby doesn't know it. */
export function usePresenceKind(userId: number): PresenceKind | undefined {
  return useSyncExternalStore(subscribe, () => map.get(userId));
}
