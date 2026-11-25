import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { rbx, win } from "../lib/ipc";
import { useMe, useNav } from "../app/store";
import { thousands } from "../lib/format";
import { Icon, Robux, Skel, Thumb } from "./ui";
import { t, fmtDate } from "../lib/i18n";

/* Game pass and badge popups, laid out like the item quick view. */

const fmt = (iso?: string) => (iso ? fmtDate(iso, { month: "short", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

function Shell({ onClose, media, side }: { onClose: () => void; media: ReactNode; side: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-scrim item-preview-scrim" onClick={onClose}>
      <div className="item-preview" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn item-preview-close" onClick={onClose} aria-label={t("Close")}>
          <Icon name="x-small" size={22} />
        </button>
        <div className="ip-media">{media}</div>
        <div className="item-preview-side">{side}</div>
      </div>
    </div>
  );
}

function Desc({ text }: { text?: string }) {
  const [more, setMore] = useState(false);
  if (!text?.trim()) return <dd className="muted">{t("No description.")}</dd>;
  return (
    <dd className={`ip-desc ${more ? "open" : ""}`}>
      <span>{text}</span>
      {text.length > 160 ? (
        <button className="link small" onClick={() => setMore((m) => !m)}>
          {more ? t("Show less") : t("Read more")}
        </button>
      ) : null}
    </dd>
  );
}

function GameLink({ name, universeId, onClose }: { name: string; rootPlaceId?: number; universeId?: number; onClose: () => void }) {
  const { go } = useNav();
  if (!universeId) return <dd>{name}</dd>;
  return (
    <dd>
      <button className="link" onClick={() => (onClose(), go({ name: "game", universeId }))}>
        {name}
      </button>
    </dd>
  );
}

type PassInfo = {
  Name: string;
  Description?: string;
  Created?: string;
  Updated?: string;
  PriceInRobux?: number | null;
  IsForSale?: boolean;
  Sales?: number;
  Creator?: { Name?: string; CreatorType?: string; CreatorTargetId?: number };
};

export function PassPopup({ id, owned, gameName, universeId, onBuy, onClose }: { id: number; owned: boolean; gameName?: string; universeId?: number; onBuy: () => void; onClose: () => void }) {
  const q = useQuery({ queryKey: ["passInfo", id], queryFn: () => rbx<PassInfo>(`https://apis.roblox.com/game-passes/v1/game-passes/${id}/product-info`), staleTime: 5 * 60_000 });
  const d = q.data;
  const price = d?.PriceInRobux;
  const forSale = !!d?.IsForSale && price != null;
  return (
    <Shell
      onClose={onClose}
      media={
        <>
          <Thumb type="GamePass" id={id} size="150x150" className="item-preview-image square" />
          <div className="ip-social">
            {d?.Sales ? (
              <span className="ip-fav" title={t("Copies sold")}>
                <Icon name="robux" size={16} /> {t("{n} sold", { n: d.Sales })}
              </span>
            ) : null}
            <button className="ip-report" onClick={() => win.showRobloxPage(`https://www.roblox.com/game-pass/${id}`, t("Report"))} title={t("Report this pass")}>
              <Icon name="triangle-exclamation" size={16} /> {t("Report")}
            </button>
          </div>
        </>
      }
      side={
        q.isLoading ? (
          <div className="item-details-body">
            <Skel w="80%" h={28} />
            <Skel w="40%" />
            <Skel h={44} r={10} />
          </div>
        ) : !d ? (
          <p className="muted">{t("Couldn't load this pass.")}</p>
        ) : (
          <div className="item-details-body">
            <h1 className="item-title">{d.Name}</h1>
            <div className="ip-byline">
              <span className="muted">
                {t("By")} <b>{d.Creator?.Name ?? "—"}</b>
              </span>
              {owned ? (
                <span className="ip-owned">
                  <Icon name="check" size={14} /> {t("Owned")}
                </span>
              ) : null}
            </div>
            <div className="item-price-big">{forSale ? <Robux amount={price ?? 0} size={22} /> : <span className="muted">{t("Off Sale")}</span>}</div>
            <div className="item-cta">
              <button className="btn btn-primary btn-block" disabled={owned || !forSale} onClick={onBuy}>
                {owned ? t("Owned") : forSale ? t("Buy") : t("Off Sale")}
              </button>
            </div>
            <dl className="ip-facts">
              <dt>{t("Type")}</dt>
              <dd>{t("Game Pass")}</dd>
              {gameName ? (
                <>
                  <dt>{t("For")}</dt>
                  <GameLink name={gameName} universeId={universeId} onClose={onClose} />
                </>
              ) : null}
              <dt>{t("Created")}</dt>
              <dd>{fmt(d.Created)}</dd>
              <dt>{t("Updated")}</dt>
              <dd>{fmt(d.Updated)}</dd>
              <dt>{t("Description")}</dt>
              <Desc text={d.Description} />
            </dl>
          </div>
        )
      }
    />
  );
}

type BadgeInfo = {
  name: string;
  displayName?: string;
  description?: string;
  displayDescription?: string;
  enabled?: boolean;
  created?: string;
  updated?: string;
  statistics?: { pastDayAwardedCount?: number; awardedCount?: number; winRatePercentage?: number };
  awardingUniverse?: { id: number; name: string; rootPlaceId: number };
};

export function BadgePopup({ id, userId, onClose }: { id: number; userId?: number; onClose: () => void }) {
  const me = useMe();
  const who = userId ?? me.id;
  const q = useQuery({ queryKey: ["badgeInfo", id], queryFn: () => rbx<BadgeInfo>(`https://badges.roblox.com/v1/badges/${id}`), staleTime: 5 * 60_000 });
  const earned = useQuery({
    queryKey: ["badgeAwarded", who, id],
    queryFn: () => rbx<{ data: { badgeId: number; awardedDate: string }[] }>(`https://badges.roblox.com/v1/users/${who}/badges/awarded-dates?badgeIds=${id}`).then((r) => r.data[0]?.awardedDate ?? null),
    enabled: !!who,
  });
  const d = q.data;
  const s = d?.statistics;
  const rarity = s?.winRatePercentage != null ? `${(s.winRatePercentage * 100).toFixed(1)}%` : "—";
  const mine = who === me.id;
  return (
    <Shell
      onClose={onClose}
      media={
        <>
          <Thumb type="BadgeIcon" id={id} size="150x150" className="item-preview-image square" />
          <div className="ip-social">
            <button className="ip-report" onClick={() => win.showRobloxPage(`https://www.roblox.com/badges/${id}`, t("Report"))} title={t("Report this badge")}>
              <Icon name="triangle-exclamation" size={16} /> {t("Report")}
            </button>
          </div>
        </>
      }
      side={
        q.isLoading ? (
          <div className="item-details-body">
            <Skel w="80%" h={28} />
            <Skel w="40%" />
          </div>
        ) : !d ? (
          <p className="muted">{t("Couldn't load this badge.")}</p>
        ) : (
          <div className="item-details-body">
            <h1 className="item-title">{d.displayName || d.name}</h1>
            <div className="ip-byline">
              {earned.data ? (
                <span className="ip-owned">
                  <Icon name="check" size={14} /> {mine ? t("You earned this {date}", { date: fmtDate(earned.data) }) : t("Earned {date}", { date: fmtDate(earned.data) })}
                </span>
              ) : earned.isFetched ? (
                <span className="muted small">{mine ? t("You haven't earned this yet") : t("Not earned yet")}</span>
              ) : null}
            </div>
            <dl className="ip-facts">
              <dt>{t("Type")}</dt>
              <dd>{d.enabled === false ? t("Badge (disabled)") : t("Badge")}</dd>
              {d.awardingUniverse ? (
                <>
                  <dt>{t("From")}</dt>
                  <GameLink name={d.awardingUniverse.name} universeId={d.awardingUniverse.id} rootPlaceId={d.awardingUniverse.rootPlaceId} onClose={onClose} />
                </>
              ) : null}
              <dt>{t("Rarity")}</dt>
              <dd>{rarity}</dd>
              <dt>{t("Won yesterday")}</dt>
              <dd>{thousands(s?.pastDayAwardedCount ?? 0)}</dd>
              <dt>{t("Won ever")}</dt>
              <dd>{thousands(s?.awardedCount ?? 0)}</dd>
              <dt>{t("Created")}</dt>
              <dd>{fmt(d.created)}</dd>
              <dt>{t("Updated")}</dt>
              <dd>{fmt(d.updated)}</dd>
              <dt>{t("Description")}</dt>
              <Desc text={d.displayDescription || d.description} />
            </dl>
          </div>
        )
      }
    />
  );
}
