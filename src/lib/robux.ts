import { rbx } from "./ipc";
import { t } from "./i18n";

export type RobuxPackage = {
  productId: string;
  /** What you get (incl. any bonus). */
  robux: number;
  /** The amount without the computer/web bonus. */
  base: number;
  bonus: number;
  price: string;
  popular: boolean;
};

export type RobuxPage = {
  /** e.g. 25 → "Enjoy up to 25% more Robux". */
  bonusPercent: number;
  picked: RobuxPackage[];
  packages: RobuxPackage[];
  /** "Bonus items we picked for you": game passes that come free with the top packages. */
  bonusItems: BonusItem[];
  pendingTransfers: number;
};

export type BonusItem = { name: string; experience: string; rootPlaceId: number; universeId: number | null; passId: number | null };

type RawBonusMeta = { rootPlaceId?: string; gamePassDisplayName?: string; experienceDisplayName?: string; gamePassId?: string | number; id?: string | number };

type RawProduct = {
  productId: string;
  robuxAmount: string;
  nonPromotionalPlatformRobuxAmount?: string;
  bonusRobuxAmount?: string;
  isCallToAction?: boolean;
  price?: { amount?: { units?: string; nanos?: number; currencyCode?: string }; currencySymbol?: string };
};

function toPackage(p: RawProduct): RobuxPackage {
  const units = Number(p.price?.amount?.units ?? 0);
  const cents = Math.round((p.price?.amount?.nanos ?? 0) / 1e7);
  const robux = Number(p.robuxAmount);
  const base = Number(p.nonPromotionalPlatformRobuxAmount ?? p.robuxAmount);
  return {
    productId: p.productId,
    robux,
    base,
    bonus: Number(p.bonusRobuxAmount ?? robux - base),
    price: `${p.price?.currencySymbol ?? "$"}${units}.${String(cents).padStart(2, "0")}`,
    popular: !!p.isCallToAction,
  };
}

/**
 * Roblox renders the packages into the page itself (`#robux-redesign-page[data-buy-robux-page]`),
 * so read them from there: same packages, prices, bonuses and currency the website shows you.
 */
export async function robuxPage(): Promise<RobuxPage> {
  const html = await rbx<string>("https://www.roblox.com/upgrades/robux");
  const doc = new DOMParser().parseFromString(typeof html === "string" ? html : "", "text/html");
  const raw = doc.getElementById("robux-redesign-page")?.getAttribute("data-buy-robux-page");
  if (!raw) throw new Error(t("Couldn't load Robux packages."));
  const j = JSON.parse(raw) as {
    pageHeaderMetadata?: { promotionalRobuxPercentage?: string };
    sections?: {
      sectionType?: string;
      products?: RawProduct[];
      personalizedBonus?: { bonuses?: { gamePassMetadata?: RawBonusMeta }[] };
      transfers?: { pendingTransfers?: unknown[] };
    }[];
  };
  const sections = j.sections ?? [];
  const withProducts = sections.filter((s) => s.products?.length);
  // Every bonus on offer (Roblox often runs several at once), with each game's universe for art.
  const metas = (sections.find((s) => s.personalizedBonus)?.personalizedBonus?.bonuses ?? [])
    .map((b) => b.gamePassMetadata)
    .filter((m): m is RawBonusMeta => !!m?.gamePassDisplayName);
  const bonusItems: BonusItem[] = await Promise.all(
    metas.map(async (m) => {
      const rootPlaceId = Number(m.rootPlaceId ?? 0);
      const universeId = rootPlaceId
        ? await rbx<{ universeId: number }>(`https://apis.roblox.com/universes/v1/places/${rootPlaceId}/universe`).then((r) => r.universeId ?? null).catch(() => null)
        : null;
      const passId = Number(m.gamePassId ?? m.id ?? 0) || null;
      return { name: m.gamePassDisplayName!, experience: m.experienceDisplayName ?? "", rootPlaceId, universeId, passId };
    }),
  );
  return {
    bonusPercent: Number(j.pageHeaderMetadata?.promotionalRobuxPercentage ?? 0),
    picked: (withProducts[0]?.products ?? []).map(toPackage),
    packages: (withProducts[1]?.products ?? []).map(toPackage),
    bonusItems,
    pendingTransfers: sections.find((s) => s.transfers)?.transfers?.pendingTransfers?.length ?? 0,
  };
}

export type RobuxTotals = {
  salesTotal: number;
  purchasesTotal: number;
  groupPayoutsTotal: number;
  currencyPurchasesTotal: number;
  premiumStipendsTotal: number;
  premiumPayoutsTotal: number;
  affiliateSalesTotal: number;
  tradeSystemEarningsTotal: number;
  tradeSystemCostsTotal: number;
  developerExchangeTotal: number;
  pendingRobuxTotal: number;
  incomingRobuxTotal: number;
  outgoingRobuxTotal: number;
};

export type TimeFrame = "Day" | "Week" | "Month" | "Year";

export const robuxTotals = (userId: number, timeFrame: TimeFrame) =>
  rbx<RobuxTotals>(`https://economy.roblox.com/v2/users/${userId}/transaction-totals?timeFrame=${timeFrame}&transactionType=summary`);
