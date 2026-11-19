"""Application service container, built once per process (or per serverless instance)."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Request

from .cache import ClaimStore, FlightCache, SettingsStore, UsageStore, open_database
from .config import EnvSettings
from .db import Database
from .fetcher import Fetcher, ProviderManager
from .models import UKGroup
from .providers.base import FlightProvider
from .providers.fast_flights import FastFlightsProvider
from .providers.serpapi import SerpApiProvider
from .summary import SummaryBuilder
from .uk_groups import GroupStore, load_groups


@dataclass
class AppState:
    env: EnvSettings
    db: Database
    cache: FlightCache
    settings: SettingsStore
    usage: UsageStore
    providers: ProviderManager
    fetcher: Fetcher
    summaries: SummaryBuilder
    group_store: GroupStore

    @property
    def groups(self) -> tuple[UKGroup, ...]:
        """Currently enabled Turkey airport groups (read from the database each time)."""
        return self.group_store.enabled()

    @classmethod
    def build(
        cls,
        env: EnvSettings,
        *,
        db: Database | None = None,
        fast_flights: FlightProvider | None = None,
        serpapi: SerpApiProvider | None = None,
        groups: tuple[UKGroup, ...] | None = None,
        sleep=None,
    ) -> AppState:
        db = db or open_database(env)
        cache = FlightCache(db)
        settings = SettingsStore(db, env)
        usage = UsageStore(db)
        group_store = GroupStore(settings, groups if groups is not None else load_groups())
        serp = serpapi or SerpApiProvider(
            env.serpapi_api_key,
            reserve=lambda: usage.try_reserve(settings.get().serpapi_monthly_cap),
        )
        providers = ProviderManager(
            fast_flights or FastFlightsProvider(env.google_consent_cookie),
            serp,
            settings,
            usage,
        )
        fetcher = Fetcher(
            cache,
            settings,
            providers,
            ClaimStore(db),
            group_store.enabled,
            default_batch_size=env.serpapi_batch_max_airports,
            **({"sleep": sleep} if sleep else {}),
        )
        # CACHE_TTL_DAYS may have changed since entries were stored.
        cache.apply_ttl_if_changed(env.cache_ttl_days, settings)
        return cls(
            env=env,
            db=db,
            cache=cache,
            settings=settings,
            usage=usage,
            providers=providers,
            fetcher=fetcher,
            summaries=SummaryBuilder(cache),
            group_store=group_store,
        )


def get_state(request: Request) -> AppState:
    return request.app.state.services
