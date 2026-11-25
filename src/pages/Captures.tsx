import { askConfirm } from "../components/Confirm";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { captures, deleteCapture, openCapture, revealCapture, type Capture } from "../lib/extras";
import { useUi } from "../app/store";
import { Icon, Skel } from "../components/ui";
import { fmtDate, t } from "../lib/i18n";

/** Captures: the screenshots you've taken in Roblox, newest first (like the app's Captures). */
export function CapturesPage() {
  const { toast } = useUi();
  const q = useQuery({ queryKey: ["captures"], queryFn: captures, staleTime: 15_000 });
  const [open, setOpen] = useState<Capture | null>(null);
  const list = q.data?.captures ?? [];
  const remove = async (c: Capture) => {
    if (!await askConfirm(t("Move {name} to the Recycle Bin?", { name: c.name }))) return;
    try {
      await deleteCapture(c.path);
      setOpen(null);
      q.refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };
  return (
    <div className="page captures-page">
      <div className="trades-head">
        <h1>{t("Captures")}</h1>
        <button className="btn btn-secondary btn-small" onClick={() => q.refetch()}>
          {t("Refresh")}
        </button>
      </div>
      {q.isLoading ? (
        <div className="cap-grid">
          {Array.from({ length: 8 }, (_, i) => (
            <Skel key={i} h={160} r={12} />
          ))}
        </div>
      ) : !list.length ? (
        <div className="state">
          <Icon name="squares-grid-qr" size={28} />
          <div className="muted">{t("No captures yet. Take a screenshot in Roblox (Print Screen or the menu's Capture button) and it shows up here.")}</div>
        </div>
      ) : (
        <div className="cap-grid">
          {list.map((c) => (
            <button key={c.path} className="cap-tile" onClick={() => setOpen(c)} title={c.name}>
              {c.preview ? <img src={c.preview} alt="" draggable={false} /> : null}
              <span className="tiny">{fmtDate(c.modified, { dateStyle: "short", timeStyle: "short" })}</span>
            </button>
          ))}
        </div>
      )}
      {open ? (
        <div className="modal-scrim" onClick={() => setOpen(null)}>
          <div className="cap-view" onClick={(e) => e.stopPropagation()}>
            {open.preview ? <img src={open.preview} alt={open.name} /> : null}
            <div className="cap-actions">
              <span className="muted small ellipsis">{open.name}</span>
              <span style={{ flex: 1 }} />
              <button className="btn btn-primary btn-small" onClick={() => openCapture(open.path)}>
                {t("Open")}
              </button>
              <button className="btn btn-secondary btn-small" onClick={() => revealCapture(open.path)}>
                {t("Show in folder")}
              </button>
              <button className="btn btn-secondary btn-small danger-text" onClick={() => remove(open)}>
                {t("Delete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
