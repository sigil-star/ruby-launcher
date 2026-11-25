import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { updateDescription, user } from "../lib/api";
import { hasPremium } from "../lib/account";
import {
  DEFAULT_CAMERA,
  equipFrame,
  equippedFrame,
  HEADSHOT,
  profileFrames,
  thumbnailCustomizationsV4,
  ownedEmotes,
  saveThumbnailCustomization,
  setDisplayName,
  thumbnailCustomizations,
  validateDisplayName,
  type HeadshotCamera,
} from "../lib/profileEdit";
import { win } from "../lib/ipc";
import { useMe, useNav, useUi } from "../app/store";
import { AvatarRig } from "../components/AvatarRig";
import { Headshot, Icon, Skel, Spinner, Thumb } from "../components/ui";
import { friendlyError } from "./People";
import { t } from "../lib/i18n";

export function EditProfile() {
  const me = useMe();
  const { back } = useNav();
  const info = useQuery({ queryKey: ["user", me.id], queryFn: () => user(me.id!), enabled: !!me.id });
  const plus = useQuery({ queryKey: ["hasPlus", me.id], queryFn: () => hasPremium(me.id!), enabled: !!me.id, staleTime: 10 * 60_000 });
  const worn = useQuery({ queryKey: ["equippedFrame", me.id], queryFn: () => equippedFrame(me.id!), enabled: !!me.id && !!plus.data });
  const [edit, setEdit] = useState<"name" | "about" | "picture" | null>(null);
  const u = info.data;
  if (edit === "picture") return <EditPicture onClose={() => setEdit(null)} />;
  return (
    <div className="page edit-profile">
      <div className="ep-head">
        <button className="icon-btn" onClick={back} aria-label={t("Back")}>
          <Icon name="chevron-small-left" size={24} />
        </button>
        <b>{t("Edit profile")}</b>
      </div>
      <button className="ep-avatar" onClick={() => setEdit("picture")} aria-label={t("Edit profile picture")}>
        <Headshot userId={me.id!} size={96} />
        <span className="ep-cam">
          <Icon name="pencil-square" size={16} />
        </span>
      </button>
      <div className="ep-list">
        <EpRow label={t("Name")} value={u?.displayName} onClick={() => setEdit("name")} />
        <EpRow
          label={t("Username")}
          value={u?.name}
          onClick={() => win.showRobloxPage("https://www.roblox.com/my/account#!/info", t("Change username"))}
          title={t("Changing your username costs Robux and needs your password, so it's done on Roblox's own page.")}
        />
        <EpRow label={t("About")} value={u?.description ? u.description.split("\n")[0] : t("Add a bio")} onClick={() => setEdit("about")} />
      </div>
      {plus.data ? (
        <div className="ep-list">
          <EpRow label={t("Profile frame")} value={worn.data ? <Thumb type="Asset" id={worn.data} size="150x150" className="ep-frame-thumb" /> : <span className="ep-frame-dot" />} onClick={() => setEdit("picture")} />
        </div>
      ) : null}
      {edit === "name" && u ? <NameDialog initial={u.displayName} onClose={() => setEdit(null)} /> : null}
      {edit === "about" && u ? <AboutDialog initial={u.description ?? ""} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}

function EpRow({ label, value, onClick, title }: { label: string; value?: React.ReactNode; onClick: () => void; title?: string }) {
  return (
    <button className="ep-row" onClick={onClick} title={title}>
      <span>{label}</span>
      <span className="ep-val muted ellipsis">{value ?? <Skel w={60} h={12} />}</span>
      <Icon name="chevron-small-right" size={20} />
    </button>
  );
}

function Dialog({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="modal-scrim">
      <div className="buy-dialog" role="dialog" aria-label={title}>
        <div className="buy-head">
          <h2>{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}

function NameDialog({ initial, onClose }: { initial: string; onClose: () => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const { toast } = useUi();
  const [name, setName] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const n = name.trim();
    if (n === initial) return onClose();
    setBusy(true);
    const bad = await validateDisplayName(me.id!, n);
    if (bad) {
      setErr(bad);
      setBusy(false);
      return;
    }
    try {
      await setDisplayName(me.id!, n);
      toast(t("Display name updated."));
      qc.invalidateQueries({ queryKey: ["user", me.id] });
      onClose();
    } catch (e) {
      setErr(friendlyError(e));
      setBusy(false);
    }
  };
  return (
    <Dialog title={t("Display name")}>
      <input className="ep-input" value={name} maxLength={20} autoFocus onChange={(e) => (setName(e.target.value), setErr(null))} onKeyDown={(e) => e.key === "Enter" && save()} />
      <div className="muted small">{t("3–20 characters. You can change it once every 7 days.")}</div>
      {err ? <div className="error-text">{err}</div> : null}
      <div className="buy-actions">
        <button className="btn btn-primary btn-block" onClick={save} disabled={busy || name.trim().length < 3}>
          {busy ? <Spinner size={18} /> : t("Save")}
        </button>
        <button className="btn btn-secondary btn-block" onClick={onClose} disabled={busy}>
          {t("Cancel")}
        </button>
      </div>
    </Dialog>
  );
}

function AboutDialog({ initial, onClose }: { initial: string; onClose: () => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const { toast } = useUi();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await updateDescription(text);
      toast(t("Profile updated."));
      qc.invalidateQueries({ queryKey: ["user", me.id] });
      onClose();
    } catch (e) {
      toast(friendlyError(e), "error");
      setBusy(false);
    }
  };
  return (
    <Dialog title={t("About")}>
      <textarea className="bio-input" value={text} maxLength={1000} rows={6} autoFocus onChange={(e) => setText(e.target.value)} />
      <div className="muted small bio-count">{text.length}/1000</div>
      <div className="buy-actions">
        <button className="btn btn-primary btn-block" onClick={save} disabled={busy}>
          {busy ? <Spinner size={18} /> : t("Save")}
        </button>
        <button className="btn btn-secondary btn-block" onClick={onClose} disabled={busy}>
          {t("Cancel")}
        </button>
      </div>
    </Dialog>
  );
}

const ZOOM_STEP = 0.25;
const TURN_STEP = 15;

function EditPicture({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const { toast } = useUi();
  // roblox.com reads poses from the v4 avatar config; the older endpoint is the fallback.
  const current = useQuery({ queryKey: ["thumbCustom"], queryFn: () => thumbnailCustomizationsV4(me.id!).catch(() => thumbnailCustomizations()), retry: false, enabled: !!me.id });
  const plus = useQuery({ queryKey: ["hasPlus", me.id], queryFn: () => hasPremium(me.id!), enabled: !!me.id, staleTime: 10 * 60_000 });
  const frames = useQuery({ queryKey: ["profileFrames"], queryFn: profileFrames, staleTime: 60 * 60_000 });
  const worn = useQuery({ queryKey: ["equippedFrame", me.id], queryFn: () => equippedFrame(me.id!), enabled: !!me.id });
  const [frame, setFrame] = useState<number | null | undefined>(undefined);
  const frameNow = frame === undefined ? (worn.data ?? null) : frame;
  const emotes = useQuery({ queryKey: ["ownedEmotes", me.id], queryFn: () => ownedEmotes(me.id!), enabled: !!me.id, staleTime: 5 * 60_000 });
  const saved = current.data?.find((c) => c.thumbnailType === HEADSHOT);
  const [emote, setEmote] = useState<number | null>(null);
  const [cam, setCam] = useState<HeadshotCamera | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = emote ?? saved?.emoteAssetId ?? 0;
  const c = cam ?? saved?.camera ?? DEFAULT_CAMERA;
  const set = (p: Partial<HeadshotCamera>) => setCam({ ...c, ...p });
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  const save = async () => {
    setBusy(true);
    try {
      const poseChanged = emote !== null || cam !== null;
      if (poseChanged) {
        const r = await saveThumbnailCustomization({ thumbnailType: HEADSHOT, emoteAssetId: pick, camera: c });
        if (import.meta.env.DEV) console.info("[pose] sent", JSON.stringify({ emoteAssetId: pick, camera: c }), "->", JSON.stringify(r));
        // Roblox answers success even when it keeps the old pose, so read it back and check.
        const now = (await thumbnailCustomizations().catch(() => [])).find((x) => x.thumbnailType === HEADSHOT);
        const close = (a: number, b: number) => Math.abs(a - b) < 0.01;
        const kept = now && now.emoteAssetId === pick && close(now.camera.distanceScale, c.distanceScale) && close(now.camera.yRotDeg, c.yRotDeg);
        if (!kept) {
          qc.invalidateQueries({ queryKey: ["thumbCustom"] });
          setBusy(false);
          setCam(null);
          setEmote(null);
          toast(t("Roblox didn't keep that pose, so your old one is still on. Try a smaller zoom or turn."), "error");
          return;
        }
      }
      if (frame !== undefined && frame !== (worn.data ?? null)) {
        await equipFrame(frame ?? 0);
        qc.invalidateQueries({ queryKey: ["equippedFrame", me.id] });
      }
      toast(t("Profile picture updated. Roblox may take a minute to redraw it."));
      qc.invalidateQueries({ queryKey: ["thumbCustom"] });
      qc.invalidateQueries({ queryKey: ["thumb"] });
      onClose();
    } catch (e) {
      toast(friendlyError(e), "error");
      setBusy(false);
    }
  };

  return (
    <div className="pp-editor">
      <div className="pp-left">
        <div className="ep-head">
          <button className="icon-btn" onClick={onClose} aria-label={t("Close")}>
            <Icon name="x-small" size={22} />
          </button>
          <b>{t("Edit Profile Picture")}</b>
        </div>
        <div className="pp-section-title">{t("Emotes")}</div>
        <div className="pp-grid">
          <button className={`pp-tile ${pick === 0 ? "on" : ""}`} onClick={() => setEmote(0)}>
            <span className="pp-art">
              <Icon name="person-standing" size={36} />
            </span>
            <span className="tiny ellipsis">{t("No pose")}</span>
          </button>
          {emotes.isLoading
            ? Array.from({ length: 8 }, (_, i) => <Skel key={i} h={120} r={10} />)
            : (emotes.data ?? []).map((e) => (
                <button key={e.id} className={`pp-tile ${pick === e.id ? "on" : ""}`} onClick={() => setEmote(e.id)} title={e.name}>
                  <span className="pp-art">
                    <Thumb type="Asset" id={e.id} />
                  </span>
                  <span className="tiny ellipsis">{e.name}</span>
                </button>
              ))}
        </div>
        {!emotes.isLoading && !emotes.data?.length ? <div className="muted small">{t("You don't own any emotes yet.")}</div> : null}
        <div className="pp-section-title">
          <Icon name="roblox-plus" size={16} /> {t("Frames")}
        </div>
        {!plus.data ? (
          <div className="muted small">{t("Unlock frames with Roblox Plus.")}</div>
        ) : (
          <div className="pp-grid">
            <button className={`pp-tile ${frameNow === null ? "on" : ""}`} onClick={() => setFrame(null)}>
              <span className="pp-art">
                <Icon name="x-small" size={30} />
              </span>
              <span className="tiny ellipsis">{t("None")}</span>
            </button>
            {frames.isLoading
              ? Array.from({ length: 6 }, (_, i) => <Skel key={i} h={120} r={10} />)
              : (frames.data ?? []).map((f) => (
                  <button key={f.assetId} className={`pp-tile ${frameNow === f.assetId ? "on" : ""}`} onClick={() => setFrame(f.assetId)} title={f.name}>
                    <span className="pp-art">
                      <Thumb type="Asset" id={f.assetId} size="150x150" />
                    </span>
                    <span className="tiny ellipsis">{f.name}</span>
                  </button>
                ))}
          </div>
        )}
        <div className="pp-save">
          <button className="btn btn-primary btn-block" onClick={save} disabled={busy || current.isLoading}>
            {busy ? <Spinner size={18} /> : t("Save")}
          </button>
        </div>
      </div>
      <div className="pp-right">
        <div className="pp-tools">
          <button className="icon-btn" aria-label={t("Zoom in")} onClick={() => set({ distanceScale: clamp(c.distanceScale - ZOOM_STEP, 0.5, 4) })}>
            <Icon name="plus-small" size={22} />
          </button>
          <button className="icon-btn" aria-label={t("Zoom out")} onClick={() => set({ distanceScale: clamp(c.distanceScale + ZOOM_STEP, 0.5, 4) })}>
            <Icon name="minus-small" size={22} />
          </button>
          <button className="icon-btn" aria-label={t("Turn left")} onClick={() => set({ yRotDeg: clamp(c.yRotDeg - TURN_STEP, -60, 60) })}>
            <Icon name="arrow-curl-to-left" size={20} />
          </button>
          <button className="icon-btn" aria-label={t("Turn right")} onClick={() => set({ yRotDeg: clamp(c.yRotDeg + TURN_STEP, -60, 60) })}>
            <Icon name="arrow-curl-to-right" size={20} />
          </button>
        </div>
        <div className="pp-stage">
          <AvatarRig userId={me.id!} self emoteId={pick} view={{ zoom: 4.2 * c.distanceScale, zoomMin: 4.2 * 0.5, zoomMax: 4.2 * 4, yawMin: -60, yawMax: 60, yawDeg: c.yRotDeg, focusY: 4.4 /* Roblox keeps one aim point and only pulls the camera back (measured: head top sits 197/distance px above centre at 420px) */ }} onViewChange={(v) => {
              // Turn wraps around; keep it within Roblox's −60…60°.
              const yaw = ((((v.yawDeg + 180) % 360) + 360) % 360) - 180;
              set({ distanceScale: Math.round(clamp(v.zoom / 4.2, 0.5, 4) * 1000) / 1000, yRotDeg: Math.round(clamp(yaw, -60, 60)) });
            }}
            className="pp-rig"
          />
          {frameNow ? <Thumb type="Asset" id={frameNow} size="420x420" className="pp-frame" /> : <div className="pp-ring" />}
        </div>
      </div>
    </div>
  );
}
