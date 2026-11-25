/**
 * Account settings data for the native Settings pages. Endpoints are the ones roblox.com's
 * account settings use; anything Ruby can't do natively links to the matching web page.
 */
import { rbx } from "./ipc";

const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await p;
  } catch {
    return fallback;
  }
};

/* Account info */
export const birthdate = () =>
  safe(rbx<{ birthMonth: number; birthDay: number; birthYear: number }>("https://accountinformation.roblox.com/v1/birthdate"), null);
export const gender = () => safe(rbx<{ gender: number }>("https://accountinformation.roblox.com/v1/gender").then((r) => r.gender), null);
export const emailInfo = () =>
  safe(rbx<{ emailAddress: string | null; verified: boolean }>("https://accountsettings.roblox.com/v1/email"), null);
export const phoneInfo = () =>
  safe(rbx<{ countryCode?: string; prefix?: string; phone?: string | null; isVerified?: boolean }>("https://accountinformation.roblox.com/v1/phone"), null);

export type PromotionChannels = {
  facebook: string | null;
  twitter: string | null;
  youtube: string | null;
  twitch: string | null;
  guilded?: string | null;
  promotionChannelsVisibilityPrivacy?: string;
};
export const myPromotionChannels = () => safe(rbx<PromotionChannels>("https://accountinformation.roblox.com/v1/promotion-channels"), null);
export const savePromotionChannels = (body: PromotionChannels) =>
  rbx("https://accountinformation.roblox.com/v1/promotion-channels", { method: "POST", body });

/* Security */
export type SessionRow = {
  token?: string;
  agent?: { type?: string; value?: string; os?: string };
  location?: { city?: string; subdivision?: string; country?: string };
  lastAccessedTimestampEpochMilliseconds?: string | number;
  isCurrentSession?: boolean;
};
export const sessions = () =>
  safe(
    rbx<{ sessions?: SessionRow[] }>("https://apis.roblox.com/token-metadata-service/v1/sessions?desiredLimit=25").then((r) => r.sessions ?? []),
    [] as SessionRow[],
  );
export const twoStepConfig = (userId: number) =>
  safe(
    rbx<{ methods?: { mediaType: string; enabled: boolean }[] }>(`https://twostepverification.roblox.com/v1/users/${userId}/configuration`).then(
      (r) => r.methods ?? [],
    ),
    [] as { mediaType: string; enabled: boolean }[],
  );

/* Privacy (user-settings-api) */
/** `locked`: Roblox requires something other than the user's own choice (age check, parent). */
export type SettingOption = { value: string; label: string; locked?: boolean };
export type UserSetting = { key: string; current: string; options: SettingOption[] };

/** Roblox's wording for setting values. */
const VALUE_LABELS: Record<string, string> = {
  AllUsers: "Everyone",
  FriendsFollowingAndFollowers: "Friends, followers & people I follow",
  FriendsAndFollowing: "Friends & people I follow",
  Friends: "Friends",
  NoOne: "No one",
  TrustedFriends: "Trusted friends",
  Enabled: "On",
  Disabled: "Off",
  Discoverable: "On",
  NotDiscoverable: "Off",
  AllAges: "All ages",
  NinePlus: "9+",
  ThirteenPlus: "13+",
  SeventeenPlus: "17+",
  EighteenPlus: "18+",
  None: "None",
  Low: "Low",
  Medium: "Medium",
  High: "High",
};
const valueLabel = (v: string) => VALUE_LABELS[v] ?? humanize(v);

const humanize = (k: string) =>
  k
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\bWho Can\b/i, "Who can");

/** Every privacy setting with its current value and allowed options. Parses defensively. */
export async function privacySettings(): Promise<UserSetting[]> {
  const raw = await rbx<Record<string, unknown>>("https://apis.roblox.com/user-settings-api/v1/user-settings/settings-and-options");
  const out: UserSetting[] = [];
  for (const [key, v] of Object.entries(raw ?? {})) {
    const o = v as { currentValue?: unknown; options?: unknown[] };
    if (!o || typeof o !== "object" || !Array.isArray(o.options)) continue;
    const options: SettingOption[] = o.options
      .map((x) => {
        const row = x as { option?: unknown; requirement?: string };
        const opt = row?.option ?? x;
        const value = typeof opt === "string" ? opt : String((opt as { optionValue?: unknown; value?: unknown })?.optionValue ?? (opt as { value?: unknown })?.value ?? "");
        const locked = !!row?.requirement && row.requirement !== "SelfUpdateSetting";
        return value ? ({ value, label: valueLabel(value), locked } as SettingOption) : null;
      })
      .filter((x): x is SettingOption => !!x);
    const current = String(o.currentValue ?? "");
    // No choices at all = Roblox has locked it (age / parental controls); show it read-only.
    if (!options.length && current) options.push({ value: current, label: valueLabel(current), locked: true });
    if (!options.length) continue;
    out.push({ key, current, options });
  }
  return out;
}
export const settingLabel = humanize;
/**
 * Settings Roblox only lets you change through its own confirmation step (age check, parental
 * consent, "are you sure" prologue). A plain write is refused with 400, so these open roblox.com.
 */
export const GATED_SETTINGS = new Set([
  "contentAgeRestriction",
  "whoCanChatWithMeInExperiences",
  "whoCanWhisperChatWithMeInExperiences",
  "allowFacialAgeEstimation",
  "allowCrossAgeGroupStudioCollaboration",
  "phoneNumberDiscoverability",
]);
export const savePrivacySetting = (key: string, value: string) =>
  rbx("https://apis.roblox.com/user-settings-api/v1/user-settings", { method: "POST", body: { [key]: value } });

export type BlockedUser = { userId: number; name: string; displayName: string };
/** Blocked people. Roblox moved blocking to user-blocking-api; the old accountsettings list is the fallback. */
export async function blockedUsers(): Promise<BlockedUser[]> {
  type R = { blockedUsers?: BlockedUser[]; blockedUserIds?: number[]; data?: { userId?: number; id?: number }[] };
  const r = await rbx<R>("https://apis.roblox.com/user-blocking-api/v1/users/get-detailed-blocked-users")
    .catch(() => rbx<R>("https://apis.roblox.com/user-blocking-api/v1/users/get-blocked-users"))
    .catch(() => rbx<R>("https://accountsettings.roblox.com/v1/users/get-detailed-blocked-users"))
    .catch(() => null);
  if (!r) return [];
  if (r.blockedUsers?.length) return r.blockedUsers;
  const ids = r.blockedUserIds ?? (r.data ?? []).map((d) => d.userId ?? d.id ?? 0).filter(Boolean);
  if (!ids.length) return [];
  const names = await rbx<{ data: { id: number; name: string; displayName: string }[] }>("https://users.roblox.com/v1/users", { method: "POST", body: { userIds: ids, excludeBannedUsers: false } }).catch(() => ({ data: [] }));
  return ids.map((id) => {
    const n = names.data.find((x) => x.id === id);
    return { userId: id, name: n?.name ?? String(id), displayName: n?.displayName ?? n?.name ?? String(id) };
  });
}

/* Spending / Robux / Subscriptions */
export const creditBalance = () => safe(rbx<{ balance: number; currencyCode?: string }>("https://billing.roblox.com/v1/credit"), null);

export type Transaction = {
  id?: number;
  created: string;
  isPending?: boolean;
  agent?: { id: number; type: string; name: string };
  details?: { id?: number; name?: string; type?: string };
  currency: { amount: number; type: string };
};
export const transactions = (userId: number, type: "Purchase" | "Sale" | "CurrencyPurchase") =>
  safe(
    rbx<{ data: Transaction[] }>(`https://economy.roblox.com/v2/users/${userId}/transactions?limit=25&transactionType=${type}`).then((r) => r.data ?? []),
    [] as Transaction[],
  );

export const hasPremium = (userId: number) =>
  safe(rbx<boolean>(`https://premiumfeatures.roblox.com/v1/users/${userId}/validate-membership`), false);

export type MyPrivateServer = { privateServerId?: number; name: string; universeName?: string; universeId?: number; active?: boolean; expirationDate?: string; priceInRobux?: number | null };
export const myPrivateServers = () =>
  safe(
    rbx<{ data: MyPrivateServer[] }>("https://games.roblox.com/v1/private-servers/my-private-servers?privateServersTab=MyPrivateServers&itemsPerPage=50").then(
      (r) => r.data ?? [],
    ),
    [] as MyPrivateServer[],
  );
