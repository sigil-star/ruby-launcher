import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type MouseEvent } from "react";
import { limitedInfo, type LimitedInfo, type LimitedKind } from "../lib/limiteds";
import { DEMAND, TREND, useRolimons } from "../lib/rolimons";
import { win } from "../lib/ipc";
import { Robux, Skel } from "./ui";
import { fmtDate, fmtNum, t } from "../lib/i18n";

const kindHelp = (k: LimitedKind): string =>
  k === "Limited U"
    ? t("A fixed number of numbered copies. Tradable.")
    : k === "Limited"
      ? t("Copies were sold until it went limited; no serial numbers. Tradable.")
      : t("A creator's Limited with a fixed number of numbered copies. Tradable once its hold ends.");

export function LimitedBadge({ kind, small }: { kind: LimitedKind | null; small?: boolean }) {
  if (!kind) return null;
  return (
    <span className={`limited-badge ${kind === "Limited U" ? "u" : kind === "UGC Limited" ? "ugc" : ""} ${small ? "small" : ""}`} title={kindHelp(kind)}>
      {kind === "Limited U" ? (
        <>
          {t("Limited")} <b>U</b>
        </>
      ) : (
        kind
      )}
    </span>
  );
}

const day = 86_400_000;
const RANGES = [
  { id: "3m", label: "3M", days: 92 },
  { id: "6m", label: "6M", days: 183 },
  { id: "1y", label: "1Y", days: 366 },
  { id: "all", label: "All", days: Infinity },
] as const;
const fmtDay = (ms: number) => fmtDate(new Date(ms), { month: "short", day: "numeric", year: "numeric" });
const compactNum = (n: number) => fmtNum(n, { notation: "compact", maximumFractionDigits: 1 });

function PriceChart({ info }: { info: LimitedInfo }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("1y");
  const [hover, setHover] = useState<number | null>(null);
  const pts = useMemo(() => {
    const days = RANGES.find((r) => r.id === range)!.days;
    const end = info.historyEnds ?? 0;
    return info.points.filter((p) => end - p.date <= days * day);
  }, [info, range]);

  if (info.points.length < 2) return <div className="muted small">{t("Roblox has no sale history for this item.")}</div>;

  const W = 640, H = 200, VOL = 40, PAD = 6;
  const min = Math.min(...pts.map((p) => p.price));
  const max = Math.max(...pts.map((p) => p.price));
  const maxVol = Math.max(1, ...pts.map((p) => p.volume));
  const t0 = pts[0]?.date ?? 0, t1 = pts[pts.length - 1]?.date ?? 1;
  const x = (ms: number) => PAD + ((ms - t0) / Math.max(1, t1 - t0)) * (W - PAD * 2);
  const y = (v: number) => PAD + (1 - (v - min) / Math.max(1, max - min)) * (H - VOL - PAD * 3);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.price).toFixed(1)}`).join("");
  const area = `${line}L${x(t1).toFixed(1)},${H - VOL - PAD}L${x(t0).toFixed(1)},${H - VOL - PAD}Z`;
  const barW = Math.max(1, (W - PAD * 2) / Math.max(1, pts.length) - 1);
  const h = hover != null ? pts[hover] : null;

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const at = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].date - at) < Math.abs(pts[best].date - at)) best = i;
    setHover(best);
  };

  return (
    <div className="lim-chart">
      <div className="lim-chart-head">
        <span className="small">
          {h ? (
            <>
              <b>{fmtDay(h.date)}</b> · {t("average")} <Robux amount={h.price} size={12} /> · {t("{n} sold", { n: h.volume })}
            </>
          ) : (
            <span className="muted">{t("Average sale price and daily sales")}</span>
          )}
        </span>
        <div className="segmented small">
          {RANGES.map((r) => (
            <button key={r.id} className={range === r.id ? "active" : ""} onClick={() => setRange(r.id)}>
              {r.id === "all" ? t("All") : r.label}
            </button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="lim-svg" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={t("Price history chart")}>
        <path d={area} className="lim-area" />
        <path d={line} className="lim-line" vectorEffect="non-scaling-stroke" />
        {pts.map((p, i) => (
          <rect key={p.date} x={x(p.date) - barW / 2} y={H - (p.volume / maxVol) * VOL} width={barW} height={(p.volume / maxVol) * VOL} className={`lim-vol ${hover === i ? "on" : ""}`} />
        ))}
        {h ? <line x1={x(h.date)} x2={x(h.date)} y1={0} y2={H} className="lim-cross" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      <div className="lim-axis muted tiny">
        <span>{pts.length ? fmtDay(t0) : ""}</span>
        <span>
          {compactNum(min)} – {compactNum(max)}
        </span>
        <span>{pts.length ? fmtDay(t1) : ""}</span>
      </div>
    </div>
  );
}

/** Everything a trader checks on a Limited: type, RAP, value, copies, sales and price history. */
export function LimitedStats({ assetId }: { assetId: number }) {
  const q = useQuery({ queryKey: ["limitedInfo", assetId], queryFn: () => limitedInfo(assetId), staleTime: 5 * 60_000, retry: 1 });
  const roli = useRolimons().data?.get(assetId);
  const info = q.data;
  if (q.isLoading) return <Skel h={260} r={12} />;
  if (!info) return null;
  const stale = info.historyEnds != null && Date.now() - info.historyEnds > 45 * day;

  const stats: [string, React.ReactNode, string?][] = [
    ["RAP", info.rap != null ? <Robux amount={info.rap} size={13} /> : "—", t("Recent average price: what copies have been selling for")],
    [t("Value"), roli?.valued ? <Robux amount={roli.value} size={13} /> : t("Not valued"), t("Rolimons' value")],
    [t("Demand"), roli && roli.demand >= 0 ? DEMAND(roli.demand) : "—"],
    [t("Trend"), roli && roli.trend >= 0 ? TREND(roli.trend) : "—"],
    [t("Copies"), info.copies != null ? fmtNum(info.copies) : info.kind === "Limited" ? t("Not numbered") : "—", t("How many exist")],
    [t("Remaining"), info.remaining != null ? fmtNum(info.remaining) : "—", t("Left from the original sale")],
    [t("Total sales"), info.sales != null ? fmtNum(info.sales) : "—"],
    [t("Original price"), info.originalPrice ? <Robux amount={info.originalPrice} size={13} /> : "—"],
  ];

  return (
    <section className="shelf lim-stats">
      <div className="lim-head">
        <h2 className="sub-title">{t("Limited stats")}</h2>
        <LimitedBadge kind={info.kind} />
        {roli?.projected ? <span className="flag proj" title={t("Rolimons flags its RAP as pushed above its real value")}>{t("Projected")}</span> : null}
        {roli?.hyped ? <span className="flag hyped">{t("Hyped")}</span> : null}
        {roli?.rare ? <span className="flag rare">{t("Rare")}</span> : null}
        <span style={{ flex: 1 }} />
        <button className="link small" onClick={() => void win.openExternal(`https://www.rolimons.com/item/${assetId}`)}>
          {t("Full history on Rolimons")}
        </button>
      </div>
      <dl className="lim-grid">
        {stats.map(([k, v, tip]) => (
          <div key={k} title={tip}>
            <dt className="muted tiny">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <PriceChart info={info} />
      {stale ? (
        <p className="muted tiny">
          {t("Roblox stopped publishing sale history after {date}, so the chart ends there. RAP and value above are current.", { date: fmtDay(info.historyEnds!) })}
        </p>
      ) : null}
    </section>
  );
}
