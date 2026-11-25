import { useQuery } from "@tanstack/react-query";
import { askConfirm } from "../components/Confirm";
import { call, win } from "../lib/ipc";
import type { HostContext } from "../lib/plugins";
import { useMe, useNav, useUi } from "./store";

// Built-in, param-less pages a plugin may navigate to.
const PLUGIN_NAV = new Set(["home", "chat", "avatar", "mods", "plugins", "rubySettings", "settings", "friends", "communities", "inbox", "captures", "robux"]);

/** The capabilities Ruby hands to plugins. Deliberately small; no Roblox cookie, no raw requests. */
export function usePluginHost(): HostContext {
  const me = useMe();
  const { toast } = useUi();
  const { go } = useNav();
  const ver = useQuery({ queryKey: ["appVersion"], queryFn: () => call<string>("appVersion"), staleTime: Infinity });
  return {
    toast: (m, k) => toast(m, k),
    navigate: (name) => {
      if (PLUGIN_NAV.has(name)) go({ name } as never);
    },
    confirm: (message) => askConfirm(message),
    openExternal: (url) => void win.openExternal(url),
    user: { id: me.id, name: me.name ?? "", displayName: me.displayName ?? "" },
    version: ver.data ?? "",
  };
}
