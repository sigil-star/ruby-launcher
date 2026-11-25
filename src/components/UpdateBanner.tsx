import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { call, on, win } from "../lib/ipc";
import { useUi } from "../app/store";
import { Icon } from "./ui";
import { t } from "../lib/i18n";

export type Update = { current: string; latest?: string; newer: boolean; sizeMb?: number; notes?: string[]; error?: string };
type Progress = { done: number; total: number; phase?: "installing" };

const PAGE = "https://dsk.wtf/ruby";
const mb = (n: number) => t("{n} MB", { n: Math.round(n / 1_048_576) });

export const useUpdate = () =>
  useQuery({ queryKey: ["checkUpdate"], queryFn: () => call<Update>("checkUpdate"), staleTime: 6 * 60 * 60_000, refetchInterval: 6 * 60 * 60_000, retry: false });

/** Download, verify and install the newest Ruby. Ruby closes and reopens on the new version. */
export function useInstallUpdate() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const un = on<Progress>("ruby-update-progress", setProgress);
    return () => void un.then((f) => f());
  }, []);
  const install = async () => {
    setError("");
    setProgress({ done: 0, total: 0 });
    try {
      await call("installUpdate");
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const pct = progress && progress.total ? Math.floor((progress.done / progress.total) * 100) : 0;
  return { install, progress, pct, error, busy: progress !== null };
}

const dismissKey = (v: string) => `ruby.updateDismissed.${v}`;
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* the banner just shows again next launch */
    }
  },
};

/** One toast after Ruby updated itself, so the change doesn't go unnoticed. */
function useUpdatedToast(current?: string) {
  const { toast } = useUi();
  useEffect(() => {
    if (!current) return;
    const last = store.get("ruby.lastVersion");
    store.set("ruby.lastVersion", current);
    if (last && last !== current) toast(t("Ruby updated to {version}.", { version: current }));
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The "update available" bar at the top of every page. "Later" hides it until the next version. */
export function UpdateBanner() {
  const { data } = useUpdate();
  const { install, progress, pct, error, busy } = useInstallUpdate();
  const [hidden, setHidden] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  useUpdatedToast(data?.current);

  if (!data?.newer || !data.latest || hidden || (store.get(dismissKey(data.latest)) === "1" && !busy && !error)) return null;
  const notes = data.notes ?? [];
  const installing = progress?.phase === "installing";

  const later = () => {
    store.set(dismissKey(data.latest!), "1");
    setHidden(true);
  };

  return (
    <section className={`update-bar ${error ? "failed" : ""}`} role="status" aria-live="polite">
      <div className="update-icon" aria-hidden>
        <Icon name={error ? "x-small" : "arrow-small-down"} size={20} />
      </div>
      <div className="update-body">
        {error ? (
          <>
            <b>{t("The update didn't install")}</b>
            <span className="update-sub">{error} {t("Nothing on your PC was changed.")}</span>
          </>
        ) : busy ? (
          <>
            <b>{installing ? t("Installing Ruby {version}", { version: data.latest }) : t("Downloading Ruby {version}", { version: data.latest })}</b>
            <span className="update-sub">
              {installing
                ? t("Checked and verified. Ruby will close and reopen in a moment.")
                : progress && progress.total
                  ? t("{done} of {total} · {pct}%", { done: mb(progress.done), total: mb(progress.total), pct })
                  : t("Starting…")}
            </span>
            <span className="update-progress" aria-hidden>
              <span className={installing ? "indeterminate" : ""} style={installing ? undefined : { width: `${pct}%` }} />
            </span>
          </>
        ) : (
          <>
            <b>
              {t("Update available")} <span className="update-chip">{data.latest}</span>
            </b>
            <span className="update-sub">
              {t("You have {version}", { version: data.current })}
              {data.sizeMb ? ` · ${t("{n} MB download", { n: data.sizeMb })}` : ""}. {t("Your accounts, settings and mods stay as they are.")}
              {notes.length ? (
                <>
                  {" "}
                  <button className="link update-notes-toggle" onClick={() => setNotesOpen((o) => !o)} aria-expanded={notesOpen}>
                    {notesOpen ? t("Hide what's new") : t("What's new")}
                  </button>
                </>
              ) : null}
            </span>
            {notesOpen ? (
              <ul className="update-notes">
                {notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
      {busy ? null : (
        <div className="update-actions">
          {error ? (
            <>
              <button className="btn btn-secondary btn-small" onClick={() => void win.openExternal(PAGE)}>
                {t("Download from dsk.wtf")}
              </button>
              <button className="btn btn-primary btn-small" onClick={() => void install()}>
                {t("Try again")}
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary btn-small" onClick={later}>
                {t("Later")}
              </button>
              <button className="btn btn-primary btn-small" onClick={() => void install()}>
                {t("Update now")}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
