import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { call, on, win } from "../lib/ipc";
import { useNav, useUi } from "../app/store";
import { ErrorState, Icon, Select, Skel } from "../components/ui";
import { t, fmtDate as fmtD } from "../lib/i18n";

type Ver = { guid: string; version: string } | null;
type Installed = { guid: string; path: string; modified: number };
type ClientInfo = {
  player: { current: Ver; upToDate: boolean; installed: Installed[] };
  studio: { current: Ver; upToDate: boolean; installed: Installed[] };
  weblauncher: {
    found: boolean;
    appVersion?: string;
    exploitSync?: string;
    channel?: string;
    pinnedVersion?: string;
    playerPath?: string | null;
    multiInstance?: boolean;
  };
  source: string;
  versionsDir?: string;
};

const fmtDate = (s: number) => (s ? fmtD(new Date(s * 1000), { month: "short", day: "numeric", year: "numeric" }) : "");

/** Everything about the Roblox install Ruby launches: versions, updates, and weblauncher sync. */
export function ClientPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { go } = useNav();
  const { toast } = useUi();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["robloxClientInfo"], queryFn: () => call<ClientInfo>("getRobloxClientInfo"), refetchInterval: 60_000 });
  const [progress, setProgress] = useState<{ done: number; total: number; detail: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const un = on<{ stage: string; done: number; total: number; detail: string }>("roblox-install-progress", (p) =>
      setProgress(p.stage === "done" ? null : p),
    );
    return () => {
      un.then((f) => f());
    };
  }, []);

  const update = async () => {
    setBusy(true);
    try {
      await call("updateRobloxPlayer");
      toast(t("Roblox is up to date."));
      qc.invalidateQueries({ queryKey: ["robloxClientInfo"] });
    } catch (e) {
      toast(t("Update failed: {error}", { error: String((e as Error).message ?? e) }), "error");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };
  const [custom, setCustom] = useState("");
  const setSource = async (source: string) => {
    try {
      await call("setClientSource", source);
      qc.setQueryData<ClientInfo>(["robloxClientInfo"], (d) => (d ? { ...d, source } : d));
      toast(
        source === "roblox"
          ? t("Ruby will launch the latest Roblox.")
          : source === "weblauncher"
            ? t("Ruby will launch weblauncher's Roblox build.")
            : t("Ruby will launch {version}. It's installed the first time you play if it isn't here yet.", { version: source.slice(8) }),
      );
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  if (q.isLoading)
    return (
      <div className="page narrow client-page">
        <Skel w="40%" h={30} />
        <Skel h={160} r={14} />
        <Skel h={120} r={14} />
      </div>
    );
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const wl = d.weblauncher;

  const latest = d.player.current;
  const installedNow = d.player.installed.find((v) => v.guid === latest?.guid);
  const older = d.player.installed.filter((v) => v.guid !== latest?.guid);

  return (
    <div className={embedded ? "client-page embedded" : "page client-page"}>
      <div className="client-top">
        <div>
          {embedded ? <h2 className="prefs-heading">{t("Roblox Client")}</h2> : <h1 className="page-title">{t("Roblox Client")}</h1>}
          <p className="muted small">{t("The Roblox Ruby launches: version, updates and which build is used.")}</p>
        </div>
        <button className="btn btn-secondary btn-small" onClick={() => q.refetch()} disabled={q.isFetching}>
          <Icon name="arrow-spin-clockwise" size={16} /> {q.isFetching ? t("Checking…") : t("Check for updates")}
        </button>
      </div>

      <section className={`client-hero ${d.player.upToDate ? "ok" : "warn"}`}>
        <div className="client-hero-icon">
          <Icon name={d.player.upToDate ? "check" : "arrow-small-down"} size={28} />
        </div>
        <div className="client-hero-text">
          <h2>{d.player.upToDate ? t("Roblox is up to date") : d.player.installed.length ? t("An update is available") : t("Roblox isn't installed")}</h2>
          <span className="muted small">
            {t("Roblox Player {version}", { version: latest?.version ?? "—" })}
            {installedNow ? ` · ${t("installed {date}", { date: fmtDate(installedNow.modified) })}` : ""}
          </span>
          {progress ? (
            <div className="client-progress">
              <div className="launch-progress">
                <span style={{ width: `${pct}%` }} />
              </div>
              <span className="muted small">
                {t("Installing… {pct}%", { pct })} · {progress.detail}
              </span>
            </div>
          ) : null}
        </div>
        <div className="client-hero-actions">
          {!d.player.upToDate ? (
            <button className="btn btn-primary" disabled={busy} onClick={update}>
              {busy ? t("Updating…") : d.player.installed.length ? t("Update now") : t("Install Roblox")}
            </button>
          ) : null}
          <button className="btn btn-secondary" onClick={() => call("openRobloxVersionsFolder")}>
            {t("Open folder")}
          </button>
        </div>
      </section>

      <div className="client-grid">
        <section className="client-panel">
          <h3>{t("Launch with")}</h3>
          <p className="muted small">{t("Which Roblox build Ruby starts when you press Play. Older builds may be refused by Roblox once they're out of date.")}</p>
          <Select
            value={d.source}
            onChange={(v) => void setSource(v)}
            options={[
              { value: "roblox", label: latest ? t("Latest Roblox ({version})", { version: latest.guid }) : t("Latest Roblox"), group: t("Recommended") },
              ...d.player.installed
                .filter((v) => v.guid !== latest?.guid)
                .map((v) => ({ value: `version:${v.guid}`, label: `${v.guid} · ${fmtDate(v.modified)}`, group: t("Installed on this PC") })),
              ...(wl.playerPath ? [{ value: "weblauncher", label: wl.pinnedVersion ? t("weblauncher's build ({version})", { version: wl.pinnedVersion }) : t("weblauncher's build"), group: t("Other launchers") }] : []),
              ...(d.source.startsWith("version:") && !d.player.installed.some((v) => `version:${v.guid}` === d.source)
                ? [{ value: d.source, label: t("{version} (not installed yet)", { version: d.source.slice(8) }), group: t("Pinned") }]
                : []),
            ]}
          />
          <form
            className="client-custom"
            onSubmit={(e) => {
              e.preventDefault();
              const g = custom.trim();
              if (g) void setSource(`version:${g}`).then(() => setCustom(""));
            }}
          >
            <input className="text-input mono" placeholder={t("Or enter a version: {example}", { example: "version-0123456789abcdef" })} value={custom} onChange={(e) => setCustom(e.target.value)} />
            <button className="btn btn-secondary btn-small" disabled={!/^version-[0-9a-f]{16}$/i.test(custom.trim())}>
              {t("Use")}
            </button>
          </form>
        </section>

        <section className="client-panel">
          <h3>{t("Roblox Studio")}</h3>
          <p className="muted small">
            {d.studio.installed.length ? (d.studio.upToDate ? t("Up to date") : t("Will update the next time it opens")) : t("Not installed")}
            {d.studio.current ? ` · ${d.studio.current.version}` : ""}
          </p>
          <div className="client-actions">
            {d.studio.installed.length ? (
              <button className="btn btn-secondary btn-small" onClick={() => win.openExternal("roblox-studio:")}>
                <Icon name="studio" size={16} /> {t("Open Studio")}
              </button>
            ) : (
              <button className="btn btn-secondary btn-small" onClick={() => win.openExternal("https://create.roblox.com/landing")}>
                {t("Get Studio")}
              </button>
            )}
          </div>
        </section>
      </div>

      <section className="client-panel">
        <div className="row-between">
          <h3>{t("Installed versions")}</h3>
          <span className="muted small">{t("{n} on this PC", { n: d.player.installed.length })}</span>
        </div>
        {d.player.installed.length ? (
          <div className="client-versions">
            {[...(installedNow ? [installedNow] : []), ...older].map((v) => (
              <div key={v.guid} className="client-ver">
                <Icon name={v.guid === latest?.guid ? "check" : "clock"} size={16} />
                <span className="mono ellipsis">{v.guid}</span>
                <span className="muted small">{fmtDate(v.modified)}</span>
                <span className={`client-tag ${v.guid === latest?.guid ? "cur" : ""}`}>{v.guid === latest?.guid ? t("Current") : t("Older")}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted small">{t("Nothing installed yet. Install Roblox above.")}</p>
        )}
      </section>

      <button className="client-link" onClick={() => go({ name: "mods" })}>
        <Icon name="paint-brush" size={20} />
        <span>
          <b>{t("Mods")}</b>
          <span className="muted small">{t("Cursors, emote wheels, skyboxes, fonts, graphics and more")}</span>
        </span>
        <Icon name="chevron-small-right" size={20} />
      </button>
    </div>
  );
}

