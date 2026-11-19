"""Fetch planning and execution, driven one job at a time by the browser.

A *job* is one group-day (a Turkey airport group on one date). `/api/week` returns the
jobs a week view still needs, in priority order; the browser then calls
`/api/fetch` for each (a few at a time), so every server request is short.
That suits serverless hosts like Vercel, and works the same locally.

How a job is satisfied depends on the active provider:

* fast-flights: one request per Turkey airport that still needs data (full).
* SerpApi, selected city ("detail"): one multi-airport request for the group (full).
* SerpApi, other cities ("overview"): one request for the whole batch the group
  belongs to (partial); that single request satisfies every group in the batch.

A job is complete when every airport in its group has fresh enough data, so
overlapping work (batches, refreshes, two visitors) is naturally de-duplicated.
A short database claim stops two requests fetching the same group-day at once.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from .cache import CacheEntry, ClaimStore, FlightCache, RouteKey, SettingsStore, UsageStore, utcnow
from .config import (
    AUTO_FAILOVER_MINUTES,
    AUTO_FAILOVER_THRESHOLD,
    CLAIM_SECONDS,
    MAX_BACKOFF_SECONDS,
    MIN_FORCE_AGE_SECONDS,
)
from .dates import is_fetchable, week_dates
from .models import (
    Completeness,
    Direction,
    FetchJob,
    FetchResult,
    FlightOption,
    ProviderMode,
    UKGroup,
)
from .providers.base import (
    FlightProvider,
    ProviderError,
    ProviderUnavailableError,
    TooManyAirportsError,
)
from .providers.serpapi import SerpApiProvider
from .uk_groups import pack_batches

log = logging.getLogger(__name__)

BATCH_SIZE_KEY = "serpapi_batch_max_airports"
PROVIDER_STATE_KEY = "provider_state"

# Priority tiers (lower runs first).
TIER_SELECTED_DAY = 0
TIER_SELECTED_WEEK = 1
TIER_OTHER_GROUPS = 2


def route_endpoints(direction: Direction, turkey: str, foreign: str) -> tuple[str, str]:
    """(origin, destination) for a query."""
    is_from = direction in (Direction.FROM_TR, Direction.FROM_UK)
    return (turkey, foreign) if is_from else (foreign, turkey)


def needs_fetch(
    entry: CacheEntry | None,
    *,
    detail: bool,
    force_after: datetime | None,
    now: datetime,
) -> bool:
    """Whether one airport's route-day must be (re)fetched."""
    if entry is None:
        return True
    # A refresh always retries a failed fetch, and re-fetches data older than
    # MIN_FORCE_AGE_SECONDS (so mashing Refresh can't hammer Google).
    if force_after is not None and (entry.in_error_backoff(now) or entry.fetched_at <= force_after):
        return True
    if entry.in_error_backoff(now):
        return False
    if entry.is_expired(now):
        return True
    return detail and entry.has_data and entry.completeness is Completeness.PARTIAL


class ProviderManager:
    """Chooses the provider per request according to the mode setting.

    Failure counts and the auto-failover window are stored in the database so
    every server instance (serverless or not) sees the same provider health.
    """

    def __init__(
        self,
        fast_flights: FlightProvider,
        serpapi: SerpApiProvider,
        settings: SettingsStore,
        usage: UsageStore,
    ):
        self.fast_flights = fast_flights
        self.serpapi = serpapi
        self._settings = settings
        self._usage = usage

    # ---- persisted state

    def _state(self) -> dict:
        raw = self._settings.get_value(PROVIDER_STATE_KEY)
        return json.loads(raw) if raw else {}

    def _update(self, **changes: object) -> None:
        state = self._state()
        state.update(changes)
        self._settings.set_value(PROVIDER_STATE_KEY, json.dumps(state, default=str))

    @property
    def consecutive_ff_failures(self) -> int:
        return int(self._state().get("ff_failures", 0))

    @consecutive_ff_failures.setter
    def consecutive_ff_failures(self, value: int) -> None:
        self._update(ff_failures=value)

    @property
    def serpapi_until(self) -> datetime | None:
        value = self._state().get("serpapi_until")
        return datetime.fromisoformat(value) if value else None

    @serpapi_until.setter
    def serpapi_until(self, value: datetime | None) -> None:
        self._update(serpapi_until=value.isoformat() if value else None)

    @property
    def last_error(self) -> dict[str, str | None]:
        return self._state().get("last_error", {})

    def _set_last_error(self, provider: FlightProvider, message: str | None) -> None:
        errors = self.last_error
        if errors.get(provider.name) != message:
            errors[provider.name] = message
            self._update(last_error=errors)

    # ---- selection

    def serpapi_usable(self) -> bool:
        cap = self._settings.get().serpapi_monthly_cap
        return self.serpapi.available and self._usage.used() < cap

    def active(self, now: datetime | None = None) -> FlightProvider:
        now = now or utcnow()
        mode = self._settings.get().provider_mode
        if mode is ProviderMode.FAST_FLIGHTS:
            return self.fast_flights
        if mode is ProviderMode.SERPAPI:
            if not self.serpapi.available:
                raise ProviderUnavailableError("SerpApi mode selected but no API key is set")
            if not self.serpapi_usable():
                raise ProviderUnavailableError("SerpApi monthly cap reached")
            return self.serpapi
        until = self.serpapi_until
        if until and now < until and self.serpapi_usable():
            return self.serpapi
        if until and now >= until:
            self.serpapi_until = None
        return self.fast_flights

    def peek_active_name(self) -> str | None:
        try:
            return self.active().name
        except ProviderUnavailableError:
            return None

    def switch_reason(self) -> str | None:
        until = self.serpapi_until
        if until and utcnow() < until:
            return "fast-flights failing, using SerpApi"
        return None

    # ---- outcomes

    def record_success(self, provider: FlightProvider) -> None:
        self._set_last_error(provider, None)
        if provider is self.fast_flights and self.consecutive_ff_failures:
            self.consecutive_ff_failures = 0

    def record_failure(self, provider: FlightProvider, message: str) -> None:
        self._set_last_error(provider, message)
        if provider is not self.fast_flights:
            return
        failures = self.consecutive_ff_failures + 1
        settings = self._settings.get()
        if (
            settings.provider_mode is ProviderMode.AUTO
            and failures >= AUTO_FAILOVER_THRESHOLD
            and self.serpapi_usable()
        ):
            self._update(
                ff_failures=0,
                serpapi_until=(utcnow() + timedelta(minutes=AUTO_FAILOVER_MINUTES)).isoformat(),
            )
            log.warning("fast-flights failing; using SerpApi for %d min", AUTO_FAILOVER_MINUTES)
        else:
            self.consecutive_ff_failures = failures

    def reset(self) -> None:
        self._update(ff_failures=0, serpapi_until=None)


@dataclass
class _Run:
    """One job being executed."""

    direction: Direction
    foreign: str
    group: UKGroup
    date: date
    detail: bool
    force_after: datetime | None

    def route_key(self, airport: str) -> RouteKey:
        return RouteKey(self.direction, airport, self.foreign, self.date)

    @property
    def claim_key(self) -> str:
        return f"{self.direction.value}:{self.foreign}:{self.group.id}:{self.date.isoformat()}"


class Fetcher:
    def __init__(
        self,
        cache: FlightCache,
        settings: SettingsStore,
        providers: ProviderManager,
        claims: ClaimStore,
        groups: Sequence[UKGroup] | Callable[[], Sequence[UKGroup]],
        default_batch_size: int = 7,
        sleep=asyncio.sleep,
    ):
        self._cache = cache
        self._settings = settings
        self.providers = providers
        self._claims = claims
        self._groups = groups if callable(groups) else (lambda: groups)
        self._default_batch_size = default_batch_size
        self._sleep = sleep

    @property
    def groups(self) -> list[UKGroup]:
        return list(self._groups())

    # ------------------------------------------------------------------ batches

    @property
    def batch_size(self) -> int:
        stored = self._settings.get_value(BATCH_SIZE_KEY)
        return int(stored) if stored else self._default_batch_size

    def batches(self) -> list[list[UKGroup]]:
        return pack_batches(self.groups, self.batch_size)

    # ------------------------------------------------------------------ planning

    def _airports_needing_fetch(
        self,
        run: _Run,
        now: datetime | None = None,
        entries: dict[RouteKey, CacheEntry] | None = None,
    ) -> list[str]:
        now = now or utcnow()
        if entries is None:
            entries = self._cache.get_many(
                run.direction, run.foreign, run.group.airports, [run.date]
            )
        return [
            a
            for a in run.group.airports
            if needs_fetch(
                entries.get(run.route_key(a)),
                detail=run.detail,
                force_after=run.force_after,
                now=now,
            )
        ]

    def plan(
        self,
        direction: Direction,
        foreign: str,
        center: date,
        selected_group: str | None,
        selected_date: date | None = None,
        force: bool = False,
    ) -> list[FetchJob]:
        """Group-days of a week view that need fetching, highest priority first.

        Order: the selected city on the selected day, then its other days
        (nearest first), then every other city.
        """
        now = utcnow()
        selected_date = selected_date or center
        force_after = now - timedelta(seconds=MIN_FORCE_AGE_SECONDS) if force else None
        groups = self.groups
        order = {g.id: i for i, g in enumerate(groups)}
        # One query for the whole week: per-day queries are slow on a remote database.
        entries = self._cache.get_many(
            direction, foreign, {a for g in groups for a in g.airports}, week_dates(center)
        )
        candidates: list[tuple[tuple[int, int, int], FetchJob]] = []
        for group in groups:
            is_selected = group.id == selected_group
            for day in week_dates(center):
                if not is_fetchable(day):
                    continue
                run = _Run(direction, foreign, group, day, is_selected, force_after)
                planned = self._airports_needing_fetch(run, now, entries)
                if not planned:
                    continue
                if is_selected:
                    tier = TIER_SELECTED_DAY if day == selected_date else TIER_SELECTED_WEEK
                else:
                    tier = TIER_OTHER_GROUPS
                job = FetchJob(
                    direction=direction,
                    foreign=foreign,
                    group=group.id,
                    date=day,
                    detail=is_selected,
                    force=force,
                    route_days=len(planned),
                )
                priority = (tier, abs((day - selected_date).days), order[group.id])
                candidates.append((priority, job))
        return [job for _, job in sorted(candidates, key=lambda c: c[0])]

    # ------------------------------------------------------------------ execution

    def delay_seconds(self) -> float:
        """Jittered delay before the next request.

        After consecutive fast-flights failures the delay doubles per failure
        (capped), so a rate-limited scraper backs off instead of hammering Google.
        """
        lo, hi = self._settings.get().delay_seconds
        delay = random.uniform(lo, hi)
        failures = self.providers.consecutive_ff_failures
        if failures:
            delay = min(delay * 2**failures, max(MAX_BACKOFF_SECONDS, hi))
        return delay

    async def _delay(self) -> None:
        await self._sleep(self.delay_seconds())

    def _result(self, status: str, error: str | None = None) -> FetchResult:
        return FetchResult(status=status, error=error, next_delay_seconds=self.delay_seconds())

    async def run(self, job: FetchJob) -> FetchResult:
        """Fetch one group-day. Safe to call repeatedly: finished work is skipped."""
        group = next((g for g in self.groups if g.id == job.group), None)
        if group is None:
            return self._result("error", f"unknown or disabled Turkey airport group: {job.group}")
        if not is_fetchable(job.date):
            return self._result("skipped")
        force_after = utcnow() - timedelta(seconds=MIN_FORCE_AGE_SECONDS) if job.force else None
        run = _Run(job.direction, job.foreign.upper(), group, job.date, job.detail, force_after)
        airports = self._airports_needing_fetch(run)
        if not airports:
            return self._result("skipped")
        if not self._claims.claim(run.claim_key, CLAIM_SECONDS):
            return self._result("busy")
        try:
            error = await self._execute(run, airports)
        finally:
            self._claims.release(run.claim_key)
        return self._result("error" if error else "done", error)

    async def _execute(self, run: _Run, airports: list[str]) -> str | None:
        """Returns an error message if nothing could be fetched, else None."""
        try:
            provider = self.providers.active()
        except ProviderUnavailableError as exc:
            self._record_errors(run, airports, str(exc), provider_name="none")
            return str(exc)
        if isinstance(provider, SerpApiProvider):
            if run.detail:
                return await self._fetch_group(provider, run)
            return await self._fetch_overview(provider, run)
        return await self._fetch_airports(provider, run, airports)

    async def _fetch_airports(
        self, provider: FlightProvider, run: _Run, airports: list[str]
    ) -> str | None:
        errors: list[str] = []
        empty: list[str] = []
        for i, airport in enumerate(airports):
            if i:
                await self._delay()
            origin, dest = route_endpoints(run.direction, airport, run.foreign)
            try:
                flights = await provider.search_one_way(origin, dest, run.date)
            except ProviderError as exc:
                self.providers.record_failure(provider, str(exc))
                self._cache.store_error(run.route_key(airport), str(exc), provider=provider.name)
                errors.append(str(exc))
                continue
            self.providers.record_success(provider)
            self._store(run, airport, flights, provider.name, Completeness.FULL)
            if not flights:
                empty.append(airport)
        if empty and self._should_double_check(provider):
            await self._delay()
            await self._double_check_empty(run, empty)
        return errors[0] if errors and len(errors) == len(airports) else None

    def _should_double_check(self, provider: FlightProvider) -> bool:
        """In auto mode, empty fast-flights results are re-checked with SerpApi.

        Google's single-airport page sometimes has no itineraries for smaller
        airports (e.g. BRS/LBA → KHI) even though connections exist.
        """
        return (
            provider is self.providers.fast_flights
            and self._settings.get().provider_mode is ProviderMode.AUTO
            and self.providers.serpapi_usable()
        )

    async def _double_check_empty(self, run: _Run, airports: list[str]) -> None:
        """One SerpApi query for the airports fast-flights found empty (full data)."""
        serp = self.providers.serpapi
        origin, dest = route_endpoints(run.direction, ",".join(airports), run.foreign)
        try:
            flights = await serp.search_one_way(origin, dest, run.date)
        except ProviderError as exc:
            # Keep fast-flights' empty result; the double-check is best effort.
            self.providers.record_failure(serp, str(exc))
            log.warning("SerpApi double-check failed for %s: %s", run.claim_key, exc)
            return
        self.providers.record_success(serp)
        by_airport = self._split_by_uk_airport(run.direction, flights)
        for airport in airports:
            self._store(run, airport, by_airport.get(airport, []), serp.name, Completeness.FULL)

    async def _fetch_group(self, provider: SerpApiProvider, run: _Run) -> str | None:
        flights, error = await self._serpapi_search(provider, run, run.group.airports)
        if flights is None:
            return error
        by_airport = self._split_by_uk_airport(run.direction, flights)
        for airport in run.group.airports:
            self._store(run, airport, by_airport.get(airport, []), provider.name, Completeness.FULL)
        return None

    async def _fetch_overview(self, provider: SerpApiProvider, run: _Run) -> str | None:
        while True:
            batch = next((b for b in self.batches() if run.group in b), [run.group])
            airports = [a for g in batch for a in g.airports]
            try:
                flights, error = await self._serpapi_search(
                    provider, run, airports, raise_too_many=True
                )
            except TooManyAirportsError:
                if len(airports) <= 1 or len(batch) == 1:
                    self._record_errors(run, run.group.airports, "too many airports", provider.name)
                    return "too many airports"
                new_size = max(1, len(airports) // 2)
                log.warning(
                    "SerpApi rejected %d airports; batch size -> %d", len(airports), new_size
                )
                self._settings.set_value(BATCH_SIZE_KEY, str(new_size))
                continue
            break
        if flights is None:
            return error
        by_airport = self._split_by_uk_airport(run.direction, flights)
        for group in batch:
            for airport in group.airports:
                # Absence in an overview may mean "crowded out", so it is stored as a
                # *partial* empty result (never authoritative; detail queries replace it).
                self._store(
                    run, airport, by_airport.get(airport, []), provider.name, Completeness.PARTIAL
                )
        return None

    async def _serpapi_search(
        self,
        provider: SerpApiProvider,
        run: _Run,
        airports: list[str],
        raise_too_many: bool = False,
    ) -> tuple[list[FlightOption] | None, str | None]:
        origin, dest = route_endpoints(run.direction, ",".join(airports), run.foreign)
        try:
            flights = await provider.search_one_way(origin, dest, run.date)
        except TooManyAirportsError:
            if raise_too_many:
                raise
            self._record_errors(run, run.group.airports, "too many airports", provider.name)
            return None, "too many airports"
        except ProviderError as exc:
            self.providers.record_failure(provider, str(exc))
            self._record_errors(run, run.group.airports, str(exc), provider.name)
            return None, str(exc)
        self.providers.record_success(provider)
        return flights, None

    @staticmethod
    def _split_by_uk_airport(
        direction: Direction, flights: list[FlightOption]
    ) -> dict[str, list[FlightOption]]:
        out: dict[str, list[FlightOption]] = {}
        for f in flights:
            is_from = direction in (Direction.FROM_TR, Direction.FROM_UK)
            turkey_airport = f.origin_airport if is_from else f.destination_airport
            out.setdefault(turkey_airport, []).append(f)
        return out

    def _store(
        self,
        run: _Run,
        airport: str,
        flights: list[FlightOption],
        provider: str,
        completeness: Completeness,
    ) -> None:
        self._cache.store_result(
            run.route_key(airport),
            flights,
            provider=provider,
            completeness=completeness,
            ttl_days=self._settings.get().ttl_days,
        )

    def _record_errors(
        self, run: _Run, airports: list[str], message: str, provider_name: str
    ) -> None:
        for airport in airports:
            self._cache.store_error(run.route_key(airport), message, provider=provider_name)


__all__ = ["Fetcher", "ProviderManager", "needs_fetch", "route_endpoints"]
