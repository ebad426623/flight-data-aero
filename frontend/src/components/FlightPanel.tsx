import { useMutation } from "@tanstack/react-query";
import { useMemo } from "react";
import { useDayFlights, useWeekFlights } from "../hooks/queries";
import type { ViewParams } from "../lib/api";
import { api } from "../lib/api";
import { expiresIn, formatStamp, PARTIAL_TOOLTIP } from "../lib/format";
import type { CacheMeta, Currency, Direction, FetchJob, GroupWeek } from "../lib/types";
import { type SortDir, WHOLE_WEEK } from "../lib/urlState";
import { DayTabs } from "./DayTabs";
import { FlightTable } from "./FlightTable";
import { Spinner } from "./Spinner";

interface Props {
  view: ViewParams;
  group: GroupWeek;
  foreignLabel: string;
  currency: Currency;
  day: string;
  sort: { id: string; dir: SortDir };
  onDay: (day: string) => void;
  onSort: (s: { id: string; dir: SortDir }) => void;
  /** Hands refresh jobs to the fetch queue (they run ahead of everything else). */
  onRefreshJobs: (jobs: FetchJob[]) => void;
}

function MetaLine({ meta }: { meta: CacheMeta }) {
  if (!meta.fetched_at) return null;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span>
        Fetched {formatStamp(meta.fetched_at)} · {expiresIn(meta.expires_at)}
      </span>
      {meta.is_stale && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-800">stale</span>}
      {meta.is_partial && (
        <span className="rounded bg-slate-200 px-1.5 text-xs" title={PARTIAL_TOOLTIP}>
          partial
        </span>
      )}
      {meta.providers.length > 0 && <span className="text-xs text-slate-400">via {meta.providers.join(", ")}</span>}
    </span>
  );
}

function EmptyState({ meta }: { meta: CacheMeta | undefined }) {
  const msg = (() => {
    switch (meta?.status) {
      case "past":
        return "This date is in the past.";
      case "not_on_sale":
        return "Not yet on sale (more than ~330 days out).";
      case "error":
        return `Couldn't fetch flights: ${meta.error ?? "unknown error"}. Will retry in 15 minutes, or press Refresh day.`;
      case "empty":
        return meta.is_partial
          ? "No flights in the overview search. Selecting this city loads the full list."
          : "No flights found for this day.";
      default:
        return null;
    }
  })();
  return (
    <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
      {msg ?? (
        <>
          <Spinner /> Loading flights…
        </>
      )}
    </div>
  );
}

function weekMeta(days: { meta: CacheMeta }[]): CacheMeta | undefined {
  const fetched = days.map((d) => d.meta).filter((m) => m.fetched_at);
  if (fetched.length === 0) return days[0]?.meta;
  const oldest = fetched.reduce((a, b) => (a.fetched_at! < b.fetched_at! ? a : b));
  const soonest = fetched.reduce((a, b) => (a.expires_at! < b.expires_at! ? a : b));
  return {
    ...oldest,
    expires_at: soonest.expires_at,
    is_stale: fetched.some((m) => m.is_stale),
    is_partial: fetched.some((m) => m.is_partial),
    providers: [...new Set(fetched.flatMap((m) => m.providers))],
    status: days.some((d) => d.meta.status === "ok") ? "ok" : oldest.status,
  };
}

export function routeTitle(direction: Direction, groupName: string, foreignLabel: string): string {
  return direction === "from_tr" ? `${groupName} → ${foreignLabel}` : `${foreignLabel} → ${groupName}`;
}

export function FlightPanel({ view, group, foreignLabel, currency, day, sort, onDay, onSort, onRefreshJobs }: Props) {
  const isWeek = day === WHOLE_WEEK;
  const dayQ = useDayFlights(view, group.group_id, day);
  const weekQ = useWeekFlights(view, group.group_id, isWeek);

  const refreshDay = useMutation({
    mutationFn: () => api.refreshDay(view, group.group_id, day),
    onSuccess: ({ jobs }) => onRefreshJobs(jobs),
  });

  const flights = useMemo(
    () => (isWeek ? (weekQ.data?.days.flatMap((d) => d.flights) ?? []) : (dayQ.data?.flights ?? [])),
    [isWeek, weekQ.data, dayQ.data],
  );
  const meta = isWeek ? (weekQ.data ? weekMeta(weekQ.data.days) : undefined) : dayQ.data?.meta;
  const daySummary = group.days.find((d) => d.date === day);
  const error = (isWeek ? weekQ.error : dayQ.error) as Error | null;

  return (
    <section className="flex flex-col">
      <div className="px-4 pt-3">
        <h2 className="text-lg font-semibold">{routeTitle(view.direction, group.name, foreignLabel)}</h2>
      </div>
      <div className="px-4">
        <DayTabs days={group.days} selected={day} onSelect={onDay} currency={currency} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm text-slate-600">
        {meta ? <MetaLine meta={meta} /> : <span />}
        <span className="flex items-center gap-2">
          {meta?.error && meta.status !== "error" && (
            <span className="text-xs text-amber-700" title={meta.error}>
              ⚠ last refresh failed
            </span>
          )}
          {!isWeek && daySummary?.loading && <Spinner />}
          {!isWeek && (
            <button
              type="button"
              disabled={refreshDay.isPending || daySummary?.status === "past" || daySummary?.status === "not_on_sale"}
              onClick={() => refreshDay.mutate()}
              className="rounded border border-slate-300 bg-white px-2 py-0.5 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              Refresh day
            </button>
          )}
        </span>
      </div>
      <div className="px-4 pb-4">
        {error ? (
          <p className="p-6 text-sm text-rose-600">Failed to load flights: {error.message}</p>
        ) : flights.length > 0 ? (
          <div className="rounded-md border border-slate-200 bg-white">
            <FlightTable flights={flights} direction={view.direction} currency={currency} showDate={isWeek} sort={sort} onSort={onSort} />
          </div>
        ) : (
          <EmptyState meta={meta} />
        )}
      </div>
    </section>
  );
}
