/*
 * Ruby's supporter game passes (Ruby Crystal group, "Ruby" experience, universe 9935553407).
 *
 * Round-up: when you buy something, Ruby can offer to round the total up to the next 10 Robux,
 * paying the difference with the 1, 2, 5 and 10 Robux passes below. A pass can only be owned once,
 * so after buying one Ruby asks Roblox to delete it from your inventory (what "Delete from
 * Inventory" on roblox.com does); a pass you still own is simply left out of the next round-up.
 */
import { purchaseGamePass } from "./api";
import { rbx } from "./ipc";
import { t } from "./i18n";

export const RUBY_UNIVERSE_ID = 9935553407;

export const SUPPORTER_PASSES = [
  { id: 2087858354, name: "Ruby Supporter", price: 25 },
  { id: 2087888346, name: "Ruby Supporter+", price: 100 },
  { id: 2088074335, name: "Ruby Patron", price: 500 },
  { id: 2088836345, name: "Ruby Legend", price: 1000 },
] as const;

/** Prices here are only a fallback: the live price and sale status come from Roblox each time. */
export const ROUND_UP_PASSES = [
  { id: 2089184338, price: 10 },
  { id: 2089478333, price: 5 },
  { id: 2089526339, price: 2 },
  { id: 2089940327, price: 1 },
] as const;

type PassInfo = { PriceInRobux?: number | null; IsForSale?: boolean; ProductId?: number; Creator?: { CreatorTargetId?: number } };
const passInfo = (id: number) => rbx<PassInfo>(`https://apis.roblox.com/game-passes/v1/game-passes/${id}/product-info`);

type Pass = { id: number; price: number };

/**
 * The fewest passes from `passes` adding up to at least `amount` (the exact amount when it can
 * be made, otherwise the smallest total above it). Empty when nothing reaches it.
 */
export function roundUpPlan(amount: number, passes: readonly Pass[] = ROUND_UP_PASSES): Pass[] {
  const want = Math.max(0, Math.floor(amount));
  if (!want) return [];
  let best: Pass[] = [];
  let bestSum = Infinity;
  for (let mask = 1; mask < 1 << passes.length; mask++) {
    const pick = passes.filter((_, i) => mask & (1 << i));
    const sum = pick.reduce((n, x) => n + x.price, 0);
    if (sum >= want && (sum < bestSum || (sum === bestSum && pick.length < best.length))) {
      best = pick;
      bestSum = sum;
    }
  }
  return best;
}

const OFFER_KEY = "ruby.roundUpOffer";
export function roundUpOffered(): boolean {
  try {
    return localStorage.getItem(OFFER_KEY) !== "0";
  } catch {
    return true;
  }
}
export function setRoundUpOffered(on: boolean) {
  try {
    localStorage.setItem(OFFER_KEY, on ? "1" : "0");
  } catch {
    /* preference only */
  }
}

export const RUBY_GROUP_ID = 708310485;
export const PASS_PAGE = (id: number) => `https://www.roblox.com/game-pass/${id}`;

export type RoundUp = { passes: Pass[]; extra: number };
/** Why there's no round-up for this purchase, when there isn't one. */
export type NoRoundUp = { reason: "even" | "creator" | "owned"; owned: number[] };

const isOwned = (meId: number, passId: number) =>
  rbx<boolean>(`https://inventory.roblox.com/v1/users/${meId}/items/GamePass/${passId}/is-owned`).catch(() => true);

/** What rounding `price` up would cost, using only passes you don't own right now. */
export async function roundUpOffer(price: number, meId: number): Promise<RoundUp | NoRoundUp | null> {
  if (price <= 0) return null;
  const want = Math.ceil(price / 10) * 10 - price;
  if (want <= 0) return { reason: "even", owned: [] };
  const [owned, live] = await Promise.all([
    Promise.all(ROUND_UP_PASSES.map((p) => isOwned(meId, p.id))),
    Promise.all(ROUND_UP_PASSES.map((p) => passInfo(p.id).catch(() => null))),
  ]);
  const usable = ROUND_UP_PASSES.flatMap((p, i) => {
    const info = live[i];
    const price = info?.PriceInRobux ?? 0;
    return owned[i] !== true && info?.IsForSale && price > 0 ? [{ id: p.id, price }] : [];
  });
  const passes = roundUpPlan(want, usable.sort((a, b) => b.price - a.price));
  if (passes.length) return { passes, extra: passes.reduce((n, p) => n + p.price, 0) };
  // Roblox counts Ruby Crystal's owner as owning every pass the group sells.
  const group = await rbx<{ owner?: { userId?: number } }>(`https://groups.roblox.com/v1/groups/${RUBY_GROUP_ID}`).catch(() => null);
  if (group?.owner?.userId === meId) return { reason: "creator", owned: [] };
  return { reason: "owned", owned: ROUND_UP_PASSES.filter((_, i) => owned[i] === true).map((p) => p.id) };
}

export const isRoundUp = (r: RoundUp | NoRoundUp | null | undefined): r is RoundUp => !!r && "passes" in r;

/** Removes a pass from your inventory so it can be bought again. Best effort. */
async function deletePass(passId: number) {
  await rbx("https://www.roblox.com/game-pass/revoke", {
    method: "POST",
    body: `id=${passId}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  }).catch(() => undefined);
}

/**
 * Buys the round-up passes. Prices are re-checked by Roblox, so a changed price fails instead
 * of overcharging. Returns what was paid and any pass still owned afterwards (so it couldn't be
 * cleared for next time and has to be deleted on roblox.com).
 */
export async function buyRoundUp(r: RoundUp, meId: number): Promise<{ paid: number; stuck: number[] }> {
  let paid = 0;
  const stuck: number[] = [];
  for (const p of r.passes) {
    const info = await passInfo(p.id);
    if (info.PriceInRobux !== p.price) throw new Error(t("A round-up pass changed price, so the round-up was skipped."));
    await purchaseGamePass({ id: p.id, name: "Round up", price: p.price, productId: info.ProductId ?? null, sellerId: info.Creator?.CreatorTargetId ?? null, owned: false });
    paid += p.price;
    await deletePass(p.id);
    if ((await isOwned(meId, p.id)) === true) stuck.push(p.id);
  }
  return { paid, stuck };
}
