import { localDate } from "../lib/format";
import type { FlightOption } from "../lib/types";

/** Ids of the cheapest and shortest flight on each departure day. */
export function computeHighlights(flights: FlightOption[]): { cheapest: Set<string>; shortest: Set<string> } {
  const byDay = new Map<string, FlightOption[]>();
  for (const f of flights) {
    const day = localDate(f.departure_local);
    byDay.set(day, [...(byDay.get(day) ?? []), f]);
  }
  const cheapest = new Set<string>();
  const shortest = new Set<string>();
  for (const list of byDay.values()) {
    const minPrice = Math.min(...list.map((f) => f.price_try ?? f.price_gbp ?? Infinity));
    const minDur = Math.min(...list.map((f) => f.duration_minutes ?? Infinity));
    for (const f of list) {
      if (Number.isFinite(minPrice) && (f.price_try ?? f.price_gbp) === minPrice) cheapest.add(f.id);
      if (Number.isFinite(minDur) && f.duration_minutes === minDur) shortest.add(f.id);
    }
  }
  return { cheapest, shortest };
}
