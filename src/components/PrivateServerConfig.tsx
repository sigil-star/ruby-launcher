import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { call, rbx } from "../lib/ipc";
import { useUi } from "../app/store";
import { Headshot, Icon, Skel, Thumb } from "./ui";
import { t, fmtDate } from "../lib/i18n";

/* Configure your own private server, like roblox.com's "Configure Private Server" page. */

const V = "https://games.roblox.com/v1/vip-servers";
type Vip = {
  id: number;
  name: string;
  game?: { id: number; name: string; rootPlace?: { id: number } };
  joinCode?: string | null;
  link?: string | null;
  active: boolean;
  subscription?: { active?: boolean; expired?: boolean; expirationDate?: string; price?: number | null };
  permissions?: { friendsAllowed?: boolean; users?: { id: number; name: string; displayName?: string }[] };
};

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <input type="checkbox" className="switch" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />;
}

export function PrivateServerConfig({ id, universeId, onClose }: { id: number; universeId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useUi();
  const q = useQuery({ queryKey: ["vip", id], queryFn: () => rbx<Vip>(`${V}/${id}`) });
  const [name, setName] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  const v = q.data;

  const act = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      const r = await fn();
      if (r && typeof r === "object" && "id" in (r as object)) qc.setQueryData(["vip", id], r);
      else await q.refetch();
      qc.invalidateQueries({ queryKey: ["privateServers"] });
      if (done) toast(done);
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Roblox didn't accept that."), "error");
    } finally {
      setBusy(null);
    }
  };
  const patch = (body: Record<string, unknown>) => rbx<Vip>(`${V}/${id}`, { method: "PATCH", body });
  const perms = (body: Record<string, unknown>) => rbx(`${V}/${id}/permissions`, { method: "PATCH", body });
  const link = v?.link || (v?.joinCode && v.game?.rootPlace ? `https://www.roblox.com/games/${v.game.rootPlace.id}?privateServerLinkCode=${v.joinCode}` : "");

  const addPerson = () =>
    act(
      "add",
      async () => {
        const u = adding.trim().replace(/^@/, "");
        if (!u) return;
        const r = await rbx<{ data: { id: number }[] }>("https://users.roblox.com/v1/usernames/users", { method: "POST", body: { usernames: [u], excludeBannedUsers: true } });
        const uid = r.data[0]?.id;
        if (!uid) throw new Error(t("No Roblox user named \"{name}\".", { name: u }));
        await perms({ usersToAdd: [uid] });
        setAdding("");
      },
      t("Added."),
    );

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="ps-config card-in" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2 className="ps-config-title">{t("Configure Private Server")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("Close")}>
            <Icon name="x-small" size={22} />
          </button>
        </div>
        {q.isLoading || !v ? (
          <div className="skel-lines">
            <Skel h={120} r={10} />
            <Skel h={60} r={10} />
          </div>
        ) : (
          <>
            <div className="ps-config-top">
              <Thumb type="GameIcon" id={universeId} size="150x150" className="ps-config-art" />
              <dl className="ps-config-facts">
                <dt>{t("Server Name")}</dt>
                <dd>
                  {name != null ? (
                    <form
                      className="ps-name-edit"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act("name", () => patch({ name: name.trim() }), t("Renamed.")).then(() => setName(null));
                      }}
                    >
                      <input className="text-input" value={name} maxLength={50} autoFocus onChange={(e) => setName(e.target.value)} />
                      <button className="btn btn-primary btn-small" disabled={!name.trim() || busy === "name"}>
                        {t("Save")}
                      </button>
                      <button type="button" className="btn btn-secondary btn-small" onClick={() => setName(null)}>
                        {t("Cancel")}
                      </button>
                    </form>
                  ) : (
                    <span className="ps-name">
                      {v.name}
                      <button className="icon-btn" onClick={() => setName(v.name)} aria-label={t("Rename")} title={t("Rename")}>
                        <Icon name="pencil-square" size={16} />
                      </button>
                    </span>
                  )}
                </dd>
                <dt>{t("Experience")}</dt>
                <dd>{v.game?.name ?? "—"}</dd>
                <dt>{t("Subscription")}</dt>
                <dd>
                  {v.subscription?.price ? t("{n} Robux/month", { n: v.subscription.price }) : t("Free")}
                  {v.subscription?.expirationDate && v.subscription.price ? <span className="muted small"> · {t("renews {date}", { date: fmtDate(v.subscription.expirationDate) })}</span> : null}
                </dd>
              </dl>
            </div>

            <div className="ps-config-card">
              <div className="row-between">
                <b>{t("Allow Joining")}</b>
                <Toggle on={v.active} disabled={busy === "active"} onChange={(on) => act("active", () => patch({ active: on }))} />
              </div>
              <p className="muted small">{t("Turning this off makes the server unavailable to you and everyone you invited, and invalidates the current link. You can turn it back on any time.")}</p>
            </div>

            <div className="ps-config-card">
              <div className="row-between">
                <b>{t("Friends Allowed")}</b>
                <Toggle on={!!v.permissions?.friendsAllowed} disabled={busy === "friends"} onChange={(on) => act("friends", () => perms({ friendsAllowed: on }))} />
              </div>
              <div className="ps-sep" />
              <b>{t("Server Members")}</b>
              <form
                className="ps-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addPerson();
                }}
              >
                <input className="text-input" placeholder={t("Add someone by username")} value={adding} onChange={(e) => setAdding(e.target.value)} />
                <button className="btn btn-secondary btn-small" disabled={!adding.trim() || busy === "add"}>
                  {t("Add People")}
                </button>
              </form>
              {v.permissions?.users?.length ? (
                <div className="ps-members">
                  {v.permissions.users.map((u) => (
                    <div key={u.id} className="ps-member">
                      <Headshot userId={u.id} size={28} />
                      <span className="ellipsis">{u.displayName || u.name}</span>
                      <button className="icon-btn" title={t("Remove")} aria-label={t("Remove {name}", { name: u.name })} disabled={busy === `rm${u.id}`} onClick={() => act(`rm${u.id}`, () => perms({ usersToRemove: [u.id] }))}>
                        <Icon name="x-small" size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="muted small">{t("None")}</span>
              )}
              <div className="ps-sep" />
              <div className="row-between">
                <b>{t("Private Server Link")}</b>
                <button className="btn btn-secondary btn-small" disabled={!v.active || busy === "link"} onClick={() => act("link", () => patch({ newJoinCode: true }), t("New link made."))}>
                  {link ? t("Regenerate") : t("Generate")}
                </button>
              </div>
              <div className="ps-link">
                <input className="text-input pii" readOnly value={link} placeholder={t("Join Experience Link…")} />
                <button
                  className="icon-btn"
                  disabled={!link}
                  title={t("Copy link")}
                  aria-label={t("Copy link")}
                  onClick={() =>
                    navigator.clipboard.writeText(link).then(
                      () => toast(t("Link copied.")),
                      () => call("overlayCopy", link).then(() => toast(t("Link copied."))),
                    )
                  }
                >
                  <Icon name="chain-link" size={18} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
