import { useQuery } from "@tanstack/react-query";
import { call } from "./ipc";
import { t } from "./i18n";

/** One item as Rolimons rates it. `value` falls back to RAP when Rolimons hasn't valued it. */
export type RoliItem = {
  id: number;
  name: string;
  acronym: string;
  rap: number;
  value: number;
  valued: boolean;
  demand: number; // -1 none, 0 terrible … 4 amazing
  trend: number; // -1 none, 0 lowering … 4 fluctuating
  projected: boolean;
  hyped: boolean;
  rare: boolean;
};

/** Demand label for a Rolimons demand index (0..4); translated at call time. */
export const DEMAND = (i: number) => [t("Terrible"), t("Low"), t("Normal"), t("High"), t("Amazing")][i];
/** Trend label for a Rolimons trend index (0..4); translated at call time. */
export const TREND = (i: number) => [t("Lowering"), t("Unstable"), t("Stable"), t("Raising"), t("Fluctuating")][i];

type Raw = [string, string, number, number, number, number, number, number, number, number];

async function load(): Promise<Map<number, RoliItem>> {
  const raw = await call<Record<string, Raw>>("rolimonsItems");
  const m = new Map<number, RoliItem>();
  for (const [id, r] of Object.entries(raw ?? {})) {
    const valued = r[3] > 0;
    m.set(Number(id), {
      id: Number(id),
      name: r[0],
      acronym: r[1],
      rap: r[2],
      value: valued ? r[3] : r[4] > 0 ? r[4] : r[2],
      valued,
      demand: r[5],
      trend: r[6],
      projected: r[7] === 1,
      hyped: r[8] === 1,
      rare: r[9] === 1,
    });
  }
  return m;
}

/** Rolimons' whole item table, shared and refreshed every 5 minutes. */
export const useRolimons = () => useQuery({ queryKey: ["rolimons"], queryFn: load, staleTime: 5 * 60_000, retry: 1 });
