import { useCallback, useEffect, useState } from "react";
import { addDays, isValidISODate, todayISO } from "./dates";
import type { Currency, Direction } from "./types";

export type SortDir = "asc" | "desc";
export type CitySort = "price" | "alpha";

export interface ViewState {
  direction: Direction;
  foreign: string;
  center: string;
  group: string | null;
  /** Selected day, or "week" for the whole-week tab. */
  day: string;
  sort: { id: string; dir: SortDir };
  citySort: CitySort;
  currency: Currency;
}

export const DEFAULT_FOREIGN = "KHI";
export const DEFAULT_SORT = { id: "price", dir: "asc" as SortDir };
export const WHOLE_WEEK = "week";

export function defaultCenter(now = new Date()): string {
  return addDays(todayISO(now), 10);
}

export function parseState(search: string, now = new Date()): ViewState {
  const p = new URLSearchParams(search);
  const center = isValidISODate(p.get("date")) ? p.get("date")! : defaultCenter(now);
  const foreign = /^[A-Za-z]{3}$/.test(p.get("foreign") ?? "")
    ? p.get("foreign")!.toUpperCase()
    : DEFAULT_FOREIGN;
  const dayParam = p.get("day");
  const day = dayParam === WHOLE_WEEK || isValidISODate(dayParam) ? dayParam! : center;
  const [sortId, sortDir] = (p.get("sort") ?? "").split(":");
  const dirParam = p.get("dir");
  const direction: Direction = dirParam === "to_tr" ? "to_tr" : "from_tr";

  const currParam = (p.get("curr") ?? "").toUpperCase();
  const currency: Currency =
    currParam === "PKR" || currParam === "BOTH" ? (currParam as Currency) : "TRY";

  return {
    direction,
    foreign,
    center,
    group: p.get("group") || null,
    day,
    sort:
      sortId && (sortDir === "asc" || sortDir === "desc")
        ? { id: sortId, dir: sortDir }
        : DEFAULT_SORT,
    citySort: p.get("cities") === "alpha" ? "alpha" : "price",
    currency,
  };
}

export function serializeState(s: ViewState): string {
  const p = new URLSearchParams();
  p.set("dir", s.direction);
  p.set("foreign", s.foreign);
  p.set("date", s.center);
  if (s.group) p.set("group", s.group);
  if (s.day !== s.center) p.set("day", s.day);
  if (s.sort.id !== DEFAULT_SORT.id || s.sort.dir !== DEFAULT_SORT.dir)
    p.set("sort", `${s.sort.id}:${s.sort.dir}`);
  if (s.citySort !== "price") p.set("cities", s.citySort);
  if (s.currency && s.currency !== "TRY") p.set("curr", s.currency);
  return p.toString();
}

/** View state synced to the URL query string (replaceState, so reload/bookmark restores it). */
export function useUrlState(): [ViewState, (patch: Partial<ViewState>) => void] {
  const [state, setState] = useState(() => parseState(window.location.search));

  useEffect(() => {
    const qs = serializeState(state);
    if (qs !== window.location.search.slice(1)) {
      window.history.replaceState(null, "", `${window.location.pathname}?${qs}`);
    }
  }, [state]);

  useEffect(() => {
    const onPop = () => setState(parseState(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const update = useCallback((patch: Partial<ViewState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      // Moving the week re-centres the selected day unless one was given explicitly.
      if (patch.center && patch.center !== prev.center && patch.day === undefined) {
        next.day = prev.day === WHOLE_WEEK ? WHOLE_WEEK : patch.center;
      }
      return next;
    });
  }, []);

  return [state, update];
}
