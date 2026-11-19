import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { airportLabel } from "./components/AirportPicker";
import { CitySidebar } from "./components/CitySidebar";
import { FlightPanel } from "./components/FlightPanel";
import { Footer } from "./components/Footer";
import { Heatmap } from "./components/Heatmap";
import { SettingsDialog } from "./components/SettingsDialog";
import { TopBar } from "./components/TopBar";
import { useAirportSearch, useSettings, useStatus, useWeek } from "./hooks/queries";
import { useFetchQueue } from "./hooks/useFetchQueue";
import { api, type ViewParams } from "./lib/api";
import { useUrlState } from "./lib/urlState";

export default function App() {
  const [state, update] = useUrlState();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const qc = useQueryClient();

  const view: ViewParams = useMemo(
    () => ({ direction: state.direction, foreign: state.foreign, center: state.center }),
    [state.direction, state.foreign, state.center],
  );

  const week = useWeek(view, state.group, state.day);
  const { data: status } = useStatus();
  const { data: settings } = useSettings();
  // Fetching is driven from here: the queue runs the jobs each week response asks for.
  const queueView = [state.direction, state.foreign, state.center, state.group, state.day].join("|");
  const { progress, offer, reset } = useFetchQueue(queueView, settings?.concurrency ?? 8);
  useEffect(() => {
    if (week.data && !week.isPlaceholderData) offer(week.data.jobs);
  }, [week.data, week.isPlaceholderData, offer]);
  const { data: airportMatches } = useAirportSearch(state.foreign);
  const foreignLabel = airportLabel(
    airportMatches?.find((a) => a.iata === state.foreign),
    state.foreign,
  );

  // Default / repair the selected city once groups are known.
  const groups = week.data?.groups;
  useEffect(() => {
    if (groups?.length && !groups.some((g) => g.group_id === state.group)) {
      update({ group: groups[0]!.group_id });
    }
  }, [groups, state.group, update]);

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ["week"] });
    void qc.invalidateQueries({ queryKey: ["flights"] });
    void qc.invalidateQueries({ queryKey: ["status"] });
  };
  const selectedDate = state.day === "week" ? undefined : state.day;
  const refreshWeek = useMutation({
    mutationFn: () => api.refreshWeek(view, state.group ?? undefined, selectedDate),
    onSuccess: ({ jobs }) => offer(jobs, { front: true }),
  });
  // After expiring or clearing the cache, the next week response lists every
  // route-day again; reset() lets the queue run them even if tried before.
  const expireAll = useMutation({
    mutationFn: api.expireAll,
    onSuccess: () => {
      reset();
      invalidateAll();
    },
  });
  const clearCache = useMutation({
    mutationFn: api.clearCache,
    onSuccess: () => {
      reset();
      invalidateAll();
    },
  });

  const selectedGroup = groups?.find((g) => g.group_id === state.group);

  return (
    <div className="flex h-full flex-col">
      <TopBar
        direction={state.direction}
        currency={state.currency}
        foreign={state.foreign}
        center={state.center}
        progress={progress}
        status={status}
        onDirection={(direction) => update({ direction })}
        onCurrency={(currency) => update({ currency })}
        onForeign={(foreign) => update({ foreign })}
        onCenter={(center) => update({ center })}
        onRefreshWeek={() => refreshWeek.mutate()}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {week.error ? (
        <div className="p-8 text-rose-600">
          Couldn't reach the backend: {(week.error as Error).message}. Is the API running on port 8000?
        </div>
      ) : !week.data ? (
        <div className="p-8 text-slate-500">Loading…</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <CitySidebar
            groups={week.data.groups}
            selected={state.group}
            sort={state.citySort}
            currency={state.currency}
            onSort={(citySort) => update({ citySort })}
            onSelect={(group) => update({ group })}
          />
          <main className="flex min-h-0 flex-1 flex-col overflow-auto">
            <Heatmap
              week={week.data}
                currency={state.currency}
              selectedGroup={state.group}
              selectedDay={state.day}
              onSelect={(group, day) => update({ group, day })}
            />
            {selectedGroup && (
              <FlightPanel
                view={view}
                group={selectedGroup}
                foreignLabel={foreignLabel}
                currency={state.currency}
                day={state.day}
                sort={state.sort}
                onDay={(day) => update({ day })}
                onSort={(sort) => update({ sort })}
                onRefreshJobs={(jobs) => offer(jobs, { front: true })}
              />
            )}
            <Footer />
          </main>
        </div>
      )}

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onExpireAll={() => expireAll.mutate()}
        onClearCache={() => clearCache.mutate()}
      />
    </div>
  );
}
