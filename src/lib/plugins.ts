// Ruby's plugin host.
//
// Plugins are small JavaScript programs the user drops into Ruby's plugins folder. Each enabled
// plugin's code is handed to this host (fetched from Rust in `listPlugins`) and run with a single
// `ruby` object as its only entry point. Plugins render their UI into a plain DOM container, so
// they don't depend on Ruby's React version or reach into its internals.
//
// Safety: plugins run inside Ruby with Ruby's privileges, so they are OFF until the user turns
// them on, and the API below is deliberately small. It does NOT expose the Roblox session cookie
// or a raw authenticated request method. See docs/PLUGINS.md.

import { useSyncExternalStore } from "react";
import { call } from "./ipc";

export const PLUGIN_API_VERSION = 1;

export type PluginInfo = { id: string; name: string; version: string; author: string; description: string; enabled: boolean; code?: string | null };

export type PluginPage = { pluginId: string; id: string; label: string; icon?: string; mount: (container: HTMLElement) => void | (() => void) };
export type PluginSettings = { pluginId: string; id: string; title: string; mount: (container: HTMLElement) => void | (() => void) };
export type PluginCustomizeTab = { pluginId: string; id: string; label: string; icon?: string; mount: (container: HTMLElement) => void | (() => void) };

/** Public, non-sensitive bits the host hands to plugins. Never includes the Roblox cookie. */
export type PluginUser = { id: number; name: string; displayName: string };
export type HostContext = {
  toast: (m: string, kind?: "error") => void;
  navigate: (name: string) => void;
  confirm: (message: string) => Promise<boolean>;
  openExternal: (url: string) => void;
  user: PluginUser;
  version: string;
};

type RubyEvent = "navigate" | "gameLaunch" | "gameLeave";

type Registry = {
  pages: PluginPage[];
  settings: PluginSettings[];
  customizeTabs: PluginCustomizeTab[];
  events: Record<RubyEvent, Array<(payload: unknown) => void>>;
};

const registry: Registry = { pages: [], settings: [], customizeTabs: [], events: { navigate: [], gameLaunch: [], gameLeave: [] } };
const listeners = new Set<() => void>();
const emitChange = () => listeners.forEach((l) => l());

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Pages contributed by plugins (shown in the left bar). */
export function usePluginPages(): PluginPage[] {
  return useSyncExternalStore(subscribe, () => registry.pages);
}
/** Settings sections contributed by plugins (shown under Ruby Settings › Plugins). */
export function usePluginSettings(): PluginSettings[] {
  return useSyncExternalStore(subscribe, () => registry.settings);
}
/** Tabs contributed by plugins to the Customize page. */
export function usePluginCustomizeTabs(): PluginCustomizeTab[] {
  return useSyncExternalStore(subscribe, () => registry.customizeTabs);
}

/** Fire a Ruby event to plugins that subscribed. Errors in one plugin never affect the others. */
export function emitRubyEvent(event: RubyEvent, payload?: unknown) {
  for (const cb of registry.events[event]) {
    try {
      cb(payload);
    } catch (e) {
      console.error("[plugin event]", event, e);
    }
  }
}

/** The `ruby` object a single plugin receives. Everything is namespaced to that plugin. */
function makeApi(info: PluginInfo, host: HostContext) {
  const removers: Array<() => void> = [];
  const api = {
    id: info.id,
    name: info.name,
    apiVersion: PLUGIN_API_VERSION,

    /** Add a page with a button in the left bar. `mount` draws into the given element. */
    registerPage(page: { id: string; label: string; icon?: string; mount: (container: HTMLElement) => void | (() => void) }) {
      const entry: PluginPage = { pluginId: info.id, ...page };
      registry.pages.push(entry);
      removers.push(() => {
        registry.pages = registry.pages.filter((p) => p !== entry) as PluginPage[];
      });
      emitChange();
    },

    /** Add a settings section under Ruby Settings › Plugins. */
    registerSettings(section: { id: string; title: string; mount: (container: HTMLElement) => void | (() => void) }) {
      const entry: PluginSettings = { pluginId: info.id, ...section };
      registry.settings.push(entry);
      removers.push(() => {
        registry.settings = registry.settings.filter((s) => s !== entry) as PluginSettings[];
      });
      emitChange();
    },

    /** Add a tab to the Customize page. `mount` draws into the given element. */
    registerCustomizeTab(tab: { id: string; label: string; icon?: string; mount: (container: HTMLElement) => void | (() => void) }) {
      const entry: PluginCustomizeTab = { pluginId: info.id, ...tab };
      registry.customizeTabs.push(entry);
      removers.push(() => {
        registry.customizeTabs = registry.customizeTabs.filter((tt) => tt !== entry) as PluginCustomizeTab[];
      });
      emitChange();
    },

    /** Listen for a Ruby event: "navigate", "gameLaunch", "gameLeave". */
    on(event: RubyEvent, cb: (payload: unknown) => void) {
      (registry.events[event] ??= []).push(cb);
      removers.push(() => {
        registry.events[event] = registry.events[event].filter((f) => f !== cb);
      });
    },

    /** Run a function when the plugin is turned off or reloaded (tear down timers, etc.). */
    onUnload(cb: () => void) {
      removers.push(() => {
        try {
          cb();
        } catch {
          /* ignore */
        }
      });
    },

    /** Public info about the signed-in user. Never includes the Roblox session. */
    user: host.user,
    /** Ruby's version string. */
    version: host.version,

    /** Show a toast. */
    toast(message: string, kind?: "error") {
      host.toast(String(message).slice(0, 300), kind);
    },

    /** Ask the user to confirm something; resolves true/false. */
    confirm(message: string): Promise<boolean> {
      return host.confirm(String(message).slice(0, 300));
    },

    /** Open an https link in the user's browser (http/https only). */
    openExternal(url: string) {
      if (/^https?:\/\//i.test(url)) host.openExternal(url);
    },

    /** Go to one of Ruby's built-in pages by name (e.g. "home", "avatar", "chat"). */
    navigate(routeName: string) {
      host.navigate(routeName);
    },

    /** Per-plugin key/value storage (persists on this PC only). */
    storage: {
      get(key: string): string | null {
        try {
          return localStorage.getItem(`ruby.plugin.${info.id}.${key}`);
        } catch {
          return null;
        }
      },
      set(key: string, value: string) {
        try {
          localStorage.setItem(`ruby.plugin.${info.id}.${key}`, value);
        } catch {
          /* best effort */
        }
      },
    },
  };
  return { api, dispose: () => removers.forEach((r) => r()) };
}

let disposers: Array<() => void> = [];

/** Clear everything plugins registered (used before reloading them). */
export function unloadPlugins() {
  disposers.forEach((d) => d());
  disposers = [];
  registry.pages = [];
  registry.settings = [];
  registry.customizeTabs = [];
  (Object.keys(registry.events) as RubyEvent[]).forEach((k) => (registry.events[k] = []));
  emitChange();
}

/** Load and run every enabled plugin. Safe to call again; it reloads from scratch. */
export async function loadPlugins(host: HostContext) {
  unloadPlugins();
  let res: { plugins: PluginInfo[] };
  try {
    res = await call<{ plugins: PluginInfo[] }>("listPlugins");
  } catch {
    return;
  }
  for (const info of res.plugins) {
    if (!info.enabled || !info.code) continue;
    const { api, dispose } = makeApi(info, host);
    disposers.push(dispose);
    try {
      // The plugin's code runs with `ruby` as its only injected name. "use strict" keeps it tidy.
      const run = new Function("ruby", `"use strict";\n${info.code}`);
      run(api);
    } catch (e) {
      console.error(`[plugin ${info.id}]`, e);
      host.toast(`Plugin "${info.name}" failed to load.`, "error");
    }
  }
}
