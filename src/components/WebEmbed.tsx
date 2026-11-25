import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { call } from "../lib/ipc";
import { Icon } from "./ui";
import { t } from "../lib/i18n";

/*
 * The embedded roblox.com page is a native webview drawn *over* Ruby's window, so Ruby's own
 * popups (menu drawer, notifications, launch card…) would be hidden behind it. Anything that
 * opens over the page calls useSuppressEmbed(), and the embed steps aside while it's open.
 */
let suppress = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

export function useSuppressEmbed(active = true) {
  useEffect(() => {
    if (!active) return;
    suppress++;
    notify();
    return () => {
      suppress--;
      notify();
    };
  }, [active]);
}

function useSuppressed() {
  const [s, set] = useState(suppress > 0);
  useEffect(() => {
    const f = () => set(suppress > 0);
    listeners.add(f);
    // The count may have changed between render and subscribing (e.g. the drawer that
    // navigated here closing in the same commit), so sync once now.
    f();
    return () => {
      listeners.delete(f);
    };
  }, []);
  return s;
}

/** A roblox.com page shown inside Ruby, signed in and themed to match. */
export function WebEmbed({ url, title }: { url: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const suppressed = useSuppressed();
  const shown = useRef(false);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const rect = () => {
      const r = el.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] as const;
    };
    const place = () => {
      if (suppress > 0) return;
      const [x, y, w, h] = rect();
      if (!shown.current) {
        shown.current = true;
        call("showEmbed", url, x, y, w, h).catch(() => undefined);
      } else call("moveEmbed", x, y, w, h).catch(() => undefined);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      shown.current = false;
      call("closeEmbed").catch(() => undefined);
    };
  }, [url]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (suppressed) call("hideEmbed").catch(() => undefined);
    else {
      const r = el.getBoundingClientRect();
      call("showEmbed", url, Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)).catch(() => undefined);
    }
  }, [suppressed, url]);

  return (
    <div className="web-embed-page">
      <div className="web-embed-bar">
        <b>{title}</b>
        <span className="muted small ellipsis">{url.replace(/^https:\/\//, "")}</span>
        <button className="icon-btn" title={t("Open in your browser")} aria-label={t("Open in your browser")} onClick={() => call("openExternal", url)}>
          <Icon name="two-arrows-from-center" size={18} />
        </button>
        <button className="icon-btn" title={t("Reload")} aria-label={t("Reload")} onClick={() => call("reloadEmbed")}>
          <Icon name="arrow-spin-clockwise" size={18} />
        </button>
      </div>
      <div className="web-embed-box" ref={box}>
        <div className="web-embed-loading">
          <span className="skel" style={{ width: "60%", height: 26, borderRadius: 8 }} />
          <span className="skel" style={{ width: "90%", height: 160, borderRadius: 14 }} />
          <span className="skel" style={{ width: "75%", height: 14, borderRadius: 6 }} />
        </div>
      </div>
    </div>
  );
}
