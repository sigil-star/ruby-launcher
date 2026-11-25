import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { call, win } from "../lib/ipc";
import { loadPlugins, usePluginPages, usePluginSettings, type PluginInfo, type PluginSettings } from "../lib/plugins";
import { useNav, useUi } from "../app/store";
import { t } from "../lib/i18n";
import { askConfirm } from "../components/Confirm";
import { Empty, ErrorState, Icon, SkeletonRows, Spinner } from "../components/ui";

/** Renders one plugin-contributed page into a plain DOM container the plugin draws into. */
export function PluginView({ pluginId, pageId }: { pluginId: string; pageId: string }) {
  const pages = usePluginPages();
  const page = pages.find((p) => p.pluginId === pluginId && p.id === pageId);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el || !page) return;
    el.replaceChildren();
    let cleanup: void | (() => void);
    try {
      cleanup = page.mount(el);
    } catch (e) {
      console.error("[plugin page]", e);
    }
    return () => {
      try {
        if (typeof cleanup === "function") cleanup();
      } catch {
        /* ignore */
      }
      el.replaceChildren();
    };
  }, [page]);
  if (!page) return <Empty icon="triangle-exclamation">{t("This plugin page isn't available.")}</Empty>;
  return (
    <div className="page plugin-page">
      <div className="plugin-host" ref={host} />
    </div>
  );
}

/** One plugin settings section, mounted into a DOM container. */
function SectionMount({ section }: { section: PluginSettings }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.replaceChildren();
    let cleanup: void | (() => void);
    try {
      cleanup = section.mount(el);
    } catch (e) {
      console.error("[plugin settings]", e);
    }
    return () => {
      try {
        if (typeof cleanup === "function") cleanup();
      } catch {
        /* ignore */
      }
      el.replaceChildren();
    };
  }, [section]);
  return (
    <div className="device-prefs plugin-settings-section">
      <h2 className="prefs-heading">{section.title}</h2>
      <div className="plugin-host" ref={host} />
    </div>
  );
}

/** All plugin-contributed settings sections (shown in Ruby Settings). */
export function PluginSettingsSections() {
  const sections = usePluginSettings();
  if (!sections.length) return null;
  return (
    <>
      {sections.map((sec) => (
        <SectionMount key={`${sec.pluginId}:${sec.id}`} section={sec} />
      ))}
    </>
  );
}

/** Manage installed plugins: turn them on or off, remove them, or open the folder to add more. */
export function Plugins() {
  const { toast } = useUi();
  const { go } = useNav();
  const q = useQuery({ queryKey: ["plugins"], queryFn: () => call<{ plugins: PluginInfo[]; dir: string }>("listPlugins") });

  const reload = async () => {
    await loadPlugins((m, k) => toast(m, k), (name) => go({ name } as never));
    q.refetch();
  };

  const toggle = async (p: PluginInfo) => {
    if (!p.enabled) {
      const ok = await askConfirm(
        t("Enable \"{name}\"? Plugins run inside Ruby with full access, so only enable ones you trust.", { name: p.name }),
      );
      if (!ok) return;
    }
    try {
      await call("setPluginEnabled", p.id, !p.enabled);
      await reload();
      toast(p.enabled ? t("Plugin turned off.") : t("Plugin turned on."));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const remove = async (p: PluginInfo) => {
    if (!(await askConfirm(t("Remove \"{name}\"? Its files are deleted from this PC.", { name: p.name })))) return;
    try {
      await call("removePlugin", p.id);
      await reload();
      toast(t("Plugin removed."));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const plugins = q.data?.plugins ?? [];

  return (
    <div className="page narrow plugins-page">
      <div className="plugins-head">
        <div>
          <h1 className="page-title">{t("Plugins")}</h1>
          <p className="muted small">{t("Add features to Ruby, or build your own. Plugins run inside Ruby, so only turn on ones you trust.")}</p>
        </div>
        <div className="plugins-actions">
          <button className="btn btn-secondary btn-small" onClick={() => call("openPluginsFolder")}>
            <Icon name="two-folders" size={16} /> {t("Open folder")}
          </button>
          <button className="btn btn-secondary btn-small" onClick={() => void reload()} disabled={q.isFetching}>
            {q.isFetching ? <Spinner size={16} /> : t("Refresh")}
          </button>
        </div>
      </div>

      {q.isLoading ? (
        <SkeletonRows count={3} />
      ) : q.error ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : plugins.length ? (
        <div className="plugin-list">
          {plugins.map((p) => (
            <div key={p.id} className={`plugin-card ${p.enabled ? "on" : ""}`}>
              <div className="plugin-meta">
                <div className="plugin-name">
                  {p.name} <span className="muted small">{p.version ? `v${p.version}` : ""}</span>
                </div>
                {p.description ? <div className="muted small">{p.description}</div> : null}
                <div className="muted tiny">
                  {p.author ? t("by {author}", { author: p.author }) : t("Unknown author")} · {p.id}
                </div>
              </div>
              <div className="plugin-card-actions">
                <button className="btn btn-ghost btn-small" onClick={() => void remove(p)} title={t("Remove")}>
                  <Icon name="x-small" size={16} />
                </button>
                <button className={`switch-btn ${p.enabled ? "on" : ""}`} role="switch" aria-checked={p.enabled} onClick={() => void toggle(p)}>
                  <span className="switch-knob" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty icon="two-folders">
          {t("No plugins yet. Click \"Open folder\", drop a plugin folder inside, then Refresh.")}
        </Empty>
      )}

      <button className="link small plugins-docs" onClick={() => void win.openExternal("https://github.com/sigil-star/ruby-launcher/blob/main/docs/PLUGINS.md")}>
        {t("How to make a plugin")}
      </button>
    </div>
  );
}
