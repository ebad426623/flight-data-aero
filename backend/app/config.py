"""Environment-driven defaults and filesystem paths.

Values from `.env` are only *defaults*: once the app has run, user-editable
settings live in SQLite (see `cache.SettingsStore`).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
DATA_DIR = REPO_ROOT / "data"
TURKEY_AIRPORTS_CONFIG = BACKEND_DIR / "config" / "turkey_airports.json"
UK_AIRPORTS_CONFIG = TURKEY_AIRPORTS_CONFIG if TURKEY_AIRPORTS_CONFIG.exists() else BACKEND_DIR / "config" / "uk_airports.json"
# Vite builds the frontend here; FastAPI serves it (Vercel moves these files to its CDN).
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"

# Domain constants from the spec.
WEEK_HALF_SPAN = 3  # days either side of the centre date
MAX_DAYS_AHEAD = 330  # beyond this, flights are "not yet on sale"
ERROR_CACHE_MINUTES = 15
AUTO_FAILOVER_THRESHOLD = 3  # consecutive fast-flights failures
AUTO_FAILOVER_MINUTES = 30
MIN_DELAY_SECONDS = 0.001
MAX_DELAY_SECONDS = 60.0
MAX_BACKOFF_SECONDS = 30.0  # cap for the failure backoff added to the delay
CLAIM_SECONDS = 90  # how long one request may hold a group-day while fetching it
MIN_FORCE_AGE_SECONDS = 120  # refresh ignores data fetched more recently than this
USAGE_SYNC_MINUTES = 30  # how often the SerpApi counter is re-synced from SerpApi


def parse_delay_range(value: str | list[float] | tuple[float, float]) -> tuple[float, float]:
    """Parse "1-3", "2" or [1, 3] into a (min, max) tuple of seconds."""
    if isinstance(value, list | tuple):
        lo, hi = float(value[0]), float(value[-1])
    else:
        parts = str(value).replace(" ", "").split("-")
        lo, hi = float(parts[0]), float(parts[-1])
    if lo < MIN_DELAY_SECONDS or hi > MAX_DELAY_SECONDS or hi < lo:
        raise ValueError(
            f"delay range must satisfy {MIN_DELAY_SECONDS} <= min <= max <= "
            f"{MAX_DELAY_SECONDS} seconds, got {value!r}"
        )
    return lo, hi


class EnvSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    serpapi_api_key: str = ""
    provider_mode: str = "fast_flights"
    cache_ttl_days: int = Field(default=2, ge=1, le=5)
    serpapi_monthly_cap: int = Field(default=230, ge=0)
    serpapi_batch_max_airports: int = Field(default=7, ge=1)
    fetch_concurrency: int = Field(default=8, ge=1, le=64)
    fetch_delay_seconds: str = "0.5-1"
    google_consent_cookie: bool = True
    # When set, changing settings, cities or clearing the cache needs this password
    # (X-Admin-Password header). Leave empty for local, single-user use.
    admin_password: str = ""
    # Turso (hosted SQLite) for deployments without a persistent disk, e.g. Vercel.
    # Leave empty to use the local SQLite file at db_path.
    turso_database_url: str = ""
    turso_auth_token: str = ""
    db_path: Path = DATA_DIR / "flights.db"

    @field_validator("fetch_delay_seconds")
    @classmethod
    def _check_delay(cls, v: str) -> str:
        parse_delay_range(v)
        return v


@lru_cache
def get_env() -> EnvSettings:
    return EnvSettings()
