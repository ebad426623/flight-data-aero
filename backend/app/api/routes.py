"""REST endpoints under /api.

Fetching is driven by the browser: `/week` returns the summary plus the jobs
still needed, and the browser calls `/fetch` for each. Every request is short,
so the same API works locally and on serverless hosts.
"""

from __future__ import annotations

import asyncio
import hmac
from datetime import date as Date
from datetime import datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from ..airports import Airport, search_airports
from ..cache import utcnow
from ..config import USAGE_SYNC_MINUTES
from ..dates import week_dates
from ..models import (
    AppSettings,
    DayFlights,
    Direction,
    FetchJob,
    FetchResult,
    FlightsResponse,
    RefreshRequest,
    SettingsUpdate,
    UKGroup,
    UKGroupsUpdate,
    WeekFlightsResponse,
    WeekSummary,
)
from ..state import AppState, get_state

router = APIRouter(prefix="/api")

State = Annotated[AppState, Depends(get_state)]
IATA = Annotated[str, Query(min_length=3, max_length=3, pattern=r"^[A-Za-z]{3}$")]

FAILED_LOGIN_DELAY_SECONDS = 1.0  # slows down password guessing
USAGE_SYNCED_AT_KEY = "serpapi_usage_synced_at"


async def require_admin(
    state: State, x_admin_password: Annotated[str | None, Header()] = None
) -> None:
    """Guard for shared settings. A no-op when ADMIN_PASSWORD is not configured."""
    expected = state.env.admin_password
    if not expected:
        return
    if x_admin_password and hmac.compare_digest(x_admin_password.encode(), expected.encode()):
        return
    await asyncio.sleep(FAILED_LOGIN_DELAY_SECONDS)
    raise HTTPException(
        401, "admin password required" if not x_admin_password else "wrong admin password"
    )


Admin = Depends(require_admin)


def _group(state: AppState, group_id: str) -> UKGroup:
    group = next((g for g in state.groups if g.id == group_id), None)
    if group is None:
        raise HTTPException(404, f"unknown or disabled Turkey airport group: {group_id}")
    return group


async def _maybe_sync_serpapi_usage(state: AppState) -> None:
    """Raise the local SerpApi counter to SerpApi's own figure, at most every 30 minutes.

    The Account API call is free (not counted as a search).
    """
    if not state.providers.serpapi.available:
        return
    raw = state.settings.get_value(USAGE_SYNCED_AT_KEY)
    if raw and utcnow() - datetime.fromisoformat(raw) < timedelta(minutes=USAGE_SYNC_MINUTES):
        return
    state.settings.set_value(USAGE_SYNCED_AT_KEY, utcnow().isoformat())
    remote = await state.providers.serpapi.account_usage()
    if remote is not None:
        state.usage.sync_remote(remote)


# ---------------------------------------------------------------------- lookups


@router.get("/rates")
def rates() -> dict[str, Any]:
    from ..currency import CURRENCY_SYMBOLS, get_exchange_rates
    return {
        "base": "TRY",
        "rates": get_exchange_rates(),
        "symbols": CURRENCY_SYMBOLS,
    }


@router.get("/airports")
def airports(q: Annotated[str, Query(min_length=1, max_length=64)]) -> list[Airport]:
    return search_airports(q)


@router.get("/groups")
def uk_groups(state: State, include_disabled: bool = False) -> list[UKGroup]:
    return state.group_store.all() if include_disabled else list(state.groups)


@router.put("/groups", dependencies=[Admin])
def set_uk_groups(state: State, body: UKGroupsUpdate) -> list[UKGroup]:
    """Enable exactly the given groups (all others are disabled)."""
    try:
        return state.group_store.set_enabled(body.enabled)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


# ---------------------------------------------------------------------- flights


@router.get("/week")
def week(
    state: State,
    direction: Direction,
    foreign: IATA,
    center_date: Date,
    selected_group: str | None = None,
    selected_date: Date | None = None,
) -> WeekSummary:
    """Week summary from the cache, plus the jobs the browser should fetch next."""
    foreign = foreign.upper()
    if selected_group is not None:
        _group(state, selected_group)
    jobs = state.fetcher.plan(direction, foreign, center_date, selected_group, selected_date)
    return state.summaries.week(direction, foreign, center_date, state.groups, jobs)


@router.post("/fetch")
async def fetch(state: State, job: FetchJob) -> FetchResult:
    """Fetch one group-day (a few seconds). Already-cached work is skipped."""
    job = job.model_copy(update={"foreign": job.foreign.upper()})
    if state.providers.serpapi.available:
        await _maybe_sync_serpapi_usage(state)
    return await state.fetcher.run(job)


@router.get("/flights")
def flights(
    state: State, direction: Direction, foreign: IATA, group: str, date: Date
) -> FlightsResponse:
    foreign = foreign.upper()
    g = _group(state, group)
    [(day, items, meta, _)] = state.summaries.group_days(direction, foreign, g, [date], set())
    return FlightsResponse(
        direction=direction, foreign=foreign, group=group, date=day, flights=items, meta=meta
    )


@router.get("/flights/week")
def flights_week(
    state: State, direction: Direction, foreign: IATA, group: str, center_date: Date
) -> WeekFlightsResponse:
    foreign = foreign.upper()
    g = _group(state, group)
    rows = state.summaries.group_days(direction, foreign, g, week_dates(center_date), set())
    return WeekFlightsResponse(
        direction=direction,
        foreign=foreign,
        group=group,
        center_date=center_date,
        days=[DayFlights(date=d, flights=items, meta=meta) for d, items, meta, _ in rows],
    )


# ---------------------------------------------------------------------- refresh / cache


@router.post("/refresh")
def refresh(state: State, body: RefreshRequest) -> dict[str, list[FetchJob]]:
    """Jobs that re-fetch a day or the whole view; the browser runs them via /fetch."""
    foreign = body.foreign.upper()
    if body.scope == "day":
        if not body.group or not body.date:
            raise HTTPException(422, "scope=day requires group and date")
        _group(state, body.group)
        job = FetchJob(
            direction=body.direction,
            foreign=foreign,
            group=body.group,
            date=body.date,
            detail=True,
            force=True,
        )
        return {"jobs": [job]}
    if not body.center_date:
        raise HTTPException(422, "scope=week requires center_date")
    jobs = state.fetcher.plan(
        body.direction, foreign, body.center_date, body.group, body.date, force=True
    )
    return {"jobs": jobs}


@router.post("/cache/expire-all", dependencies=[Admin])
def expire_all(state: State) -> dict:
    return {"expired": state.cache.expire_all()}


@router.delete("/cache", dependencies=[Admin])
def clear_cache(state: State) -> dict:
    return {"deleted": state.cache.clear()}


# ---------------------------------------------------------------------- settings / status


@router.post("/admin/check", dependencies=[Admin])
def admin_check() -> dict:
    """Lets the UI verify an admin password before unlocking settings."""
    return {"ok": True}


@router.get("/settings")
def get_settings(state: State) -> AppSettings:
    return state.settings.get()


@router.put("/settings", dependencies=[Admin])
def put_settings(state: State, body: SettingsUpdate) -> AppSettings:
    current = state.settings.get()
    updated = current.model_copy(update=body.model_dump(exclude_none=True))
    updated = AppSettings.model_validate(updated.model_dump())
    state.settings.save(updated)
    if updated.provider_mode != current.provider_mode:
        state.providers.reset()
    return updated


@router.get("/status")
async def status(state: State) -> dict:
    await _maybe_sync_serpapi_usage(state)
    settings = state.settings.get()
    p = state.providers
    last_error = p.last_error
    return {
        "admin_protected": bool(state.env.admin_password),
        "active_provider": p.peek_active_name(),
        "provider_mode": settings.provider_mode,
        "switch_reason": p.switch_reason(),
        "serpapi_until": p.serpapi_until,
        "providers": {
            "fast_flights": {
                "available": True,
                "consecutive_failures": p.consecutive_ff_failures,
                "last_error": last_error.get("fast_flights"),
            },
            "serpapi": {
                "available": p.serpapi.available,
                "last_error": last_error.get("serpapi"),
            },
        },
        "serpapi_usage": {"used": state.usage.used(), "cap": settings.serpapi_monthly_cap},
        "serpapi_batch_max_airports": state.fetcher.batch_size,
        "database": "turso" if state.env.turso_database_url else "sqlite",
    }
