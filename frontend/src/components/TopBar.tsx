import { useAirportSearch } from "../hooks/queries";
import { addDays, rangeLabel, weekDates } from "../lib/dates";
import type { Currency, Direction, QueueProgress, Status } from "../lib/types";
import { AirportPicker, airportLabel } from "./AirportPicker";
import { Brand } from "./Logo";
import { Spinner } from "./Spinner";

interface Props {
  direction: Direction;
  currency: Currency;
  foreign: string;
  center: string;
  progress: QueueProgress;
  status: Status | undefined;
  onDirection: (d: Direction) => void;
  onCurrency: (c: Currency) => void;
  onForeign: (iata: string) => void;
  onCenter: (date: string) => void;
  onRefreshWeek: () => void;
  onOpenSettings: () => void;
}

export function TopBar(props: Props) {
  const { direction, currency, foreign, center } = props;
  const { data: current } = useAirportSearch(foreign);
  const place = airportLabel(
    current?.find((a) => a.iata === foreign),
    foreign,
  );
  const isFromTurkey = direction === "from_tr";

  return (
    <header className="border-b border-slate-200 bg-white px-4 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Brand />
        <div
          role="group"
          aria-label="Direction"
          className="inline-flex overflow-hidden rounded-md border border-slate-300 text-sm"
        >
          <button
            type="button"
            aria-pressed={isFromTurkey}
            onClick={() => props.onDirection("from_tr")}
            className={`px-3 py-1 font-medium ${isFromTurkey ? "bg-sky-600 text-white" : "bg-white hover:bg-slate-50 text-slate-700"}`}
          >
            From Turkey ▸
          </button>
          <button
            type="button"
            aria-pressed={!isFromTurkey}
            onClick={() => props.onDirection("to_tr")}
            className={`px-3 py-1 font-medium ${!isFromTurkey ? "bg-sky-600 text-white" : "bg-white hover:bg-slate-50 text-slate-700"}`}
          >
            ◂ To Turkey
          </button>
        </div>

        {/* Currency Options: TL (TRY) and PKR */}
        <div
          role="group"
          aria-label="Currency option"
          className="inline-flex overflow-hidden rounded-md border border-slate-300 text-sm"
        >
          {(["TRY", "PKR", "BOTH"] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={currency === c}
              onClick={() => props.onCurrency(c)}
              title={c === "TRY" ? "Turkish Lira (₺)" : c === "PKR" ? "Pakistani Rupee (₨)" : "Show both TL and PKR"}
              className={`px-2.5 py-1 text-xs font-semibold ${
                currency === c ? "bg-emerald-600 text-white" : "bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {c === "TRY" ? "TL (₺)" : c === "PKR" ? "PKR (₨)" : "Both"}
            </button>
          ))}
        </div>

        <AirportPicker value={foreign} onChange={props.onForeign} />

        <span className="text-sm text-slate-500">
          {isFromTurkey ? `From Turkey to ${place}` : `From ${place} to Turkey`}
        </span>

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous week"
            className="rounded px-2 py-1 hover:bg-slate-100"
            onClick={() => props.onCenter(addDays(center, -7))}
          >
            ◂
          </button>
          <span className="min-w-44 text-center text-sm font-medium">
            {rangeLabel(weekDates(center))}
          </span>
          <button
            type="button"
            aria-label="Next week"
            className="rounded px-2 py-1 hover:bg-slate-100"
            onClick={() => props.onCenter(addDays(center, 7))}
          >
            ▸
          </button>
          <input
            type="date"
            aria-label="Centre date"
            className="ml-1 rounded-md border border-slate-300 px-1.5 py-0.5 text-sm"
            value={center}
            onChange={(e) => e.target.value && props.onCenter(e.target.value)}
          />
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            title="Re-fetch this week's prices"
            className="flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-50"
            onClick={props.onRefreshWeek}
          >
            <span aria-hidden="true">⟳</span> Refresh week
          </button>
          <button
            type="button"
            aria-label="Settings"
            title="Settings"
            className="rounded px-2 py-1 text-lg hover:bg-slate-100"
            onClick={props.onOpenSettings}
          >
            ⚙
          </button>
        </div>
      </div>
      <StatusLine progress={props.progress} status={props.status} />
    </header>
  );
}

function StatusLine({ progress, status }: { progress: QueueProgress; status?: Status }) {
  const loading = progress.running > 0 || progress.done < progress.total;
  const ffError = status?.providers.fast_flights.last_error;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-4 text-xs text-slate-500" aria-live="polite">
      {loading ? (
        <span className="flex items-center gap-1.5">
          <Spinner /> Loading {Math.min(progress.done, progress.total)} of {progress.total}
          <span className="text-slate-400">· prices are fetched live, so this can take a minute</span>
        </span>
      ) : (
        <span>Up to date</span>
      )}
      {status && (
        <span>
          Provider: <strong>{status.active_provider ?? "none available"}</strong> ({status.provider_mode})
        </span>
      )}
      {status?.switch_reason && <span className="text-amber-700">⚠ {status.switch_reason}</span>}
      {ffError && !status?.switch_reason && status?.active_provider === "fast_flights" && (
        <span className="text-amber-700" title={ffError}>
          ⚠ fast-flights: {ffError.length > 80 ? `${ffError.slice(0, 80)}…` : ffError}
        </span>
      )}
      {status?.providers.serpapi.available && (
        <span>
          SerpApi: {status.serpapi_usage.used} / {status.serpapi_usage.cap}
        </span>
      )}
    </div>
  );
}
