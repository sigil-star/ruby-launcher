import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../lib/i18n";

/*
 * Ruby's own "are you sure?" dialog. The browser's window.confirm can be swallowed inside the
 * app window (it then answers "no" without showing anything), which made actions like Block
 * look like they did nothing.
 */
type Ask = { message: string; resolve: (ok: boolean) => void; text?: { value: string; done: (v: string | null) => void } };
let push: ((a: Ask) => void) | null = null;

export function askConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => (push ? push({ message, resolve }) : resolve(false)));
}

/** Ruby's replacement for window.prompt: resolves to the text, or null if cancelled. */
export function askText(message: string, initial = ""): Promise<string | null> {
  return new Promise((resolve) => {
    if (!push) return resolve(null);
    const text = { value: initial, done: resolve };
    push({ message, text, resolve: () => undefined });
  });
}

const danger = (m: string) => /^(block|unfriend|leave|delete|remove|decline|cancel)/i.test(m);
const label = (m: string) => {
  const w = (m.match(/^(\w+)/)?.[1] ?? "").toLowerCase();
  const known: Record<string, string> = { send: t("Send"), accept: t("Accept"), block: t("Block"), unfriend: t("Unfriend"), leave: t("Leave"), delete: t("Delete"), remove: t("Remove"), decline: t("Decline"), cancel: t("Cancel"), move: t("Move"), agree: t("Agree") };
  return known[w] ?? t("OK");
};

export function ConfirmHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [value, setValue] = useState("");
  useEffect(() => setValue(ask?.text?.value ?? ""), [ask]);
  useEffect(() => {
    push = setAsk;
    return () => {
      push = null;
    };
  }, []);
  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") done(false);
      if (e.key === "Enter") done(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ask) return null;
  const done = (ok: boolean) => {
    if (ask.text) ask.text.done(ok ? value : null);
    else ask.resolve(ok);
    setAsk(null);
  };
  return createPortal(
    <div className="modal-scrim confirm-scrim" onClick={() => done(false)}>
      <div className="buy-dialog confirm-dialog" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <p>{ask.message}</p>
        {ask.text ? <input className="text-input confirm-input" autoFocus value={value} maxLength={100} onChange={(e) => setValue(e.target.value)} /> : null}
        <div className="confirm-actions">
          <button className="btn btn-secondary" onClick={() => done(false)}>
            {t("Cancel")}
          </button>
          <button className={`btn ${!ask.text && danger(ask.message) ? "btn-danger" : "btn-primary"}`} autoFocus={!ask.text} onClick={() => done(true)}>
            {ask.text ? t("Save") : label(ask.message)}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
