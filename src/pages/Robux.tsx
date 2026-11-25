import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { robuxPage, robuxTotals, type BonusItem, type RobuxPackage, type TimeFrame } from "../lib/robux";
import { useGameThumb } from "../lib/thumbs";
import { transactions, type Transaction } from "../lib/account";
import { ago, compact } from "../lib/format";
import { win } from "../lib/ipc";
import { useMe, useNav } from "../app/store";
import { useItemPreview } from "../components/ItemPreview";
import { Select, ErrorState, Icon, Skel, SkeletonRows, Thumb } from "../components/ui";
import { t, fmtNum } from "../lib/i18n";

/** Real-money checkout stays on roblox.com: payment details never go through Ruby. */
const BUY_URL = "https://www.roblox.com/upgrades/robux";

/** One bonus, like roblox.com: the game's art behind, the item's icon, game and item name. */
function BonusCard({ b, i }: { b: BonusItem; i: number }) {
  const { go } = useNav();
  const banner = useGameThumb(b.universeId ?? undefined);
  return (
    <button
      className="rx-bonus-card card-in"
      style={{ animationDelay: `${i * 40}ms` }}
      onClick={() => b.universeId && go({ name: "game", universeId: b.universeId })}
      title={`${b.name} · ${b.experience}`}
    >
      {banner ? <img className="rx-bonus-bg" src={banner} alt="" draggable={false} /> : <span className="rx-bonus-bg skel" />}
      <span className="rx-bonus-shade" />
      <span className="rx-bonus-body">
        <span className="rx-bonus-icon">
          {b.passId ? <Thumb type="GamePass" id={b.passId} className="round" /> : b.universeId ? <Thumb type="GameIcon" id={b.universeId} className="round" /> : <Icon name="tag-sparkle" size={28} />}
        </span>
        <span className="rx-bonus-text">
          <span className="rx-bonus-game">
            {b.universeId ? <Thumb type="GameIcon" id={b.universeId} className="rx-bonus-game-icon" /> : null}
            <b className="ellipsis">{b.experience}</b>
          </span>
          <span className="rx-bonus-name ellipsis">{b.name}</span>
        </span>
      </span>
    </button>
  );
}

function PackageCard({ p, i }: { p: RobuxPackage; i: number }) {
  return (
    <button className={`rx-card card-in ${p.popular ? "popular" : ""}`} style={{ animationDelay: `${i * 30}ms` }} onClick={() => win.showRobloxPage(BUY_URL, t("Buy Robux"))}>
      {p.popular ? <span className="rx-badge">{t("Popular")}</span> : null}
      <span className="rx-card-amount">
        <Icon name="robux" size={22} />
        {fmtNum(p.robux)}
      </span>
      {p.bonus > 0 ? (
        <span className="rx-card-bonus">
          <s>{fmtNum(p.base)}</s> {t("+{n} bonus", { n: p.bonus })}
        </span>
      ) : (
        <span className="rx-card-bonus">&nbsp;</span>
      )}
      <span className={`btn ${p.popular ? "btn-primary" : "btn-secondary"} rx-card-price`}>{p.price}</span>
    </button>
  );
}

function SidePanel() {
  const me = useMe();
  const { go } = useNav();
  const [frame, setFrame] = useState<TimeFrame>("Month");
  const totals = useQuery({ queryKey: ["robuxTotals", me.id, frame], queryFn: () => robuxTotals(me.id, frame) });
  const tot = totals.data;
  return (
    <aside className="rx-side">
      <div className="rx-panel rx-balance-card">
        <span className="muted small">{t("Your balance")}</span>
        <span className="rx-balance-big">
          <Icon name="robux" size={26} />
          <span className="pii">{fmtNum(me.robux ?? 0)}</span>
        </span>
        <div className="rx-side-actions">
          <button className="btn btn-secondary btn-small" onClick={() => win.showRobloxPage(BUY_URL, t("Buy Robux"))}>
            {t("Send")}
          </button>
          <button className="btn btn-secondary btn-small" onClick={() => go({ name: "web", url: "https://www.roblox.com/redeem", title: t("Redeem a card") })}>
            {t("Redeem card")}
          </button>
        </div>
      </div>
      <div className="rx-panel">
        <div className="row-between">
          <b>{t("Summary")}</b>
          <Select
            value={frame}
            onChange={setFrame}
            options={[
              { value: "Day" as TimeFrame, label: t("24 hours") },
              { value: "Week" as TimeFrame, label: t("Week") },
              { value: "Month" as TimeFrame, label: t("Month") },
              { value: "Year" as TimeFrame, label: t("Year") },
            ]}
          />
        </div>
        {totals.isLoading ? (
          <Skel h={64} r={10} />
        ) : tot ? (
          <div className="rx-mini-stats">
            <div>
              <span className="muted small">{t("In")}</span>
              <b className="pos">+{compact(tot.incomingRobuxTotal)}</b>
            </div>
            <div>
              <span className="muted small">{t("Out")}</span>
              <b className="neg">−{compact(Math.abs(tot.outgoingRobuxTotal))}</b>
            </div>
            <div>
              <span className="muted small">{t("Pending")}</span>
              <b>{compact(tot.pendingRobuxTotal)}</b>
            </div>
          </div>
        ) : (
          <p className="muted small">{t("Summary unavailable.")}</p>
        )}
      </div>
    </aside>
  );
}

function Activity() {
  const me = useMe();
  const { go } = useNav();
  const preview = useItemPreview();
  const [type, setType] = useState<"Purchase" | "Sale" | "CurrencyPurchase">("Purchase");
  const [all, setAll] = useState(false);
  const q = useQuery({ queryKey: ["transactions", me.id, type], queryFn: () => transactions(me.id, type) });
  const label = (tx: Transaction) => tx.details?.name ?? tx.agent?.name ?? "—";
  const rows = (q.data ?? []).slice(0, all ? undefined : 5);
  return (
    <section className="rx-panel rx-activity">
      <div className="row-between">
        <b>{t("Recent activity")}</b>
        <div className="segmented small">
          {(
            [
              ["Purchase", t("Spent")],
              ["Sale", t("Earned")],
              ["CurrencyPurchase", t("Bought")],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={type === k ? "active" : ""} onClick={() => setType(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {q.isLoading ? (
        <SkeletonRows count={4} avatar={32} />
      ) : rows.length ? (
        <div className="rx-history">
          {rows.map((tx, i) => {
            const asset = tx.details?.type === "Asset" && tx.details.id ? tx.details.id : null;
            return (
              <button key={tx.id ?? i} className="rx-tx row-in" style={{ animationDelay: `${i * 25}ms` }} onClick={() => asset && preview({ itemType: "Asset", id: asset })}>
                {asset ? <Thumb type="Asset" id={asset} className="rx-thumb" /> : <span className="rx-thumb rx-icon"><Icon name="robux" size={16} /></span>}
                <span className="rx-tx-text">
                  <b className="ellipsis">{label(tx)}</b>
                  <span className="muted small">
                    {ago(tx.created)}
                    {tx.isPending ? ` · ${t("Pending")}` : ""}
                  </span>
                </span>
                <span className={`rx-tx-amt ${tx.currency.amount < 0 ? "neg" : "pos"}`}>
                  {tx.currency.amount < 0 ? "−" : "+"}
                  {fmtNum(Math.abs(tx.currency.amount))}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="muted small">{t("Nothing here yet.")}</p>
      )}
      <div className="rx-activity-foot">
        {(q.data?.length ?? 0) > 5 ? (
          <button className="link small" onClick={() => setAll((a) => !a)}>
            {all ? t("Show less") : t("Show all {n}", { n: q.data!.length })}
          </button>
        ) : (
          <span />
        )}
        <button className="link small" onClick={() => go({ name: "settings" })}>
          {t("Robux settings")}
        </button>
      </div>
    </section>
  );
}

/** Built at render time so it follows the current language. */
const faqItems = (): [string, string][] => [
  [t("What are Robux?"), t("Roblox's currency, for avatar items, game passes, private servers and more.")],
  [t("Where are my Robux?"), t("Purchases usually arrive within minutes. Robux from sales stay pending for a few days before they're released.")],
  [t("Do Robux expire?"), t("No. They stay on your account until you spend them.")],
  [t("How do I redeem a gift card?"), t("Use Redeem card. Your balance here updates on its own.")],
];

export function RobuxPage() {
  const [faq, setFaq] = useState<number | null>(null);
  const q = useQuery({ queryKey: ["robuxPage"], queryFn: robuxPage, staleTime: 10 * 60_000 });
  const d = q.data;
  return (
    <div className="page robux-page">
      <div className="rx-layout">
        <main className="rx-main">
          {q.isLoading ? (
            <>
              <Skel w="55%" h={34} />
              <div className="rx-grid">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skel key={i} h={150} r={14} />
                ))}
              </div>
            </>
          ) : q.error || !d ? (
            <ErrorState error={q.error} retry={() => q.refetch()} />
          ) : (
            <>
              <h1 className="rx-hero">{d.bonusPercent ? t("Enjoy up to {pct}% more Robux", { pct: d.bonusPercent }) : t("Buy Robux")}</h1>
              {d.bonusItems.length ? (
                <section className="rx-bonuses">
                  <h2 className="sub-title">{d.bonusItems.length > 1 ? t("Bonus items we picked for you") : t("Bonus item we picked for you")}</h2>
                  <div className="rx-bonus-row hscroll">
                    {d.bonusItems.map((b, i) => (
                      <BonusCard key={`${b.rootPlaceId}-${b.name}`} b={b} i={i} />
                    ))}
                  </div>
                  <p className="muted small">{t("Included free with eligible packages below.")}</p>
                </section>
              ) : null}
              <div className="rx-grid">
                {d.picked.map((p, i) => (
                  <PackageCard key={p.productId} p={p} i={i} />
                ))}
              </div>
              {d.packages.length ? (
                <>
                  <h2 className="sub-title rx-sub">{t("More packages")}</h2>
                  <div className="rx-grid">
                    {d.packages.map((p, i) => (
                      <PackageCard key={p.productId} p={p} i={i} />
                    ))}
                  </div>
                </>
              ) : null}
              <p className="muted small rx-note">{t("Buying opens Roblox's secure checkout.")}</p>
            </>
          )}
          <Activity />
          <details className="rx-faq-box">
            <summary>{t("FAQ")}</summary>
            {faqItems().map(([qn, a], i) => (
              <div key={qn} className="rx-faq">
                <button className="rx-faq-q" onClick={() => setFaq(faq === i ? null : i)}>
                  <span>{qn}</span>
                  <Icon name={faq === i ? "minus-small" : "plus-small"} size={18} />
                </button>
                {faq === i ? <p className="muted rx-faq-a">{a}</p> : null}
              </div>
            ))}
          </details>
        </main>
        <SidePanel />
      </div>
    </div>
  );
}
