import { useQuery } from "@tanstack/react-query";
import { rbx } from "./ipc";

/*
 * What kind of Roblox account this is, so Ruby can adapt instead of failing:
 * age band (from Roblox's age check), Roblox Kids / Select / standard, and country.
 * Same endpoints roblox.com's account settings use. Everything stays on this PC.
 */

export type AgeBand = "under9" | "9-12" | "13-15" | "16-17" | "18-20" | "21+" | "unknown";
export type Tier = "kids" | "select" | "standard" | "unknown";

export type AccountType = {
  band: AgeBand;
  /** Has the user done Roblox's age check (face estimate or ID)? */
  checked: boolean;
  /** An age check is pending and has a deadline. */
  deadline: string | null;
  tier: Tier;
  country: string | null;
  /** Chat is generally available for this account (Roblox still decides per person). */
  canChat: boolean;
  /** Trading needs 13+. */
  canTrade: boolean;
};

const BANDS: Record<string, AgeBand> = {
  Under9: "under9",
  "9To12": "9-12",
  "13To15": "13-15",
  "16To17": "16-17",
  "18To20": "18-20",
  "21Plus": "21+",
  Over21: "21+",
};

export function bandFromKey(key?: string | null): AgeBand {
  const k = (key ?? "").replace(/^Label\.AgeGroup/, "");
  return BANDS[k] ?? "unknown";
}

export function tierOf(band: AgeBand): Tier {
  if (band === "under9") return "kids";
  if (band === "9-12" || band === "13-15") return "select";
  if (band === "unknown") return "unknown";
  return "standard";
}

export async function accountType(): Promise<AccountType> {
  const [age, cc] = await Promise.all([
    rbx<{ ageGroupTranslationKey?: string | null; isChecked?: boolean; ageVerificationDeadline?: string | null; estimatedAgeGroupTranslationKey?: string | null }>(
      "https://apis.roblox.com/user-settings-api/v1/account-insights/age-group",
    ).catch(() => null),
    rbx<{ countryCode?: string }>("https://users.roblox.com/v1/users/authenticated/country-code").catch(() => null),
  ]);
  const band = bandFromKey(age?.ageGroupTranslationKey ?? age?.estimatedAgeGroupTranslationKey);
  const tier = tierOf(band);
  const checked = !!age?.isChecked;
  return {
    band,
    checked,
    deadline: age?.ageVerificationDeadline ?? null,
    tier,
    country: cc?.countryCode ?? null,
    // Kids accounts have chat off unless a parent turns it on; everyone needs the age check.
    canChat: checked && tier !== "kids",
    canTrade: band !== "under9" && band !== "9-12",
  };
}

export const useAccountType = (enabled = true) => useQuery({ queryKey: ["accountType"], queryFn: accountType, staleTime: 10 * 60_000, enabled, retry: false });

export const BAND_LABEL: Record<AgeBand, string> = {
  under9: "Under 9",
  "9-12": "9–12",
  "13-15": "13–15",
  "16-17": "16–17",
  "18-20": "18–20",
  "21+": "21+",
  unknown: "Not checked",
};
export const TIER_LABEL: Record<Tier, string> = { kids: "Roblox Kids", select: "Roblox Select", standard: "Standard account", unknown: "Unknown" };

/** Roblox's pages for the things Ruby can't do natively. */
export const AGE_CHECK_URL = "https://www.roblox.com/my/account#!/info";
export const PARENTAL_URL = "https://www.roblox.com/my/account#!/parental-controls";

/**
 * Plain-words version of Roblox's refusals that depend on the account (age, parental
 * controls, spend limits, region). Returns null when it's some other error.
 */
export function restrictionMessage(raw: string, status?: number): string | null {
  const m = raw.toLowerCase();
  if (/age ?(check|verif|estimat)|verify your age|age.?group/.test(m)) return "Roblox needs an age check for this. Do it once in the Roblox app or on roblox.com (Settings → Account Info).";
  if (/parental|parent(?:'|’)?s? (?:control|consent|permission)|guardian/.test(m)) return "A parent's settings block this on your account. They can change it in Roblox's Parental Controls.";
  if (/insufficient ?(funds|robux|balance)|not enough robux|insufficientfunds/.test(m)) return "You don't have enough Robux for this.";
  if (/already own|alreadyowned|item ?owned/.test(m)) return "You already own this.";
  if (/price ?changed|pricechanged|expected ?price/.test(m)) return "The price changed. Check the new price and try again.";
  if (/not for sale|notforsale|off ?sale|no longer (for sale|available)|sold out|soldout/.test(m)) return "This isn't for sale any more.";
  if (/too many (requests|purchases)|flood|toomanyrequests/.test(m)) return "Roblox is limiting purchases right now. Wait a minute and try again.";
  if (/spend(ing)? limit|monthly limit/.test(m)) return "This would go over your account's spending limit.";
  if (/not (available|allowed) in your (country|region)|region|country/.test(m) && status === 403) return "Roblox doesn't allow this in your country or region.";
  if (/chat.*(disabled|not allowed|restricted)|cannot (send|chat)|privacy settings/.test(m)) return "Chat isn't available for this account or this person. Check Roblox's privacy and age-check settings.";
  if (/trade.*(not allowed|disabled|restricted)|cannot trade|trading is/.test(m)) return "Trading isn't available on this account.";
  if (/content maturity|maturity|not age.?appropriate|content (?:age )?restriction/.test(m)) return "This is outside your account's content settings.";
  return null;
}
