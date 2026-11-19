// Mirrors backend/app/models.py. Dates are "YYYY-MM-DD"; datetimes are ISO strings.

export type Direction = "from_tr" | "to_tr";
export type Currency = "TRY" | "PKR" | "BOTH";
export type ProviderMode = "auto" | "fast_flights" | "serpapi";
export type DayStatus = "ok" | "empty" | "error" | "pending" | "past" | "not_on_sale";
export type BagStatus = "included" | "fee" | "unknown";

export interface Layover {
  airport: string;
  duration_minutes: number | null;
  overnight: boolean;
  airport_change: boolean;
}

export interface Baggage {
  carry_on: BagStatus;
  checked: BagStatus;
  raw: string | null;
}

export interface FlightOption {
  id: string;
  origin_airport: string;
  destination_airport: string;
  departure_local: string;
  arrival_local: string;
  arrival_day_offset: number;
  duration_minutes: number | null;
  stops: number;
  layovers: Layover[];
  airlines: string[];
  flight_numbers: string[] | null;
  aircraft: string[] | null;
  price_gbp: number | null;
  price?: number | null;
  currency?: string;
  price_try?: number | null;
  price_pkr?: number | null;
  baggage: Baggage | null;
  is_self_transfer: boolean | null;
  provider: string;
  fetched_at: string | null;
}

export interface TurkeyGroup {
  id: string;
  name: string;
  airports: string[];
  enabled: boolean;
}


export interface RouteDaySummary {
  group_id: string;
  date: string;
  cheapest_price: number | null;
  cheapest_price_try?: number | null;
  cheapest_price_pkr?: number | null;
  cheapest_price_gbp?: number | null;
  cheapest_flight_id: string | null;
  option_count: number;
  status: DayStatus;
  fetched_at: string | null;
  expires_at: string | null;
  is_stale: boolean;
  is_partial: boolean;
  loading: boolean;
  error: string | null;
}

export interface GroupWeek {
  group_id: string;
  name: string;
  airports: string[];
  days: RouteDaySummary[];
  cheapest_price: number | null;
  cheapest_price_try?: number | null;
  cheapest_price_pkr?: number | null;
  cheapest_price_gbp?: number | null;
  status: DayStatus;
}

/** One group-day for the browser to fetch via /api/fetch. */
export interface FetchJob {
  direction: Direction;
  foreign: string;
  group: string;
  date: string;
  detail: boolean;
  force: boolean;
  route_days: number;
}

export interface FetchResult {
  status: "done" | "error" | "skipped" | "busy";
  error: string | null;
  next_delay_seconds: number;
}

export interface WeekSummary {
  direction: Direction;
  foreign: string;
  center_date: string;
  dates: string[];
  groups: GroupWeek[];
  jobs: FetchJob[];
  pending_count: number;
  min_price: number | null;
  max_price: number | null;
  min_price_try?: number | null;
  max_price_try?: number | null;
  min_price_pkr?: number | null;
  max_price_pkr?: number | null;
}

export interface CacheMeta {
  status: DayStatus;
  fetched_at: string | null;
  expires_at: string | null;
  is_stale: boolean;
  is_partial: boolean;
  providers: string[];
  error: string | null;
}

export interface FlightsResponse {
  direction: Direction;
  foreign: string;
  group: string;
  date: string;
  flights: FlightOption[];
  meta: CacheMeta;
}

export interface WeekFlightsResponse {
  direction: Direction;
  foreign: string;
  group: string;
  center_date: string;
  days: { date: string; flights: FlightOption[]; meta: CacheMeta }[];
}

export interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string;
}

export interface AppSettings {
  ttl_days: number;
  provider_mode: ProviderMode;
  serpapi_monthly_cap: number;
  concurrency: number;
  delay_seconds: [number, number];
}

export interface Status {
  admin_protected: boolean;
  active_provider: string | null;
  provider_mode: ProviderMode;
  switch_reason: string | null;
  serpapi_until: string | null;
  providers: {
    fast_flights: { available: boolean; consecutive_failures: number; last_error: string | null };
    serpapi: { available: boolean; last_error: string | null };
  };
  serpapi_usage: { used: number; cap: number };
  serpapi_batch_max_airports: number;
  database: "sqlite" | "turso";
}

export interface QueueProgress {
  /** Route-days fetched / planned in the current view (one job covers 1+ route-days). */
  done: number;
  total: number;
  running: number;
}
