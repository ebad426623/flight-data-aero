import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { Fragment, useMemo, useState } from "react";
import { dayMonthLabel, weekdayLabel } from "../lib/dates";
import { BAG_LABEL, formatDuration, formatPrice, formatStamp, getPrice, getSecondaryPrice, localDate, localTime } from "../lib/format";
import type { BagStatus, Currency, Direction, FlightOption } from "../lib/types";
import type { SortDir } from "../lib/urlState";
import { computeHighlights } from "./flightHighlights";

interface Props {
  flights: FlightOption[];
  direction: Direction;
  currency?: Currency;
  showDate: boolean;
  sort: { id: string; dir: SortDir };
  onSort: (s: { id: string; dir: SortDir }) => void;
}

const BAG_STYLE: Record<BagStatus, string> = {
  included: "text-emerald-600",
  fee: "text-amber-600",
  unknown: "text-slate-300",
};

function BagIcons({ f }: { f: FlightOption }) {
  if (!f.baggage) return <span className="text-slate-400">—</span>;
  const { carry_on, checked } = f.baggage;
  return (
    <span className="flex gap-1.5" aria-label={`Carry-on ${BAG_LABEL[carry_on]}, checked ${BAG_LABEL[checked]}`}>
      <span className={BAG_STYLE[carry_on]} title={`Carry-on: ${BAG_LABEL[carry_on]}`}>
        👜
      </span>
      <span className={BAG_STYLE[checked]} title={`Checked bag: ${BAG_LABEL[checked]}`}>
        🧳
      </span>
    </span>
  );
}

const dash = <span className="text-slate-400">—</span>;

function buildColumns(direction: Direction, currency: Currency, showDate: boolean): ColumnDef<FlightOption>[] {
  const turkeyAirport = (f: FlightOption) => (direction === "from_tr" ? f.origin_airport : f.destination_airport);
  const cols: ColumnDef<FlightOption>[] = [
    {
      id: "turkey_airport",
      header: "Turkey airport",
      accessorFn: turkeyAirport,
      cell: (c) => <span className="font-mono">{c.getValue<string>()}</span>,
    },
    {
      id: "departure",
      header: "Departure",
      accessorFn: (f) => f.departure_local,
      cell: ({ row: { original: f } }) => (
        <span className="tabular-nums">
          {localTime(f.departure_local)} <span className="text-xs text-slate-500">{f.origin_airport}</span>
        </span>
      ),
    },
    {
      id: "arrival",
      header: "Arrival",
      accessorFn: (f) => f.arrival_local,
      cell: ({ row: { original: f } }) => (
        <span className="tabular-nums">
          {localTime(f.arrival_local)}
          {f.arrival_day_offset > 0 && (
            <sup className="ml-0.5 text-xs font-semibold text-rose-600">+{f.arrival_day_offset}</sup>
          )}{" "}
          <span className="text-xs text-slate-500">{f.destination_airport}</span>
        </span>
      ),
    },
    {
      id: "duration",
      header: "Duration",
      accessorFn: (f) => f.duration_minutes ?? undefined,
      sortUndefined: "last",
      cell: (c) => formatDuration(c.row.original.duration_minutes),
    },
    {
      id: "stops",
      header: "Stops",
      accessorFn: (f) => f.stops,
      cell: ({ row: { original: f } }) =>
        f.stops === 0 ? (
          <span className="text-emerald-700">Direct</span>
        ) : (
          <span title={f.layovers.map((l) => l.airport).join(", ")}>
            {f.stops} · <span className="text-xs text-slate-500">{f.layovers.map((l) => l.airport).join(", ")}</span>
          </span>
        ),
    },
    {
      id: "airlines",
      header: "Airlines",
      accessorFn: (f) => f.airlines.join(", "),
      cell: (c) => c.getValue<string>() || dash,
    },
    {
      id: "price",
      header: "Price",
      accessorFn: (f) => getPrice(f, currency) ?? undefined,
      sortUndefined: "last",
      cell: (c) => <span className="font-semibold tabular-nums">{formatPrice(getPrice(c.row.original, currency), false, currency, getSecondaryPrice(c.row.original))}</span>,
    },
    {
      id: "bags",
      header: "Bags",
      accessorFn: (f) =>
        f.baggage ? [f.baggage.carry_on, f.baggage.checked].filter((s) => s === "included").length : undefined,
      sortUndefined: "last",
      cell: (c) => <BagIcons f={c.row.original} />,
    },
  ];
  if (showDate) {
    cols.unshift({
      id: "date",
      header: "Date",
      accessorFn: (f) => f.departure_local,
      cell: ({ row: { original: f } }) => {
        const d = localDate(f.departure_local);
        return (
          <span className="whitespace-nowrap">
            {weekdayLabel(d)} {dayMonthLabel(d)}
          </span>
        );
      },
    });
  }
  return cols;
}

function YesNo({ v }: { v: boolean | null }) {
  return v == null ? dash : <>{v ? "Yes" : "No"}</>;
}

function FlightDetails({ f }: { f: FlightOption }) {
  return (
    <div className="grid gap-x-8 gap-y-2 px-4 py-3 text-sm sm:grid-cols-2">
      <div>
        <h4 className="mb-1 text-xs font-semibold text-slate-500 uppercase">Layovers</h4>
        {f.layovers.length === 0 ? (
          <p>Direct flight</p>
        ) : (
          <ul className="space-y-0.5">
            {f.layovers.map((l, i) => (
              <li key={i}>
                <span className="font-mono">{l.airport}</span> · {formatDuration(l.duration_minutes)}
                {l.overnight && <span className="ml-2 rounded bg-indigo-100 px-1 text-xs text-indigo-700">overnight</span>}
                {l.airport_change && (
                  <span className="ml-2 rounded bg-rose-100 px-1 text-xs text-rose-700">airport change</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-slate-500">Flight numbers</dt>
        <dd>{f.flight_numbers?.join(", ") || dash}</dd>
        <dt className="text-slate-500">Aircraft</dt>
        <dd>{f.aircraft?.join(", ") || dash}</dd>
        <dt className="text-slate-500">Self-transfer</dt>
        <dd>
          <YesNo v={f.is_self_transfer} />
        </dd>
        <dt className="text-slate-500">Baggage</dt>
        <dd>
          {f.baggage
            ? `Carry-on ${BAG_LABEL[f.baggage.carry_on]}, checked ${BAG_LABEL[f.baggage.checked]}`
            : dash}
          {f.baggage?.raw && <span className="block text-xs text-slate-500">{f.baggage.raw}</span>}
        </dd>
        <dt className="text-slate-500">Provider</dt>
        <dd>{f.provider}</dd>
        <dt className="text-slate-500">Fetched</dt>
        <dd>{formatStamp(f.fetched_at)}</dd>
      </dl>
    </div>
  );
}

export function FlightTable({ flights, direction, currency = "TRY", showDate, sort, onSort }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const columns = useMemo(() => buildColumns(direction, currency, showDate), [direction, currency, showDate]);
  const highlights = useMemo(() => computeHighlights(flights), [flights]);
  // Must be referentially stable: a new array each render makes the sorted row
  // model recompute every render, which (with TanStack's auto-reset of table
  // state) re-renders again, in an endless loop.
  const sorting: SortingState = useMemo(
    () => [{ id: sort.id, desc: sort.dir === "desc" }],
    [sort.id, sort.dir],
  );

  const table = useReactTable({
    data: flights,
    columns,
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const first = next[0];
      onSort(first ? { id: first.id, dir: first.desc ? "desc" : "asc" } : { id: "price", dir: "asc" });
    },
    getRowId: (f) => f.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableSortingRemoval: false,
    autoResetAll: false, // no pagination/expansion state to reset
    sortDescFirst: false,
  });

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="sticky top-0 z-10 bg-slate-100 text-left text-xs text-slate-600">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const dir = h.column.getIsSorted();
                return (
                  <th
                    key={h.id}
                    aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
                    className="px-3 py-2 font-medium"
                  >
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-slate-900"
                      onClick={h.column.getToggleSortingHandler()}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      <span className="w-3 text-slate-400">{dir === "asc" ? "▲" : dir === "desc" ? "▼" : ""}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const f = row.original;
            const isOpen = expanded.has(f.id);
            const isCheapest = highlights.cheapest.has(f.id);
            const isShortest = highlights.shortest.has(f.id);
            return (
              <Fragment key={row.id}>
                <tr
                  onClick={() => toggle(f.id)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle(f.id))}
                  tabIndex={0}
                  aria-expanded={isOpen}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-sky-50/60 ${
                    isCheapest ? "bg-emerald-50/70" : isShortest ? "bg-indigo-50/60" : "bg-white"
                  }`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-1.5 align-top">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      {cell.column.id === "price" && (isCheapest || isShortest) && (
                        <span className="mt-0.5 flex gap-1">
                          {isCheapest && (
                            <span className="rounded bg-emerald-100 px-1 text-[10px] text-emerald-800">cheapest</span>
                          )}
                          {isShortest && (
                            <span className="rounded bg-indigo-100 px-1 text-[10px] text-indigo-800">shortest</span>
                          )}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
                {isOpen && (
                  <tr className="bg-slate-50">
                    <td colSpan={row.getVisibleCells().length}>
                      <FlightDetails f={f} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
