import type {
  Airport,
  AppSettings,
  Direction,
  FetchJob,
  FetchResult,
  FlightsResponse,
  Status,
  TurkeyGroup,
  WeekFlightsResponse,
  WeekSummary,
} from "./types";
import { getAdminPassword } from "./admin";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const admin = getAdminPassword();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(admin ? { "X-Admin-Password": admin } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

const qs = (params: Record<string, string | undefined | null>) =>
  new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => e[1] != null && e[1] !== ""),
  ).toString();

export interface ViewParams {
  direction: Direction;
  foreign: string;
  center: string;
}

export const api = {
  airports: (q: string) => request<Airport[]>(`/airports?${qs({ q })}`),
  groups: () => request<TurkeyGroup[]>("/groups"),
  allGroups: () => request<TurkeyGroup[]>("/groups?include_disabled=true"),
  setGroups: (enabled: string[]) =>
    request<TurkeyGroup[]>("/groups", { method: "PUT", body: JSON.stringify({ enabled }) }),
  week: (v: ViewParams, selectedGroup?: string, selectedDate?: string) =>
    request<WeekSummary>(
      `/week?${qs({
        direction: v.direction,
        foreign: v.foreign,
        center_date: v.center,
        selected_group: selectedGroup,
        selected_date: selectedDate,
      })}`,
    ),
  flights: (v: ViewParams, group: string, date: string) =>
    request<FlightsResponse>(
      `/flights?${qs({ direction: v.direction, foreign: v.foreign, group, date })}`,
    ),
  flightsWeek: (v: ViewParams, group: string) =>
    request<WeekFlightsResponse>(
      `/flights/week?${qs({ direction: v.direction, foreign: v.foreign, group, center_date: v.center })}`,
    ),
  fetchJob: (job: FetchJob) =>
    request<FetchResult>("/fetch", { method: "POST", body: JSON.stringify(job) }),
  refreshDay: (v: ViewParams, group: string, date: string) =>
    request<{ jobs: FetchJob[] }>("/refresh", {
      method: "POST",
      body: JSON.stringify({ scope: "day", direction: v.direction, foreign: v.foreign, group, date }),
    }),
  refreshWeek: (v: ViewParams, group?: string, date?: string) =>
    request<{ jobs: FetchJob[] }>("/refresh", {
      method: "POST",
      body: JSON.stringify({
        scope: "week",
        direction: v.direction,
        foreign: v.foreign,
        center_date: v.center,
        group,
        date,
      }),
    }),
  expireAll: () => request<{ expired: number }>("/cache/expire-all", { method: "POST" }),
  clearCache: () => request<{ deleted: number }>("/cache", { method: "DELETE" }),
  getSettings: () => request<AppSettings>("/settings"),
  putSettings: (s: Partial<AppSettings>) =>
    request<AppSettings>("/settings", { method: "PUT", body: JSON.stringify(s) }),
  status: () => request<Status>("/status"),
  /** Verify a candidate admin password without storing it. */
  adminCheck: (password: string) =>
    request<{ ok: boolean }>("/admin/check", { method: "POST", headers: { "X-Admin-Password": password } }),
};
