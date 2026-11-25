import type { TradeItem, TradeOffer } from "../lib/trades";
import { DEMAND, type RoliItem } from "../lib/rolimons";
import { fmtDate, fmtNum, t } from "../lib/i18n";

type Side = { items: TradeItem[]; robux: number };
type Level = "low" | "medium" | "high";
type Note = { level: Level; text: string };

const value = (s: Side, m?: Map<number, RoliItem>) =>
  s.items.reduce((n, i) => n + (m?.get(i.assetId)?.value ?? i.rap ?? 0), 0) + Math.floor(s.robux * 0.7);

/** What a careful trader checks before accepting: value, projected RAP, demand, holds and fees. */
export function tradeRisks(give: Side, get: Side, m?: Map<number, RoliItem>): { level: Level; notes: Note[] } {
  const notes: Note[] = [];
  const gv = value(give, m);
  const rv = value(get, m);
  if (gv > 0 && rv < gv) {
    const pct = Math.round(((gv - rv) / gv) * 100);
    notes.push({ level: pct >= 20 ? "high" : pct >= 5 ? "medium" : "low", text: t("You give {pct}% more value than you get ({diff} by Rolimons value, or RAP where unvalued).", { pct, diff: gv - rv }) });
  }
  for (const i of get.items) {
    const r = m?.get(i.assetId);
    if (r?.projected) notes.push({ level: "high", text: t("{name} is projected: its RAP has been pushed above what it really sells for.", { name: i.name }) });
    if (r && r.demand >= 0 && r.demand <= 1) notes.push({ level: "medium", text: t("{name} has {demand} demand, so it may be hard to trade away.", { name: i.name, demand: DEMAND(r.demand).toLowerCase() }) });
    if (i.onHold) notes.push({ level: "medium", text: t("{name} is on hold and can't be traded again for a while.", { name: i.name }) });
  }
  for (const i of give.items) {
    const r = m?.get(i.assetId);
    if (r?.rare) notes.push({ level: "medium", text: t("You're giving {name}, which Rolimons marks as rare.", { name: i.name }) });
  }
  if (give.robux) notes.push({ level: "low", text: t("Roblox takes 30% of the Robux you add: they receive {n}.", { n: Math.floor(give.robux * 0.7) }) });
  if (!give.items.length && !get.items.length && !give.robux && !get.robux) return { level: "low", notes: [] };
  const level: Level = notes.some((n) => n.level === "high") ? "high" : notes.some((n) => n.level === "medium") ? "medium" : "low";
  return { level, notes };
}

export function TradeRisk({ give, get, roli }: { give: Side; get: Side; roli?: Map<number, RoliItem> }) {
  const { level, notes } = tradeRisks(give, get, roli);
  if (!notes.length && !give.items.length && !get.items.length) return null;
  return (
    <div className={`trade-risk ${level}`}>
      <b>{level === "high" ? t("High risk") : level === "medium" ? t("Check this trade") : t("Looks fair")}</b>
      {notes.length ? (
        <ul>
          {notes.map((n, i) => (
            <li key={i} className={n.level}>
              {n.text}
            </li>
          ))}
        </ul>
      ) : (
        <span className="muted small"> {t("Nothing stands out. Values come from Rolimons and can change.")}</span>
      )}
    </div>
  );
}

/** A plain-text record of a trade, for keeping or sharing as proof. */
export function tradeSummary(id: number, created: string, status: string, mine: TradeOffer, theirs: TradeOffer, m?: Map<number, RoliItem>) {
  const side = (o: TradeOffer) =>
    [
      ...o.items.map((i) => {
        const r = m?.get(i.assetId);
        return `  - ${i.name}${i.serialNumber ? ` #${i.serialNumber}` : ""} (RAP ${fmtNum(i.rap ?? 0)}${r?.valued ? `, ${t("value {n}", { n: r.value })}` : ""})`;
      }),
      ...(o.robux ? [`  - ${t("{n} Robux ({after} after Roblox's fee)", { n: o.robux, after: Math.floor(o.robux * 0.7) })}`] : []),
    ].join("\n") || `  - ${t("nothing")}`;
  return [
    t("Roblox trade #{id} · {status} · {date}", { id: String(id), status, date: fmtDate(new Date(created), { dateStyle: "medium", timeStyle: "short" }) }),
    t("{name} (@{user}) gives:", { name: mine.user.displayName, user: mine.user.name }),
    side(mine),
    t("{name} (@{user}) gives:", { name: theirs.user.displayName, user: theirs.user.name }),
    side(theirs),
    t("Value: {mine} for {theirs} (Rolimons value, RAP where unvalued)", { mine: value(mine, m), theirs: value(theirs, m) }),
  ].join("\n");
}
