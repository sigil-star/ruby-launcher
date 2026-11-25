/** Items bought in Ruby, newest first, so the avatar grid can show them at the top. */
const KEY = "ruby.bought";
const MAX = 60;

type Bought = { id: number; at: number };

function read(): Bought[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((b) => typeof b?.id === "number") : [];
  } catch {
    return [];
  }
}

export function noteBought(id: number) {
  try {
    localStorage.setItem(KEY, JSON.stringify([{ id, at: Date.now() }, ...read().filter((b) => b.id !== id)].slice(0, MAX)));
  } catch {
    /* ordering only */
  }
}

/** Items bought in Ruby first (newest purchase first), everything else in its original order. */
export function boughtFirst<T extends { id: number }>(items: T[]): T[] {
  const rank = new Map(read().map((b, i) => [b.id, i]));
  if (!rank.size) return items;
  const top = items.filter((x) => rank.has(x.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return top.length ? [...top, ...items.filter((x) => !rank.has(x.id))] : items;
}
