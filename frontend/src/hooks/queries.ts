import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, type ViewParams } from "../lib/api";
import { WHOLE_WEEK } from "../lib/urlState";

export function useTurkeyGroups() {
  return useQuery({ queryKey: ["groups"], queryFn: api.groups, staleTime: Infinity });
}

export function useWeek(view: ViewParams, group: string | null, day: string) {
  const selectedDate = day === WHOLE_WEEK ? undefined : day;
  return useQuery({
    queryKey: ["week", view.direction, view.foreign, view.center, group, selectedDate],
    queryFn: () => api.week(view, group ?? undefined, selectedDate),
    placeholderData: keepPreviousData,
  });
}

export function useDayFlights(view: ViewParams, group: string | null, day: string) {
  return useQuery({
    queryKey: ["flights", "day", view.direction, view.foreign, group, day],
    queryFn: () => api.flights(view, group!, day),
    enabled: !!group && day !== WHOLE_WEEK,
    placeholderData: keepPreviousData,
  });
}

export function useWeekFlights(view: ViewParams, group: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["flights", "week", view.direction, view.foreign, view.center, group],
    queryFn: () => api.flightsWeek(view, group!),
    enabled: !!group && enabled,
    placeholderData: keepPreviousData,
  });
}

export function useAllTurkeyGroups(enabled: boolean) {
  return useQuery({ queryKey: ["groups", "all"], queryFn: api.allGroups, enabled });
}

export function useStatus() {
  return useQuery({ queryKey: ["status"], queryFn: api.status, refetchInterval: 15_000 });
}

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
}

export function useAirportSearch(q: string) {
  return useQuery({
    queryKey: ["airports", q.toLowerCase()],
    queryFn: () => api.airports(q),
    enabled: q.trim().length >= 2,
    staleTime: Infinity,
  });
}
