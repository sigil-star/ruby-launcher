import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { chatThreads } from "../lib/api";
import { useMe, useNav } from "./store";

const newest = (times: string[]) => times.reduce((a, b) => (b > a ? b : a), "");

/**
 * True when a chat has an unread message you haven't seen yet. Opening Chat counts as seeing
 * them, so the dot clears straight away even before each conversation is read.
 */
export function useChatDot() {
  const me = useMe();
  const { route } = useNav();
  const key = `ruby.chatSeen.${me.id ?? 0}`;
  const chats = useQuery({ queryKey: ["notifyChats"], queryFn: () => chatThreads(), refetchInterval: 30_000, enabled: !!me.id, retry: false });
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  });
  const list = chats.data?.conversations ?? [];
  const onChat = route.name === "chat";

  useEffect(() => {
    if (!onChat) return;
    const latest = newest(list.map((c) => c.lastMessageAt ?? ""));
    if (latest && latest > seen) {
      setSeen(latest);
      try {
        localStorage.setItem(key, latest);
      } catch {
        /* the dot just shows again next launch */
      }
    }
  }, [onChat, list, seen, key]);

  return !onChat && list.some((c) => c.unreadCount > 0 && (c.lastMessageAt ?? "") > seen);
}
