"""Provider interface and shared itinerary-building helpers."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import date, datetime
from typing import Protocol, runtime_checkable

from ..currency import convert_currency
from ..models import Baggage, FlightOption, Layover


class ProviderError(Exception):
    """A provider failed to return results (network, parsing, blocked, etc.)."""


class ProviderUnavailableError(ProviderError):
    """The provider cannot be used right now (no API key, cap reached)."""


class TooManyAirportsError(ProviderError):
    """The provider rejected a multi-airport query for listing too many airports."""


@runtime_checkable
class FlightProvider(Protocol):
    name: str

    async def search_one_way(self, origin: str, destination: str, date: date) -> list[FlightOption]:
        """Search one-way flights. `origin`/`destination` may be comma-separated
        airport lists for providers that support multi-airport queries."""
        ...


@dataclass
class Segment:
    origin: str
    destination: str
    departure: datetime  # local, naive
    arrival: datetime  # local, naive
    duration_minutes: int | None = None
    airline: str | None = None
    flight_number: str | None = None
    aircraft: str | None = None


def stable_flight_id(segments: list[Segment]) -> str:
    parts = [
        f"{s.origin}-{s.destination}-{s.departure.isoformat()}-{s.arrival.isoformat()}-"
        f"{s.flight_number or s.airline or ''}"
        for s in segments
    ]
    return hashlib.sha1("|".join(parts).encode()).hexdigest()[:16]


def build_flight_option(
    segments: list[Segment],
    *,
    provider: str,
    price_gbp: float | None = None,
    price: float | None = None,
    currency: str = "TRY",
    airlines: list[str] | None = None,
    total_duration: int | None = None,
    layover_overrides: list[dict] | None = None,
    baggage: Baggage | None = None,
    is_self_transfer: bool | None = None,
) -> FlightOption:
    """Turn an ordered list of segments into a FlightOption.

    Layover durations are derived from consecutive local times at the
    connecting airport (both are in that airport's timezone). Providers that
    report layovers explicitly can pass `layover_overrides` (same order) with
    any of: duration_minutes, overnight.
    """
    if not segments:
        raise ValueError("itinerary has no segments")
    first, last = segments[0], segments[-1]

    layovers: list[Layover] = []
    for i, (prev, nxt) in enumerate(zip(segments, segments[1:], strict=False)):
        gap = int((nxt.departure - prev.arrival).total_seconds() // 60)
        override = (layover_overrides or [])[i] if i < len(layover_overrides or []) else {}
        layovers.append(
            Layover(
                airport=prev.destination,
                duration_minutes=override.get("duration_minutes", gap if gap >= 0 else None),
                overnight=bool(
                    override.get("overnight", nxt.departure.date() > prev.arrival.date())
                ),
                airport_change=prev.destination != nxt.origin,
            )
        )

    if total_duration is None:
        seg_total = [s.duration_minutes for s in segments]
        lay_total = [lay.duration_minutes for lay in layovers]
        if None not in seg_total and None not in lay_total:
            total_duration = sum(seg_total) + sum(lay_total)  # type: ignore[arg-type]

    if airlines is None:
        airlines = list(dict.fromkeys(s.airline for s in segments if s.airline))

    numbers = [s.flight_number for s in segments]
    aircraft = [s.aircraft for s in segments if s.aircraft]

    # Handle prices and multi-currency conversion
    p_try: float | None = None
    p_pkr: float | None = None
    p_gbp: float | None = price_gbp
    raw_price: float | None = price

    if price_gbp is not None:
        p_gbp = price_gbp
        p_try = convert_currency(price_gbp, "GBP", "TRY")
        p_pkr = convert_currency(price_gbp, "GBP", "PKR")
        if raw_price is None:
            raw_price = p_try
            currency = "TRY"
    elif raw_price is not None:
        p_try = convert_currency(raw_price, currency, "TRY")
        p_pkr = convert_currency(raw_price, currency, "PKR")
        p_gbp = convert_currency(raw_price, currency, "GBP")

    return FlightOption(
        id=stable_flight_id(segments),
        origin_airport=first.origin,
        destination_airport=last.destination,
        departure_local=first.departure,
        arrival_local=last.arrival,
        arrival_day_offset=(last.arrival.date() - first.departure.date()).days,
        duration_minutes=total_duration,
        stops=len(segments) - 1,
        layovers=layovers,
        airlines=airlines,
        flight_numbers=numbers if all(numbers) else None,
        aircraft=aircraft or None,
        price_gbp=p_gbp,
        price=raw_price,
        currency=currency,
        price_try=p_try,
        price_pkr=p_pkr,
        baggage=baggage,
        is_self_transfer=is_self_transfer,
        provider=provider,
    )
