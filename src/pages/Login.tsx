import { useEffect, useState } from "react";
import { session } from "../lib/api";
import { on, win } from "../lib/ipc";
import { Spinner } from "../components/ui";
import { t } from "../lib/i18n";

export function Login() {
  const [busy, setBusy] = useState<"" | "web" | "app">("");
  const [error, setError] = useState("");

  useEffect(() => {
    const sub = on<{ signedIn: boolean }>("login-window-closed", (e) => {
      if (!e.signedIn) setBusy("");
    });
    return () => void sub.then((un) => un());
  }, []);

  const signIn = async () => {
    setError("");
    setBusy("web");
    await session.signIn().catch((e) => {
      setError(String(e));
      setBusy("");
    });
  };

  const useApp = async () => {
    setError("");
    setBusy("app");
    const res = await session.useRobloxAppSession().catch(() => ({ ok: false }));
    if (!res.ok) {
      setError(t("No signed-in Roblox app session was found on this PC."));
      setBusy("");
    }
  };

  return (
    <div className="login" data-tauri-drag-region>
      <div className="login-controls">
        <button aria-label={t("Minimize")} onClick={() => win.minimize()}>–</button>
        <button aria-label={t("Close")} onClick={() => win.close()}>✕</button>
      </div>
      <div className="login-card">
        <img src={`${import.meta.env.BASE_URL}RubyLauncher.png`} alt="" width={72} height={72} />
        <h1>Ruby</h1>
        <p className="muted">{t("Sign in with your Roblox account to continue.")}</p>
        <button className="btn btn-primary btn-block" onClick={signIn} disabled={!!busy}>
          {busy === "web" ? t("Finish signing in the new window...") : t("Sign in to Roblox")}
        </button>
        <button className="btn btn-secondary btn-block" onClick={useApp} disabled={!!busy}>
          {busy === "app" ? <Spinner size={18} /> : t("Use account from Roblox app")}
        </button>
        {error ? <p className="error-text">{error}</p> : null}
        <p className="muted small">{t("Your session is stored only on this PC, encrypted for your Windows account.")}</p>
        <p className="muted tiny legal-note">{t("Ruby Launcher is an independent project. It is not affiliated with, endorsed by, or sponsored by Roblox Corporation. \"Roblox\" is a trademark of Roblox Corporation.")}</p>
      </div>
    </div>
  );
}
