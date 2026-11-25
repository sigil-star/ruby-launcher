import { askConfirm } from "../components/Confirm";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  acceptTrade,
  canTradeWith,
  collectibles,
  counterTrade,
  declineTrade,
  offerValue,
  sendTrade,
  statusLabel,
  TRADE_BOXES,
  tradeDetail,
  tradeList,
  type TradeBox,
  type TradeItem,
  type TradeOffer,
  type TradeOfferInput,
} from "../lib/trades";
import { searchUsers } from "../lib/api";
import { ago, thousands } from "../lib/format";
import { DEMAND, TREND, useRolimons, type RoliItem } from "../lib/rolimons";
import { TradeRisk, tradeSummary } from "../components/TradeRisk";
import { useMe, useNav, useUi } from "../app/store";
import { ErrorState, Headshot, Icon, Robux, Skel, SkeletonRows, Spinner, Thumb } from "../components/ui";
import { t, fmtDate } from "../lib/i18n";

const MAX_ITEMS = 4;

export function TradesPage({ box: initialBox }: { box?: TradeBox | "Values" }) {
  const [box, setBoxState] = useState<TradeBox | "Values">(initialBox ?? "Inbound");
  const [open, setOpen] = useState<number | null>(null);
  const { go, replace } = useNav();
  // Remember the tab in the route, so coming back from an item lands on the same tab.
  const setBox = (b: TradeBox | "Values") => {
    setBoxState(b);
    replace({ name: "trades", box: b });
  };
  const list = useInfiniteQuery({
    queryKey: ["trades", box],
    queryFn: ({ pageParam }) => tradeList(box as TradeBox, pageParam),
    enabled: box !== "Values",
    initialPageParam: null as string | null,
    getNextPageParam: (p) => p.next,
    staleTime: 15_000,
  });
  const [search, setSearch] = useState("");
  const qc = useQueryClient();
  const { toast } = useUi();
  const all = list.data?.pages.flatMap((p) => p.data) ?? [];
  const f = search.trim().toLowerCase();
  const trades = f ? all.filter((x) => x.user.name.toLowerCase().includes(f) || x.user.displayName.toLowerCase().includes(f) || String(x.id).includes(f)) : all;
  const quickDecline = async (id: number, name: string) => {
    if (!await askConfirm(box === "Outbound" ? t("Cancel your trade with {name}?", { name }) : t("Decline {name}'s trade?", { name }))) return;
    try {
      await declineTrade(id);
      toast(box === "Outbound" ? t("Trade cancelled.") : t("Trade declined."));
      qc.invalidateQueries({ queryKey: ["trades"] });
      qc.invalidateQueries({ queryKey: ["tradeCount"] });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };
  const selected = open ?? trades[0]?.id ?? null;

  return (
    <div className="page trades-page">
      <div className="trades-head">
        <h1>{t("Trades")}</h1>
        <NewTradeButton onPick={(userId) => go({ name: "trade", userId })} />
      </div>
      <div className="segmented" role="tablist">
        {TRADE_BOXES.map((b) => (
          <button key={b.id} className={box === b.id ? "active" : ""} onClick={() => (setBox(b.id), setOpen(null))}>
            {b.label()}
          </button>
        ))}
        <button className={box === "Values" ? "active" : ""} onClick={() => setBox("Values")}>
          {t("Values")}
        </button>
      </div>
      {box === "Values" ? <ValuesPanel /> : (
      <div className="trades-split">
        <div className="trades-list">
          <input className="text-input trades-search" placeholder={t("Search by username or trade #")} value={search} onChange={(e) => setSearch(e.target.value)} />
          {list.isLoading ? (
            <SkeletonRows count={6} />
          ) : list.error ? (
            <ErrorState error={list.error} retry={() => list.refetch()} />
          ) : trades.length === 0 ? (
            <div className="state">
              <Icon name="two-arrows-left-right" size={28} />
              <div className="muted">{{ Inbound: t("No inbound trades."), Outbound: t("No outbound trades."), Completed: t("No completed trades."), Inactive: t("No inactive trades.") }[box as TradeBox]}</div>
            </div>
          ) : (
            <>
              {trades.map((tr) => (
                <button key={tr.id} className={`trade-row ${selected === tr.id ? "on" : ""}`} onClick={() => setOpen(tr.id)}>
                  <Headshot userId={tr.user.id} size={40} />
                  <span className="trade-row-text">
                    <b className="ellipsis">{tr.user.displayName}</b>
                    <span className="muted small ellipsis">
                      @{tr.user.name} · {ago(tr.created)}
                    </span>
                  </span>
                  <span className={`trade-status s-${tr.status}`}>{statusLabel(tr.status)}</span>
                  {(box === "Inbound" || box === "Outbound") && tr.isActive ? (
                    <span
                      role="button"
                      tabIndex={0}
                      className="icon-btn trade-quick"
                      title={box === "Outbound" ? t("Cancel trade") : t("Decline")}
                      aria-label={box === "Outbound" ? t("Cancel trade") : t("Decline")}
                      onClick={(e) => {
                        e.stopPropagation();
                        void quickDecline(tr.id, tr.user.displayName);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.stopPropagation();
                          void quickDecline(tr.id, tr.user.displayName);
                        }
                      }}
                    >
                      <Icon name="x-small" size={16} />
                    </span>
                  ) : null}
                </button>
              ))}
              {list.hasNextPage ? (
                <button className="btn btn-secondary btn-small" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                  {list.isFetchingNextPage ? <Spinner size={16} /> : t("Load more")}
                </button>
              ) : null}
            </>
          )}
        </div>
        <div className="trades-detail">{selected ? <TradeView key={selected} id={selected} box={box as TradeBox} /> : null}</div>
      </div>
      )}
    </div>
  );
}

function TradeView({ id, box }: { id: number; box: TradeBox }) {
  const me = useMe();
  const qc = useQueryClient();
  const { toast } = useUi();
  const { go } = useNav();
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["trade", id], queryFn: () => tradeDetail(id), staleTime: 30_000 });
  const roli = useRolimons();
  if (q.isLoading) return <Skel h={320} r={14} />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const tr = q.data;
  const mine = tr.offers.find((o) => o.user.id === me.id) ?? tr.offers[0];
  const theirs = tr.offers.find((o) => o !== mine) ?? tr.offers[1];
  const give = offerValue(mine);
  const get = offerValue(theirs);

  const act = async (fn: () => Promise<unknown>, done: string, confirmText: string) => {
    if (!await askConfirm(confirmText)) return;
    setBusy(true);
    try {
      await fn();
      toast(done);
      qc.invalidateQueries({ queryKey: ["trades"] });
      qc.invalidateQueries({ queryKey: ["trade", id] });
      qc.invalidateQueries({ queryKey: ["tradeCount"] });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="trade-view card-in">
      <div className="trade-view-head">
        <Headshot userId={theirs.user.id} size={48} />
        <div className="trade-view-title">
          <b>{t("Trade with {name}", { name: theirs.user.displayName })}</b>
          <div className="muted small">
            {t("{status} · sent {ago}", { status: statusLabel(tr.status), ago: ago(tr.created) })}
            {tr.isActive && tr.expiration ? t(" · expires {date}", { date: fmtDate(tr.expiration, { dateStyle: "short", timeStyle: "medium" }) }) : ""}
          </div>
          <div className="muted tiny">
            {t("Trade #{id} · {date} · @{name}", { id: String(tr.id), date: fmtDate(tr.created, { dateStyle: "short", timeStyle: "medium" }), name: theirs.user.name })}
          </div>
        </div>
        <button className="btn btn-secondary btn-small" onClick={() => go({ name: "profile", userId: theirs.user.id })}>
          {t("Profile")}
        </button>
      </div>
      <OfferBox title={tr.isActive ? t("Items you will give") : tr.status === "Completed" || tr.status === "Finished" ? t("Items you gave") : t("Items you offered")} offer={mine} />
      <OfferBox title={tr.isActive ? t("Items you will receive") : tr.status === "Completed" || tr.status === "Finished" ? t("Items you received") : t("Items they offered")} offer={theirs} />
      <ValueBar give={give} get={get} giveV={roliValue(mine, roli.data)} getV={roliValue(theirs, roli.data)} />
      <TradeRisk give={mine} get={theirs} roli={roli.data} />
      <div className="trade-proof">
        <button
          className="link small"
          onClick={() =>
            void navigator.clipboard
              .writeText(tradeSummary(tr.id, tr.created, statusLabel(tr.status), mine, theirs, roli.data))
              .then(() => toast(t("Trade summary copied.")))
              .catch(() => toast(t("Couldn't copy the summary."), "error"))
          }
        >
          {t("Copy trade summary")}
        </button>
      </div>
      {tr.isActive ? (
        <div className="trade-actions">
          {box === "Inbound" ? (
            <>
              <button className="btn btn-primary" disabled={busy} onClick={() => act(() => acceptTrade(id), t("Trade accepted."), t("Accept this trade with {name}? This can't be undone.", { name: theirs.user.displayName }))}>
                {t("Accept")}
              </button>
              <button className="btn btn-secondary" disabled={busy} onClick={() => go({ name: "trade", userId: theirs.user.id, counterId: id })}>
                {t("Counter")}
              </button>
            </>
          ) : null}
          <button className="btn btn-secondary danger-text" disabled={busy} onClick={() => act(() => declineTrade(id), box === "Outbound" ? t("Trade cancelled.") : t("Trade declined."), box === "Outbound" ? t("Cancel this trade?") : t("Decline this trade?"))}>
            {box === "Outbound" ? t("Cancel trade") : t("Decline")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Rolimons value of one side (items valued by Rolimons, else RAP) plus Robux after fee. */
function roliValue(o: TradeOffer, m?: Map<number, RoliItem>) {
  if (!m) return null;
  return o.items.reduce((n, i) => n + (m.get(i.assetId)?.value ?? i.rap ?? 0), 0) + Math.floor(o.robux * 0.7);
}

function OfferBox({ title, offer }: { title: string; offer: TradeOffer }) {
  const roli = useRolimons();
  const v = roliValue(offer, roli.data);
  return (
    <div className="offer-box">
      <div className="offer-title">
        <b>{title}</b>
        <span className="muted small offer-totals">
          <span>
            {t("RAP")} <Robux amount={offerValue(offer)} size={12} />
          </span>
          {v != null ? (
            <span title={t("Rolimons value")}>
              {t("Value")} <Robux amount={v} size={12} />
            </span>
          ) : null}
        </span>
      </div>
      <div className="offer-items">
        {offer.items.map((i) => (
          <ItemTile key={i.userAssetId} item={i} />
        ))}
        {offer.robux ? (
          <div className="trade-item robux-tile">
            <span className="trade-item-art">
              <Icon name="robux" size={40} />
            </span>
            <b className="small">
              <Robux amount={offer.robux} size={12} />
            </b>
            <span className="tiny muted">{t("{amount} after fee", { amount: thousands(Math.floor(offer.robux * 0.7)) })}</span>
          </div>
        ) : null}
        {offer.items.length === 0 && !offer.robux ? <span className="muted small">{t("Nothing")}</span> : null}
      </div>
    </div>
  );
}

function ItemTile({ item, on, onClick, disabled }: { item: TradeItem; on?: boolean; onClick?: () => void; disabled?: boolean }) {
  const { go } = useNav();
  const r = useRolimons().data?.get(item.assetId);
  return (
    <button
      className={`trade-item ${on ? "on" : ""} ${disabled ? "dim" : ""}`}
      onClick={onClick ?? (() => go({ name: "item", itemType: "Asset", id: item.assetId }))}
      disabled={disabled}
      title={[item.name, item.originalPrice ? t("Original price {price}", { price: thousands(item.originalPrice) }) : "", item.stock ? t("Stock {stock}", { stock: thousands(item.stock) }) : "", r && r.demand >= 0 ? t("Demand: {demand}", { demand: DEMAND(r.demand) }) : "", r && r.trend >= 0 ? t("Trend: {trend}", { trend: TREND(r.trend) }) : ""].filter(Boolean).join("\n")}
    >
      <span className="trade-item-art">
        <Thumb type="Asset" id={item.assetId} size="150x150" />
        <span className="trade-flags">
          {r?.projected ? <span className="flag proj" title={t("Projected: RAP is being pushed above its real value")}>{t("Projected")}</span> : null}
          {r?.hyped ? <span className="flag hyped">{t("Hyped")}</span> : null}
          {r?.rare ? <span className="flag rare">{t("Rare")}</span> : null}
        </span>
        {item.serialNumber ? <span className="trade-serial" title={item.stock ? t("Copy #{serial} of {stock}", { serial: String(item.serialNumber), stock: thousands(item.stock) }) : undefined}>#{item.serialNumber}{item.stock ? <span className="muted"> / {thousands(item.stock)}</span> : null}</span> : null}
        {item.onHold ? <span className="trade-hold">{t("On hold")}</span> : null}
      </span>
      <span className="small ellipsis">{item.name}</span>
      <span className="tiny muted">
        {t("RAP")} <Robux amount={item.rap ?? 0} size={11} />
      </span>
      {r?.valued ? (
        <span className="tiny trade-val">
          {t("Value")} <Robux amount={r.value} size={11} />
        </span>
      ) : null}
      {r && r.demand >= 0 ? <span className={`tiny demand d${r.demand}`}>{t("{demand} demand", { demand: DEMAND(r.demand) })}</span> : null}
    </button>
  );
}

function ValueBar({ give, get, giveV, getV }: { give: number; get: number; giveV?: number | null; getV?: number | null }) {
  const diff = get - give;
  const vd = giveV != null && getV != null ? getV - giveV : null;
  return (
    <div className="value-bar">
      <span>
        {t("You give")} <Robux amount={give} size={13} />
      </span>
      <span className={diff > 0 ? "pos" : diff < 0 ? "neg" : "muted"}>
        {diff === 0 ? t("Even") : t("{amount} RAP", { amount: `${diff > 0 ? "+" : "−"}${thousands(Math.abs(diff))}` })}
        {vd != null ? (
          <span className={`vb-value ${vd > 0 ? "pos" : vd < 0 ? "neg" : "muted"}`}>
            {vd === 0 ? t("Even value") : t("{amount} value", { amount: `${vd > 0 ? "+" : "−"}${thousands(Math.abs(vd))}` })}
          </span>
        ) : null}
      </span>
      <span>
        {t("You get")} <Robux amount={get} size={13} />
      </span>
    </div>
  );
}

function NewTradeButton({ onPick }: { onPick: (userId: number) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const res = useQuery({ queryKey: ["tradeUserSearch", text], queryFn: () => searchUsers(text), enabled: open && text.trim().length >= 3, staleTime: 60_000 });
  return (
    <div className="menu-anchor">
      <button className="btn btn-primary btn-small" onClick={() => setOpen((o) => !o)}>
        {t("New trade")}
      </button>
      {open ? (
        <div className="menu trade-search">
          <input className="input" autoFocus placeholder={t("Search a username")} value={text} onChange={(e) => setText(e.target.value)} />
          {(res.data ?? []).map((u) => (
            <button key={u.id} onClick={() => (setOpen(false), onPick(u.id))}>
              <Headshot userId={u.id} size={28} /> {u.displayName} <span className="muted small">@{u.name}</span>
            </button>
          ))}
          {res.isFetching ? <Spinner size={16} /> : null}
        </div>
      ) : null}
    </div>
  );
}

export function TradeComposer({ userId, counterId }: { userId: number; counterId?: number }) {
  const me = useMe();
  const { back, go } = useNav();
  const { toast } = useUi();
  const qc = useQueryClient();
  const can = useQuery({ queryKey: ["canTradeWith", userId], queryFn: () => canTradeWith(userId), staleTime: 60_000 });
  const mineInv = useQuery({ queryKey: ["collectibles", me.id], queryFn: () => collectibles(me.id!), enabled: !!me.id, staleTime: 60_000 });
  const theirInv = useQuery({ queryKey: ["collectibles", userId], queryFn: () => collectibles(userId), staleTime: 60_000 });
  const counter = useQuery({ queryKey: ["trade", counterId], queryFn: () => tradeDetail(counterId!), enabled: !!counterId });
  const [give, setGive] = useState<number[] | null>(null);
  const [get, setGet] = useState<number[] | null>(null);
  const [giveRobux, setGiveRobux] = useState(0);
  const [getRobux, setGetRobux] = useState(0);
  const [busy, setBusy] = useState(false);

  // A counter starts from the original offer.
  const seededGive = give ?? counter.data?.offers.find((o) => o.user.id === me.id)?.items.map((i) => i.userAssetId) ?? [];
  const seededGet = get ?? counter.data?.offers.find((o) => o.user.id !== me.id)?.items.map((i) => i.userAssetId) ?? [];

  const pick = (list: number[], set: (v: number[]) => void, id: number) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : list.length >= MAX_ITEMS ? list : [...list, id]);

  const sum = (inv: TradeItem[] | undefined, ids: number[]) => (inv ?? []).filter((i) => ids.includes(i.userAssetId)).reduce((n, i) => n + (i.rap ?? 0), 0);
  const roliMap = useRolimons().data;
  const giveRap = sum(mineInv.data, seededGive);
  const getRap = sum(theirInv.data, seededGet);
  // Roblox caps Robux at half the value of the items on that side.
  const giveMax = Math.floor(giveRap / 2);
  const getMax = Math.floor(getRap / 2);
  const valid = seededGive.length > 0 && seededGet.length > 0 && giveRobux <= giveMax && getRobux <= getMax;

  const submit = async () => {
    if (!me.id || !valid) return;
    if (!await askConfirm(counterId ? t("Send this counter offer?") : t("Send this trade request?"))) return;
    const offers: [TradeOfferInput, TradeOfferInput] = [
      { userId: me.id, userAssetIds: seededGive, robux: giveRobux },
      { userId, userAssetIds: seededGet, robux: getRobux },
    ];
    setBusy(true);
    try {
      if (counterId) await counterTrade(counterId, offers);
      else await sendTrade(offers);
      toast(counterId ? t("Counter offer sent.") : t("Trade request sent."));
      qc.invalidateQueries({ queryKey: ["trades"] });
      go({ name: "trades", box: "Outbound" });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const blocked = can.data && !can.data.canTrade;
  return (
    <div className="page trade-compose">
      <div className="trades-head">
        <button className="icon-btn" onClick={back} aria-label={t("Back")}>
          <Icon name="chevron-small-left" size={22} />
        </button>
        <Headshot userId={userId} size={40} />
        <h1>{counterId ? t("Counter offer") : t("New trade")}</h1>
      </div>
      {blocked ? (
        <div className="notice error">{t("You can't trade with this person ({reason}).", { reason: can.data!.status.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase() })}</div>
      ) : null}
      <div className="compose-grid">
        <InventoryPicker title={t("Your items")} q={mineInv} picked={seededGive} onPick={(id) => pick(seededGive, setGive, id)} />
        <InventoryPicker title={t("Their items")} q={theirInv} picked={seededGet} onPick={(id) => pick(seededGet, setGet, id)} />
      </div>
      <div className="compose-summary">
        <RobuxInput label={t("Add your Robux")} value={giveRobux} max={giveMax} onChange={setGiveRobux} />
        <RobuxInput label={t("Request Robux")} value={getRobux} max={getMax} onChange={setGetRobux} />
        <ValueBar give={giveRap + Math.floor(giveRobux * 0.7)} get={getRap + Math.floor(getRobux * 0.7)} />
        <TradeRisk
          give={{ items: (mineInv.data ?? []).filter((i) => seededGive.includes(i.userAssetId)), robux: giveRobux }}
          get={{ items: (theirInv.data ?? []).filter((i) => seededGet.includes(i.userAssetId)), robux: getRobux }}
          roli={roliMap}
        />
        <button className="btn btn-primary" disabled={!valid || busy || !!blocked} onClick={submit}>
          {busy ? <Spinner size={18} /> : counterId ? t("Send counter") : t("Send request")}
        </button>
      </div>
      <p className="muted tiny">{t("Pick up to {n} Limiteds on each side. Robux can be at most half the value of that side's items, and Roblox keeps 30% of traded Robux.", { n: MAX_ITEMS })}</p>
    </div>
  );
}

function InventoryPicker({
  title,
  q,
  picked,
  onPick,
}: {
  title: string;
  q: { data?: TradeItem[]; isLoading: boolean; error: unknown; refetch: () => unknown };
  picked: number[];
  onPick: (id: number) => void;
}) {
  const [filter, setFilter] = useState("");
  const items = useMemo(() => (q.data ?? []).filter((i) => i.name.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => (b.rap ?? 0) - (a.rap ?? 0)), [q.data, filter]);
  return (
    <div className="inv-picker">
      <div className="offer-title">
        <b>{title}</b>
        <span className="muted small">
          {t("{picked}/{max} picked", { picked: picked.length, max: MAX_ITEMS })}
        </span>
      </div>
      <input className="input" placeholder={t("Filter")} value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="inv-picker-grid">
        {q.isLoading ? (
          Array.from({ length: 8 }, (_, i) => <Skel key={i} h={150} r={12} />)
        ) : q.error ? (
          <ErrorState error={q.error} retry={() => q.refetch()} />
        ) : items.length === 0 ? (
          <span className="muted small">{filter ? t("No tradable Limiteds match.") : t("No tradable Limiteds.")}</span>
        ) : (
          items.map((i) => (
            <ItemTile key={i.userAssetId} item={i} on={picked.includes(i.userAssetId)} disabled={i.onHold || (!picked.includes(i.userAssetId) && picked.length >= MAX_ITEMS)} onClick={() => onPick(i.userAssetId)} />
          ))
        )}
      </div>
    </div>
  );
}

function RobuxInput({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (n: number) => void }) {
  return (
    <label className="robux-input">
      <span className="small muted">
        {t("{label} (max {max})", { label, max: thousands(max) })}
      </span>
      <span className="robux-input-box">
        <Icon name="robux" size={16} />
        <input type="number" min={0} max={max} value={value || ""} placeholder="0" onChange={(e) => onChange(Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0))))} />
      </span>
    </label>
  );
}

function ValuesPanel() {
  const roli = useRolimons();
  const [tab, setTab] = useState<"trending" | "projected" | "top">("trending");
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const all = [...(roli.data?.values() ?? [])];
    const f = q.trim().toLowerCase();
    let l = f ? all.filter((i) => i.name.toLowerCase().includes(f) || i.acronym.toLowerCase() === f) : all;
    // A search covers every item, whichever tab is open.
    if (f) l = l.sort((a, b) => b.value - a.value);
    else if (tab === "trending") l = l.filter((i) => i.trend === 3 || i.hyped || i.demand >= 3).sort((a, b) => b.demand - a.demand || b.value - a.value);
    else if (tab === "projected") l = l.filter((i) => i.projected).sort((a, b) => b.rap - a.rap);
    else l = l.sort((a, b) => b.value - a.value);
    return l.slice(0, 120);
  }, [roli.data, tab, q]);
  if (roli.isLoading) return <SkeletonRows count={8} />;
  if (roli.error) return <ErrorState error={roli.error} retry={() => roli.refetch()} />;
  return (
    <div className="values-panel">
      <div className="values-bar">
        <div className="segmented small">
          <button className={tab === "trending" ? "active" : ""} onClick={() => setTab("trending")}>{t("In demand")}</button>
          <button className={tab === "projected" ? "active" : ""} onClick={() => setTab("projected")}>{t("Projected")}</button>
          <button className={tab === "top" ? "active" : ""} onClick={() => setTab("top")}>{t("Most valuable")}</button>
        </div>
        <input className="text-input" placeholder={t("Search items")} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted tiny">{t("Values from Rolimons")}</span>
      </div>
      <div className="values-list">
        <div className="values-row head muted tiny">
          <span />
          <span>{t("Item")}</span>
          <span>{t("RAP")}</span>
          <span>{t("Value")}</span>
          <span>{t("Demand")}</span>
          <span>{t("Trend")}</span>
        </div>
        {list.map((i) => (
          <ValueRow key={i.id} i={i} />
        ))}
        {!list.length ? <div className="muted small state">{q ? t("No items match that search.") : t("Rolimons hasn't flagged any items here right now.")}</div> : null}
      </div>
    </div>
  );
}

function ValueRow({ i }: { i: RoliItem }) {
  const { go } = useNav();
  return (
    <button className="values-row" onClick={() => go({ name: "item", itemType: "Asset", id: i.id })}>
      <span className="values-art">
        <Thumb type="Asset" id={i.id} size="150x150" />
      </span>
      <span className="values-name">
        <b className="ellipsis">{i.name}</b>
        <span className="trade-flags inline">
          {i.acronym ? <span className="muted tiny">{i.acronym}</span> : null}
          {i.projected ? <span className="flag proj">{t("Projected")}</span> : null}
          {i.hyped ? <span className="flag hyped">{t("Hyped")}</span> : null}
          {i.rare ? <span className="flag rare">{t("Rare")}</span> : null}
        </span>
      </span>
      <span><Robux amount={i.rap} size={12} /></span>
      <span>{i.valued ? <Robux amount={i.value} size={12} /> : <span className="muted">—</span>}</span>
      <span className={`demand d${i.demand}`}>{i.demand >= 0 ? DEMAND(i.demand) : "—"}</span>
      <span className="muted">{i.trend >= 0 ? TREND(i.trend) : "—"}</span>
    </button>
  );
}
