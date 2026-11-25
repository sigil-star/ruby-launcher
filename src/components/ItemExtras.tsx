import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { rbx } from "../lib/ipc";
import { clearRecentItems, recentItems, type RecentItem } from "../lib/recent";
import { useMe, useNav } from "../app/store";
import { useFriends } from "../pages/Home";
import { ItemRow } from "../pages/People";
import { Headshot, Spinner } from "./ui";
import { t } from "../lib/i18n";

/** Your recently viewed items, refreshed when another item is opened. */
export function useRecentItems(): RecentItem[] {
  const me = useMe();
  const [list, setList] = useState(() => recentItems(me.id));
  useEffect(() => {
    const update = () => setList(recentItems(me.id));
    update();
    window.addEventListener("ruby:recent-items", update);
    return () => window.removeEventListener("ruby:recent-items", update);
  }, [me.id]);
  return list;
}

export function RecentlyViewed({ exclude }: { exclude?: number }) {
  const me = useMe();
  const items = useRecentItems().filter((x) => x.id !== exclude);
  if (!items.length) return null;
  return (
    <section className="shelf">
      <div className="row-between">
        <h2 className="sub-title">{t("Recently viewed")}</h2>
        <button className="link small" onClick={() => clearRecentItems(me.id)}>
          {t("Clear")}
        </button>
      </div>
      <ItemRow items={items} />
    </section>
  );
}

/**
 * Which of your friends own this item. Roblox has no single call for it, so Ruby checks each
 * friend's inventory (a few at a time); friends with a private inventory can't be checked.
 */
export function FriendsWhoOwn({ itemType, id }: { itemType: "Asset" | "Bundle"; id: number }) {
  const me = useMe();
  const { go } = useNav();
  const friends = useFriends(me.id ?? 0);
  const [start, setStart] = useState(false);
  const list = friends.data ?? [];
  const q = useQuery({
    queryKey: ["friendsWhoOwn", itemType, id, list.length],
    enabled: start && list.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const owners: typeof list = [];
      let hidden = 0;
      for (let i = 0; i < list.length; i += 6) {
        const batch = list.slice(i, i + 6);
        const res = await Promise.all(
          batch.map((f) => rbx<boolean>(`https://inventory.roblox.com/v1/users/${f.id}/items/${itemType}/${id}/is-owned`).catch(() => null)),
        );
        res.forEach((r, j) => (r === true ? owners.push(batch[j]) : r === null ? hidden++ : undefined));
      }
      return { owners, hidden };
    },
  });

  return (
    <section className="shelf friends-own">
      <div className="row-between">
        <h2 className="sub-title">{t("Friends who own this")}</h2>
        {!start ? (
          <button className="btn btn-secondary btn-small" disabled={!list.length} onClick={() => setStart(true)}>
            {list.length === 1 ? t("Check 1 friend") : t("Check {n} friends", { n: list.length })}
          </button>
        ) : null}
      </div>
      {!start ? null : q.isLoading ? (
        <div className="muted small row-gap">
          <Spinner size={16} /> {t("Checking your friends' inventories…")}
        </div>
      ) : q.data ? (
        <>
          {q.data.owners.length ? (
            <div className="friends-own-list">
              {q.data.owners.map((f) => (
                <button key={f.id} className="friends-own-item" onClick={() => go({ name: "profile", userId: f.id })} title={`@${f.name}`}>
                  <Headshot userId={f.id} size={48} />
                  <span className="small ellipsis">{f.displayName}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted small">{t("None of your friends own this.")}</p>
          )}
          {q.data.hidden ? <p className="muted tiny">{q.data.hidden === 1 ? t("1 friend couldn't be checked (a private inventory, or Roblox was busy).") : t("{n} friends couldn't be checked (a private inventory, or Roblox was busy).", { n: q.data.hidden })}</p> : null}
        </>
      ) : (
        <p className="muted small">{t("Couldn't check right now.")}</p>
      )}
    </section>
  );
}
