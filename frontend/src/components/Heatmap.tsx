import { useState } from "react";
import { dayMonthLabel, weekdayLabel } from "../lib/dates";
import { formatPrice, getPrice, getSecondaryPrice } from "../lib/format";
import { priceColor } from "../lib/heatmap";
import type { Currency, RouteDaySummary, WeekSummary } from "../lib/types";
import { cellTooltip } from "./cellTooltip";
import { Spinner } from "./Spinner";

interface Props {
  week: WeekSummary;
  selectedGroup: string | null;
  selectedDay: string;
  onSelect: (groupId: string, day: string) => void;
  currency?: Currency;
}

const COLLAPSE_KEY = "heatmap-collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function CellContent({ d, currency }: { d: RouteDaySummary; currency: Currency }) {
  const price = getPrice(d, currency);
  if (price != null) {
    return (
      <span className="flex items-center justify-center gap-1">
        <span className="tabular-nums">{formatPrice(price, d.is_partial, currency, getSecondaryPrice(d))}</span>
        {d.loading && <Spinner className="h-2 w-2" />}
      </span>
    );
  }
  switch (d.status) {
    case "past":
      return <span className="text-xs">past</span>;
    case "not_on_sale":
      return <span className="text-xs">not on sale</span>;
    case "error":
      return <span className="text-amber-600">⚠</span>;
    case "empty":
      return <span>{d.is_partial ? "—*" : "—"}</span>;
    default:
      return <Spinner />;
  }
}

function cellClass(d: RouteDaySummary): string {
  const base = "h-9 w-full rounded text-sm transition-shadow hover:ring-2 hover:ring-sky-300";
  if (d.status === "past" || d.status === "not_on_sale")
    return `${base} cursor-default bg-[repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9_4px,#e2e8f0_4px,#e2e8f0_8px)] text-slate-400`;
  if (d.status === "error" && d.cheapest_price == null) return `${base} bg-amber-50 border border-amber-200`;
  if (d.status === "empty") return `${base} bg-slate-100 text-slate-400`;
  if (d.status === "pending" && d.cheapest_price == null) return `${base} bg-slate-50`;
  return `${base} ${d.is_stale ? "border border-dashed border-slate-500 opacity-70" : ""}`;
}

export function Heatmap({ week, selectedGroup, selectedDay, onSelect, currency = "TRY" }: Props) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !c;
    });
  };

  return (
    <section className="border-b border-slate-200 bg-white px-4 py-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Heatmap · cheapest per airport and day
        </h2>
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={toggle}
          className="rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100"
        >
          {collapsed ? "Show ▾" : "Hide ▴"}
        </button>
      </div>
      {!collapsed && (
        <div className="mt-1 overflow-x-auto">
          <table className="w-full min-w-[640px] table-fixed border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="w-32" />
                {week.dates.map((d) => (
                  <th key={d} className="text-xs font-medium text-slate-500">
                    {weekdayLabel(d)} <span className="font-normal">{dayMonthLabel(d)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {week.groups.map((g) => (
                <tr key={g.group_id}>
                  <th
                    scope="row"
                    className={`truncate pr-2 text-left text-sm font-normal ${g.group_id === selectedGroup ? "font-semibold text-sky-700" : ""}`}
                  >
                    {g.name}
                  </th>
                  {g.days.map((d) => {
                    const selected = g.group_id === selectedGroup && d.date === selectedDay;
                    const inactive = d.status === "past" || d.status === "not_on_sale";
                    return (
                      <td key={d.date}>
                        <button
                          type="button"
                          disabled={inactive}
                          title={cellTooltip(d, g.name)}
                          onClick={() => onSelect(g.group_id, d.date)}
                          style={{
                            backgroundColor: priceColor(d.cheapest_price, week.min_price, week.max_price),
                          }}
                          className={`${cellClass(d)} ${selected ? "ring-2 ring-sky-600" : ""}`}
                        >
                          <CellContent d={d} currency={currency} />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-slate-400">
            * partial (overview search) · dashed = stale · ⚠ fetch failed · — no flights
          </p>
        </div>
      )}
    </section>
  );
}
