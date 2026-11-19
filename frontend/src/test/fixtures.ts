import type { FlightOption, GroupWeek, RouteDaySummary, WeekSummary } from "../lib/types";

export function flight(over: Partial<FlightOption> = {}): FlightOption {
  return {
    id: Math.random().toString(36).slice(2),
    origin_airport: "NCL",
    destination_airport: "KHI",
    departure_local: "2026-12-31T14:30:00",
    arrival_local: "2027-01-01T06:40:00",
    arrival_day_offset: 1,
    duration_minutes: 670,
    stops: 1,
    layovers: [{ airport: "DXB", duration_minutes: 150, overnight: false, airport_change: false }],
    airlines: ["Emirates"],
    flight_numbers: null,
    aircraft: ["Boeing 777"],
    price_gbp: 500,
    baggage: null,
    is_self_transfer: null,
    provider: "fast_flights",
    fetched_at: "2026-11-17T09:12:00Z",
    ...over,
  };
}

export function day(over: Partial<RouteDaySummary> = {}): RouteDaySummary {
  return {
    group_id: "NCL",
    date: "2026-12-31",
    cheapest_price: 400,
    cheapest_flight_id: "x",
    option_count: 3,
    status: "ok",
    fetched_at: "2026-11-17T09:12:00Z",
    expires_at: "2026-11-19T09:12:00Z",
    is_stale: false,
    is_partial: false,
    loading: false,
    error: null,
    ...over,
  };
}

export function group(id: string, name: string, price: number | null, days?: RouteDaySummary[]): GroupWeek {
  return {
    group_id: id,
    name,
    airports: [id],
    days: days ?? [day({ group_id: id, cheapest_price: price, status: price == null ? "empty" : "ok" })],
    cheapest_price: price,
    status: price == null ? "empty" : "ok",
  };
}

export function week(groups: GroupWeek[], dates = ["2026-12-31"]): WeekSummary {
  const prices = groups.flatMap((g) => g.days.map((d) => d.cheapest_price)).filter((p): p is number => p != null);
  return {
    direction: "from_tr",
    foreign: "KHI",
    center_date: dates[0]!,
    dates,
    groups,
    jobs: [],
    pending_count: 0,
    min_price: prices.length ? Math.min(...prices) : null,
    max_price: prices.length ? Math.max(...prices) : null,
  };
}
