/** Items you've opened recently, newest first. Kept on this PC only. */
export type RecentItem = { id: number; itemType: "Asset" | "Bundle"; name: string; price: number | null };

const key = (userId: number) => `ruby.recentItems.${userId}`;
const MAX = 30;

export function recentItems(userId: number): RecentItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(userId)) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === "number").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberItem(userId: number, item: RecentItem) {
  const list = [item, ...recentItems(userId).filter((x) => !(x.id === item.id && x.itemType === item.itemType))].slice(0, MAX);
  try {
    localStorage.setItem(key(userId), JSON.stringify(list));
  } catch {
    /* history is optional */
  }
  window.dispatchEvent(new Event("ruby:recent-items"));
}

export function clearRecentItems(userId: number) {
  try {
    localStorage.removeItem(key(userId));
  } catch {
    /* nothing saved */
  }
  window.dispatchEvent(new Event("ruby:recent-items"));
}
