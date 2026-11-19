import { formatPrice, getPrice, getSecondaryPrice, PARTIAL_TOOLTIP } from "../lib/format";
import type { CitySort } from "../lib/urlState";
import type { Currency, GroupWeek } from "../lib/types";
import { Spinner } from "./Spinner";

interface Props {
  groups: GroupWeek[];
  selected: string | null;
  sort: CitySort;
  onSort: (s: CitySort) => void;
  onSelect: (groupId: string) => void;
  currency?: Currency;
}

export function sortGroups(groups: GroupWeek[], sort: CitySort): GroupWeek[] {
  const copy = [...groups];
  if (sort === "alpha") return copy.sort((a, b) => a.name.localeCompare(b.name));
  return copy.sort((a, b) => {
    if (a.cheapest_price == null && b.cheapest_price == null) return a.name.localeCompare(b.name);
    if (a.cheapest_price == null) return 1;
    if (b.cheapest_price == null) return -1;
    return a.cheapest_price - b.cheapest_price;
  });
}

function GroupPrice({ g, currency }: { g: GroupWeek; currency: Currency }) {
  const loading = g.days.some((d) => d.loading);
  const partial = g.days.some((d) => d.is_partial && d.cheapest_price === g.cheapest_price);
  const price = getPrice(g, currency);
  if (price != null) {
    return (
      <span className="flex items-center gap-1.5" title={partial ? PARTIAL_TOOLTIP : undefined}>
        {loading && <Spinner />}
        <span className="font-semibold tabular-nums">{formatPrice(price, partial, currency, getSecondaryPrice(g))}</span>
      </span>
    );
  }
  if (loading || g.status === "pending") return <Spinner />;
  if (g.status === "error") {
    const err = g.days.find((d) => d.error)?.error ?? "Fetch failed";
    return (
      <span className="text-amber-600" title={err}>
        ⚠
      </span>
    );
  }
  return <span className="text-slate-400">—</span>;
}

export function CitySidebar({ groups, selected, sort, onSort, onSelect, currency = "TRY" }: Props) {
  const sorted = sortGroups(groups, sort);
  const priced = groups.filter((g) => g.cheapest_price != null);
  const cheapest = priced.length
    ? Math.min(...priced.map((g) => g.cheapest_price as number))
    : null;

  return (
    <aside className="border-b border-slate-200 bg-white md:w-60 md:shrink-0 md:overflow-auto md:border-r md:border-b-0">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Turkey airports</h2>
        <div role="group" aria-label="Sort cities" className="flex text-xs">
          {(["price", "alpha"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={sort === s}
              onClick={() => onSort(s)}
              className={`rounded px-1.5 py-0.5 ${sort === s ? "bg-slate-200 font-medium" : "text-slate-500 hover:bg-slate-100"}`}
            >
              {s === "price" ? "Price" : "A–Z"}
            </button>
          ))}
        </div>
      </div>
      <ul className="grid grid-cols-2 gap-px pb-2 sm:grid-cols-4 md:grid-cols-1">
        {sorted.map((g) => {
          const isCheapest = cheapest != null && g.cheapest_price === cheapest;
          const isSelected = g.group_id === selected;
          return (
            <li key={g.group_id}>
              <button
                type="button"
                aria-current={isSelected ? "true" : undefined}
                onClick={() => onSelect(g.group_id)}
                title={g.airports.join(", ")}
                className={`flex w-full items-center justify-between gap-2 border-l-4 px-3 py-1.5 text-left text-sm ${
                  isSelected
                    ? "border-sky-600 bg-sky-50 font-medium"
                    : "border-transparent hover:bg-slate-50"
                } ${isCheapest && !isSelected ? "bg-emerald-50" : ""}`}
              >
                <span className="truncate">{g.name}</span>
                <GroupPrice g={g} currency={currency} />
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
