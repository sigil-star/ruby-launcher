import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { call, on } from "../lib/ipc";
import { Headshot, Icon } from "../components/ui";
import type { ToastPayload } from "./DesktopNotify";
import { t as tr } from "../lib/i18n";

/* The bottom-right notification window (index.html#toasts). */

const TTL = 6500;
const MAX = 3;

function Card({ t, onClose }: { t: ToastPayload; onClose: () => void }) {
  const [hover, setHover] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const left = useRef(TTL);
  useEffect(() => {
    if (hover) return;
    const start = Date.now();
    const id = window.setTimeout(() => close(), left.current);
    return () => {
      window.clearTimeout(id);
      left.current = Math.max(1200, left.current - (Date.now() - start));
    };
  }, [hover]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => {
    setLeaving(true);
    window.setTimeout(onClose, 180);
  };
  const open = () => {
    if (t.target) void call("toastOpen", t.target);
    close();
  };
  return (
    <div className={`tc ${leaving ? "out" : ""}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onClick={open} role="status">
      <div className="tc-icon">
        {t.userId ? (
          <Headshot userId={t.userId} size={40} />
        ) : (
          <span className="tc-glyph">
            <Icon name={t.kind === "request" ? "person-plus" : t.kind === "message" ? "chat" : "bell"} size={20} />
          </span>
        )}
      </div>
      <div className="tc-text">
        <b className="tc-title">{t.title}</b>
        <span className="tc-body">{t.body}</span>
      </div>
      {t.actionLabel ? (
        <button className="tc-action" onClick={(e) => (e.stopPropagation(), open())}>
          {t.actionLabel}
        </button>
      ) : null}
      <button className="tc-x" aria-label={tr("Dismiss")} onClick={(e) => (e.stopPropagation(), close())}>
        <Icon name="x-small" size={14} />
      </button>
      {!hover ? <span className="tc-timer" style={{ animationDuration: `${TTL}ms` }} /> : null}
    </div>
  );
}

function Stack() {
  const [items, setItems] = useState<ToastPayload[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const add = (t: ToastPayload | null) => t && setItems((l) => (l.some((x) => x.id === t.id) ? l : [...l, t].slice(-MAX)));
    void call<ToastPayload | null>("toastPending").then(add);
    const sub = on<ToastPayload>("toast-push", add);
    // Ruby's safety net hid the window: drop anything still listed.
    const clear = on("toast-clear", () => setItems([]));
    return () => {
      void sub.then((u) => u());
      void clear.then((u) => u());
    };
  }, []);

  // Size the window to the cards (so it never blocks clicks elsewhere) and hide it when empty.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => void call("toastLayout", items.length ? Math.ceil(el.getBoundingClientRect().height) : 0);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items.length]);

  return (
    <div className="tc-stack" ref={ref}>
      {items.map((t) => (
        <Card key={t.id} t={t} onClose={() => setItems((l) => l.filter((x) => x.id !== t.id))} />
      ))}
    </div>
  );
}

export function ToastsApp() {
  const client = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }), []);
  useEffect(() => {
    document.documentElement.classList.add("toast-mode");
  }, []);
  return (
    <QueryClientProvider client={client}>
      <Stack />
    </QueryClientProvider>
  );
}
