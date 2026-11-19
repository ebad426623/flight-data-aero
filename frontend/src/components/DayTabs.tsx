import { dayMonthLabel, weekdayLabel } from "../lib/dates";
import { formatPrice, getPrice, getSecondaryPrice } from "../lib/format";
import type { Currency, RouteDaySummary } from "../lib/types";
import { WHOLE_WEEK } from "../lib/urlState";
import { cellTooltip } from "./cellTooltip";
import { Spinner } from "./Spinner";

interface Props {
  days: RouteDaySummary[];
  selected: string;
  onSelect: (day: string) => void;
  currency?: Currency;
}

function Subheading({ d, currency }: { d: RouteDaySummary; currency: Currency }) {
  const price = getPrice(d, currency);
  if (price != null) return <>{formatPrice(price, d.is_partial, currency, getSecondaryPrice(d))}</>;
  if (d.status === "pending" || d.loading) return <Spinner />;
  if (d.status === "error") return <span className="text-amber-600">⚠</span>;
  if (d.status === "past") return <>past</>;
  if (d.status === "not_on_sale") return <>not on sale</>;
  return <>—</>;
}

export function DayTabs({ days, selected, onSelect, currency = "TRY" }: Props) {
  const tab = (key: string, active: boolean, children: React.ReactNode, title?: string) => (
    <button
      key={key}
      type="button"
      role="tab"
      aria-selected={active}
      title={title}
      onClick={() => onSelect(key)}
      className={`min-w-20 rounded-t-md border-b-2 px-3 py-1.5 text-center text-sm ${
        active ? "border-sky-600 bg-white font-medium" : "border-transparent text-slate-600 hover:bg-white/60"
      }`}
    >
      {children}
    </button>
  );

  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-slate-200">
      {days.map((d) =>
        tab(
          d.date,
          d.date === selected,
          <>
            <span className="block">
              {weekdayLabel(d.date)} {dayMonthLabel(d.date)}
            </span>
            <span className={`block text-xs tabular-nums ${d.is_stale ? "text-slate-400" : "text-slate-500"}`}>
              <Subheading d={d} currency={currency} />
            </span>
          </>,
          cellTooltip(d),
        ),
      )}
      {tab(
        WHOLE_WEEK,
        selected === WHOLE_WEEK,
        <>
          <span className="block">Whole week</span>
          <span className="block text-xs text-slate-500">all 7 days</span>
        </>,
      )}
    </div>
  );
}
