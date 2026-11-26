import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { call, win } from "../lib/ipc";
import { loadPlugins, usePluginPages, usePluginSettings, type PluginInfo, type PluginSettings } from "../lib/plugins";
import { useUi } from "../app/store";
import { usePluginHost } from "../app/pluginHost";
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

const SUBMIT_URL = "https://github.com/sigil-star/ruby-plugins#submit-a-plugin";
const DOCS_URL = "https://github.com/sigil-star/ruby-launcher/blob/main/docs/PLUGINS.md";

type FeaturedPlugin = {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  featured: boolean;
  installed: boolean;
  installedVersion?: string | null;
  installedReviewed: boolean;
  iconUrl?: string | null;
};

/** A plugin's icon, or a puzzle piece when it has none. */
function PluginIcon({ src }: { src?: string | null }) {
  return <span className="plugin-icon">{src ? <img src={src} alt="" draggable={false} /> : <Icon name="puzzle" size={26} />}</span>;
}

/** Manage installed plugins: turn them on or off, remove them, or open the folder to add more. */
export function Plugins() {
  const { toast } = useUi();
  const host = usePluginHost();
  const fileRef = useRef<HTMLInputElement>(null);
  const [installing, setInstalling] = useState(false);
  const [tab, setTab] = useState<"featured" | "installed">("featured");
  const q = useQuery({ queryKey: ["plugins"], queryFn: () => call<{ plugins: PluginInfo[]; dir: string }>("listPlugins") });

  const reload = async () => {
    await loadPlugins(host);
    q.refetch();
  };

  const install = async (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (!files.length) return;
    setInstalling(true);
    try {
      const payload = await Promise.all(
        files.map(async (f) => {
          // Keep the folder-relative path when the browser gives one (webkitdirectory).
          const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
          const buf = new Uint8Array(await f.arrayBuffer());
          let bin = "";
          for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
          return [rel, btoa(bin)];
        }),
      );
      await call("installPluginFiles", payload);
      await reload();
      toast(t("Plugin installed. Turn it on below."));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setInstalling(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const toggle = async (p: PluginInfo) => {
    if (!p.enabled) {
      const ok = await askConfirm(
        p.source === "featured"
          ? t("Enable \"{name}\"? Plugins run inside Ruby with full access, so only enable ones you trust.", { name: p.name })
          : t("\"{name}\" hasn't been reviewed by Ruby. Plugins run with full access, so only enable it if you trust whoever made it.", { name: p.name }),
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
  const reg = useQuery({
    queryKey: ["pluginRegistry"],
    queryFn: () => call<{ plugins: FeaturedPlugin[]; error?: string }>("pluginRegistry"),
    staleTime: 5 * 60_000,
    enabled: tab === "featured",
  });
  const [busyId, setBusyId] = useState<string | null>(null);

  const installFeatured = async (p: FeaturedPlugin) => {
    setBusyId(p.id);
    try {
      await call("installFeaturedPlugin", p.id);
      await reload();
      await reg.refetch();
      toast(p.installed ? t("Updated {name}.", { name: p.name }) : t("Installed {name}. Turn it on under Installed.", { name: p.name }));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusyId(null);
    }
  };

  const featured = reg.data?.plugins ?? [];

  return (
    <div className="page narrow plugins-page">
      <div className="plugins-head">
        <div>
          <h1 className="page-title">{t("Plugins")}</h1>
          <p className="muted small">{t("Add features to Ruby, or build your own. Plugins run inside Ruby, so only turn on ones you trust.")}</p>
        </div>
        <div className="plugins-actions">
          <button className="btn btn-secondary btn-small" onClick={() => void win.openExternal(SUBMIT_URL)}>
            {t("Submit a plugin")}
          </button>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === "featured" ? "active" : ""} onClick={() => setTab("featured")}>
          {t("Featured")}
        </button>
        <button className={tab === "installed" ? "active" : ""} onClick={() => setTab("installed")}>
          {t("Installed")} {plugins.length ? <span className="muted">({plugins.length})</span> : null}
        </button>
      </div>

      {tab === "featured" ? (
        <>
          <p className="muted small plugins-note">
            <Icon name="check" size={14} /> {t("Every featured plugin was reviewed before it was listed. Ruby checks each file against the signed list before installing it.")}
          </p>
          {reg.isLoading ? (
            <SkeletonRows count={3} />
          ) : reg.error ? (
            <ErrorState error={reg.error} retry={() => reg.refetch()} />
          ) : reg.data?.error ? (
            <Empty icon="triangle-exclamation">{reg.data.error}</Empty>
          ) : featured.length ? (
            <div className="plugin-list">
              {featured.map((p) => {
                const upToDate = p.installed && p.installedReviewed && p.installedVersion === p.version;
                const label = upToDate ? t("Installed") : p.installed && p.installedReviewed ? t("Update") : p.installed ? t("Replace with reviewed") : t("Install");
                return (
                  <div key={p.id} className={`plugin-card ${p.featured ? "featured" : ""}`}>
                    <PluginIcon src={p.iconUrl} />
                    <div className="plugin-meta">
                      <div className="plugin-name">
                        {p.name} <span className="muted small">{p.version ? `v${p.version}` : ""}</span>
                        <span className="plugin-badge reviewed">{t("Reviewed")}</span>
                        {p.featured ? <span className="plugin-badge">{t("Featured")}</span> : null}
                      </div>
                      {p.description ? <div className="muted small">{p.description}</div> : null}
                      <div className="muted tiny">{p.author ? t("by {author}", { author: p.author }) : t("Unknown author")}</div>
                    </div>
                    <div className="plugin-card-actions">
                      <button className={`btn btn-small ${upToDate ? "btn-secondary" : "btn-primary"}`} disabled={upToDate || busyId === p.id} onClick={() => void installFeatured(p)}>
                        {busyId === p.id ? <Spinner size={16} /> : label}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty icon="star">{t("No featured plugins yet. Check back soon, or submit your own.")}</Empty>
          )}
        </>
      ) : (
        <>
          <div className="plugins-actions installed-actions">
            <button className="btn btn-primary btn-small" onClick={() => fileRef.current?.click()} disabled={installing}>
              {installing ? <Spinner size={16} /> : <><Icon name="plus-small" size={16} /> {t("Install from folder")}</>}
              <input
                ref={fileRef}
                type="file"
                hidden
                // @ts-expect-error non-standard folder-select attributes
                webkitdirectory=""
                directory=""
                multiple
                onChange={(e) => void install(e.target.files)}
              />
            </button>
            <button className="btn btn-secondary btn-small" onClick={() => call("openPluginsFolder")}>
              <Icon name="two-folders" size={16} /> {t("Open folder")}
            </button>
            <button className="btn btn-secondary btn-small" onClick={() => void reload()} disabled={q.isFetching}>
              {q.isFetching ? <Spinner size={16} /> : t("Refresh")}
            </button>
          </div>
          {q.isLoading ? (
            <SkeletonRows count={3} />
          ) : q.error ? (
            <ErrorState error={q.error} retry={() => q.refetch()} />
          ) : plugins.length ? (
            <div className="plugin-list">
              {plugins.map((p) => (
                <div key={p.id} className={`plugin-card ${p.enabled ? "on" : ""}`}>
                  <PluginIcon src={p.icon} />
                  <div className="plugin-meta">
                    <div className="plugin-name">
                      {p.name} <span className="muted small">{p.version ? `v${p.version}` : ""}</span>
                      {p.source === "featured" ? (
                        <span className="plugin-badge reviewed">{t("Reviewed")}</span>
                      ) : (
                        <span className="plugin-badge local">{t("Not reviewed")}</span>
                      )}
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
            <Empty icon="two-folders">{t("No plugins installed yet. Pick one from Featured, or install your own from a folder.")}</Empty>
          )}
        </>
      )}

      <button className="link small plugins-docs" onClick={() => void win.openExternal(DOCS_URL)}>
        {t("How to make a plugin")}
      </button>
    </div>
  );
}
