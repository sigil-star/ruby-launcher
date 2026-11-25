import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { unreadNotifications } from "../lib/api";
import { call, on } from "../lib/ipc";
import { useFriends } from "../pages/Home";
import { useMe, useNav } from "./store";

/** Keeps the tray menu's account, friends-online and notification lines current, and opens
 *  the right page when one of them is clicked. Uses the same queries the screens already run. */
export function TrayStatus() {
  const me = useMe();
  const { go } = useNav();
  const friends = useFriends(me.id ?? 0);
  const { data: notifications } = useQuery({ queryKey: ["notifUnread"], queryFn: unreadNotifications, refetchInterval: 45_000 });

  const list = friends.data;
  const online = list ? list.filter((f) => (f.presence?.userPresenceType ?? 0) >= 1).length : undefined;
  const inGame = list ? list.filter((f) => f.presence?.userPresenceType === 2).length : undefined;

  useEffect(() => {
    void call("trayStatus", { displayName: me.displayName, name: me.name, online, inGame, notifications }).catch(() => {});
  }, [me.displayName, me.name, online, inGame, notifications]);

  useEffect(() => {
    const un = on<string>("ruby-tray", (target) => {
      if (target === "friends") go({ name: "friends" });
      if (target === "notifications") window.dispatchEvent(new Event("ruby:open-notifications"));
    });
    return () => void un.then((f) => f());
  }, [go]);

  // Signed out (or switching accounts): the tray shouldn't keep showing the old account.
  useEffect(() => () => void call("trayStatus", {}).catch(() => {}), []);
  return null;
}
