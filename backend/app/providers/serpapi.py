"""SerpApi Google Flights adapter (optional fallback, paid quota).

Docs: https://serpapi.com/google-flights-api
"""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from datetime import date, datetime
from typing import Any

import httpx

from ..models import Baggage, BagStatus, FlightOption
from .base import (
    ProviderError,
    ProviderUnavailableError,
    Segment,
    TooManyAirportsError,
    build_flight_option,
)

log = logging.getLogger(__name__)

NAME = "serpapi"
ENDPOINT = "https://serpapi.com/search.json"
ACCOUNT_ENDPOINT = "https://serpapi.com/account.json"  # free, not counted as a search
NO_RESULTS_MARKERS = ("hasn't returned any results", "no results")
TOO_MANY_AIRPORTS = re.compile(r"(too many|maximum|at most|up to)\b.*\b(airport|location|id)", re.I)


def _parse_time(value: str) -> datetime:
    # SerpApi format: "2026-12-31 08:15"
    return datetime.strptime(value, "%Y-%m-%d %H:%M")


def _bag_status(texts: list[str], kind: str) -> BagStatus:
    pattern = r"carry[- ]?on" if kind == "carry_on" else r"checked"
    for text in texts:
        t = text.lower()
        if not re.search(pattern, t):
            continue
        if re.search(r"\b(fee|charge|extra cost|not included)\b", t):
            return "fee"
        if re.search(r"\b(included|free|1 free)\b", t):
            return "included"
    return "unknown"


def parse_baggage(texts: list[str]) -> Baggage | None:
    relevant = [t for t in texts if re.search(r"bag|carry[- ]?on|luggage", t, re.I)]
    if not relevant:
        return None
    return Baggage(
        carry_on=_bag_status(relevant, "carry_on"),
        checked=_bag_status(relevant, "checked"),
        raw="; ".join(relevant),
    )


def _self_transfer(texts: list[str]) -> bool | None:
    joined = " ".join(texts).lower()
    if "self transfer" in joined or "self-transfer" in joined or "separate tickets" in joined:
        return True
    return None


def map_itinerary(item: dict[str, Any]) -> FlightOption:
    legs = item["flights"]
    segments = [
        Segment(
            origin=leg["departure_airport"]["id"],
            destination=leg["arrival_airport"]["id"],
            departure=_parse_time(leg["departure_airport"]["time"]),
            arrival=_parse_time(leg["arrival_airport"]["time"]),
            duration_minutes=leg.get("duration"),
            airline=leg.get("airline"),
            flight_number=leg.get("flight_number"),
            aircraft=leg.get("airplane"),
        )
        for leg in legs
    ]
    overrides = [
        {
            k: v
            for k, v in (
                ("duration_minutes", lay.get("duration")),
                ("overnight", lay.get("overnight")),
            )
            if v is not None
        }
        for lay in item.get("layovers") or []
    ]
    texts: list[str] = list(item.get("extensions") or [])
    for leg in legs:
        texts.extend(leg.get("extensions") or [])
    price = item.get("price")
    return build_flight_option(
        segments,
        provider=NAME,
        price=float(price) if isinstance(price, int | float) else None,
        currency="TRY",
        total_duration=item.get("total_duration"),
        layover_overrides=overrides,
        baggage=parse_baggage(texts),
        is_self_transfer=_self_transfer(texts),
    )


def parse_response(data: dict[str, Any]) -> list[FlightOption]:
    """Combine best_flights and other_flights into FlightOptions."""
    if error := data.get("error"):
        if any(m in error.lower() for m in NO_RESULTS_MARKERS):
            return []
        if TOO_MANY_AIRPORTS.search(error):
            raise TooManyAirportsError(error)
        raise ProviderError(f"SerpApi error: {error}")
    options: dict[str, FlightOption] = {}
    for item in [*(data.get("best_flights") or []), *(data.get("other_flights") or [])]:
        try:
            option = map_itinerary(item)
        except (KeyError, TypeError, ValueError) as exc:
            log.warning("skipping malformed SerpApi itinerary: %s", exc)
            continue
        options.setdefault(option.id, option)
    return list(options.values())


class SerpApiProvider:
    """SerpApi client. `reserve` is called before every request and must return
    False if the monthly cap would be exceeded (the request is then not sent)."""

    name = NAME

    def __init__(
        self,
        api_key: str,
        reserve: Callable[[], bool],
        client: httpx.AsyncClient | None = None,
    ):
        self._api_key = api_key
        self._reserve = reserve
        self._client = client or httpx.AsyncClient(timeout=60)

    @property
    def available(self) -> bool:
        return bool(self._api_key)

    async def search_one_way(self, origin: str, destination: str, date: date) -> list[FlightOption]:
        if not self._api_key:
            raise ProviderUnavailableError("SERPAPI_API_KEY is not set")
        if not self._reserve():
            raise ProviderUnavailableError("SerpApi monthly cap reached")
        params = {
            "engine": "google_flights",
            "type": "2",
            "adults": "1",
            "travel_class": "1",
            "currency": "TRY",
            "gl": "tr",
            "hl": "en",
            "departure_id": origin,
            "arrival_id": destination,
            "outbound_date": date.isoformat(),
            "api_key": self._api_key,
        }
        try:
            resp = await self._client.get(ENDPOINT, params=params)
            data = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError(f"SerpApi request failed: {exc}") from exc
        if resp.status_code >= 400 and "error" not in data:
            raise ProviderError(f"SerpApi HTTP {resp.status_code}")
        return parse_response(data)

    async def account_usage(self) -> int | None:
        """Searches used this month according to SerpApi (None if unavailable)."""
        if not self._api_key:
            return None
        try:
            resp = await self._client.get(ACCOUNT_ENDPOINT, params={"api_key": self._api_key})
            value = resp.json().get("this_month_usage")
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("SerpApi account lookup failed: %s", exc)
            return None
        return value if isinstance(value, int) else None

    async def aclose(self) -> None:
        await self._client.aclose()
