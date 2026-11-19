"""Currency conversion and exchange rates supporting TRY (TL), PKR, GBP, and USD."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx

log = logging.getLogger(__name__)

# Fallback exchange rates relative to 1 TRY (Base: TRY = 1.0)
DEFAULT_RATES_FROM_TRY: dict[str, float] = {
    "TRY": 1.0,
    "TL": 1.0,
    "PKR": 5.5,
    "GBP": 0.015,
    "USD": 0.020,
    "EUR": 0.018,
}

CURRENCY_SYMBOLS: dict[str, str] = {
    "TRY": "₺",
    "TL": "₺",
    "PKR": "₨",
    "GBP": "£",
    "USD": "$",
    "EUR": "€",
}

_cached_rates: dict[str, float] = dict(DEFAULT_RATES_FROM_TRY)
_last_fetch_time: datetime | None = None
CACHE_DURATION_HOURS = 12


def get_exchange_rates() -> dict[str, float]:
    """Get exchange rates (relative to 1 TRY)."""
    return dict(_cached_rates)


def refresh_exchange_rates_sync() -> dict[str, float]:
    """Attempt to refresh rates from free API with fallback to cached/defaults."""
    global _last_fetch_time, _cached_rates
    now = datetime.now(timezone.utc)
    if _last_fetch_time and (now - _last_fetch_time).total_seconds() < CACHE_DURATION_HOURS * 3600:
        return dict(_cached_rates)
    try:
        resp = httpx.get("https://open.er-api.com/v6/latest/TRY", timeout=3.0)
        if resp.status_code == 200:
            data = resp.json()
            rates = data.get("rates", {})
            for code in ["TRY", "PKR", "GBP", "USD", "EUR"]:
                if code in rates:
                    _cached_rates[code] = float(rates[code])
            _cached_rates["TL"] = _cached_rates["TRY"]
            _last_fetch_time = now
            log.info("Refreshed exchange rates: TRY/PKR = %s", _cached_rates.get("PKR"))
    except Exception as exc:
        log.warning("Could not fetch live exchange rates, using defaults: %s", exc)
    return dict(_cached_rates)


def convert_currency(amount: float | None, from_curr: str, to_curr: str) -> float | None:
    if amount is None:
        return None
    from_c = from_curr.upper()
    to_c = to_curr.upper()
    if from_c == to_c or (from_c in ("TRY", "TL") and to_c in ("TRY", "TL")):
        return round(amount, 2)

    rates = get_exchange_rates()
    rate_from = rates.get(from_c, 1.0)
    rate_to = rates.get(to_c, 1.0)

    # Convert from source currency to TRY, then to target currency
    amount_in_try = amount / rate_from
    converted = amount_in_try * rate_to
    return round(converted, 2)
