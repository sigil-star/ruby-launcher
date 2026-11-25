import { rbx } from "./ipc";

/** Roblox's "not approved" record: a ban, a warning or a deleted account. Empty when in good standing. */
export type AccountModeration = {
  kind: "ban" | "warning" | "deleted";
  label: string;
  begin: string | null;
  end: string | null;
  message: string | null;
  reasons: { type: string; text: string }[];
  /** Warnings and finished bans are lifted once you agree to the rules on roblox.com. */
  canReactivate: boolean;
};

type NotApproved = {
  punishmentTypeDescription?: string;
  punishmentType?: string;
  beginDate?: string;
  endDate?: string | null;
  messageToUser?: string;
  badUtterances?: { abuseType?: string; utteranceText?: string }[];
  badAssets?: { abuseType?: string; assetName?: string }[];
};

export async function accountModeration(): Promise<AccountModeration | null> {
  const r = await rbx<NotApproved>("https://usermoderation.roblox.com/v1/not-approved");
  const label = r.punishmentTypeDescription || r.punishmentType;
  if (!label) return null;
  const l = label.toLowerCase();
  const kind = l.includes("warn") || l.includes("reminder") ? "warning" : l.includes("delete") ? "deleted" : "ban";
  const ended = r.endDate ? Date.parse(r.endDate) <= Date.now() : false;
  return {
    kind,
    label,
    begin: r.beginDate ?? null,
    end: r.endDate ?? null,
    message: r.messageToUser?.trim() || null,
    reasons: [
      ...(r.badUtterances ?? []).map((u) => ({ type: u.abuseType ?? "Chat", text: u.utteranceText ?? "" })),
      ...(r.badAssets ?? []).map((a) => ({ type: a.abuseType ?? "Content", text: a.assetName ?? "" })),
    ],
    canReactivate: kind === "warning" || (kind === "ban" && ended),
  };
}

export const reactivateAccount = () => rbx("https://usermoderation.roblox.com/v1/not-approved/reactivate", { method: "POST", body: {} });

export type VoiceStatus = {
  enabled: boolean;
  eligible: boolean;
  optedIn: boolean;
  banned: boolean;
  bannedUntil: Date | null;
  banReason: number | null;
};

type VoiceSettings = {
  isVoiceEnabled?: boolean;
  isUserEligible?: boolean;
  isUserOptIn?: boolean;
  isBanned?: boolean;
  banReason?: number | null;
  bannedUntil?: { Seconds?: number; seconds?: number } | null;
};

export async function voiceStatus(): Promise<VoiceStatus> {
  const r = await rbx<VoiceSettings>("https://voice.roblox.com/v1/settings");
  const secs = r.bannedUntil?.Seconds ?? r.bannedUntil?.seconds ?? null;
  const until = secs ? new Date(secs * 1000) : null;
  const banned = !!r.isBanned && (!until || until.getTime() > Date.now());
  return { enabled: !!r.isVoiceEnabled, eligible: !!r.isUserEligible, optedIn: !!r.isUserOptIn, banned, bannedUntil: banned ? until : null, banReason: r.banReason ?? null };
}

/** "3 days", "5 hours", "12 minutes" until `d`. */
export function timeLeft(d: Date | string): string {
  const ms = new Date(d).getTime() - Date.now();
  if (ms <= 0) return "now";
  const m = Math.ceil(ms / 60_000);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.ceil(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`;
  const days = Math.ceil(h / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
