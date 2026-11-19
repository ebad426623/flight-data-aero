# Aero Turkey Flight Finder

<img src="frontend/public/favicon.svg" width="48" alt="Aero logo">

Aero is a web app that compares one-way economy flights between one international airport and Turkey's major airports, a week at a time, so you can pick the cheapest or most convenient Turkish airport. It shows data only. It does not book or link to booking sites.

- **From Turkey**: every enabled Turkish airport → one destination (e.g. Istanbul → Karachi KHI)
- **To Turkey**: one origin → every enabled Turkish airport

See [spec.md](spec.md) for the full specification.

## Credits

Turkey adaptation and deployment by [Ebad](https://github.com/ebad426623).
This project is forked from [Aly Gilani's original Aero repository](https://github.com/AlyAsad/flight-data-aero).

## Live site

**Live:** [flight-data-aero.vercel.app](https://flight-data-aero.vercel.app/)

Or run it on your own computer (below). Both work the same way.

## Quick start

Prerequisites: Python 3.12, [uv](https://docs.astral.sh/uv/getting-started/installation/), Node 20+. Install uv with `curl -LsSf https://astral.sh/uv/install.sh | sh`. Use the standalone installer rather than `pip install uv` under pyenv, because pyenv shims can clash with uv.

```bash
cp .env.example .env        # optionally add SERPAPI_API_KEY
make install                # uv sync + npm install
make start                  # starts the server on localhost
```

`make start` builds the frontend and serves everything from FastAPI on `http://localhost:8000` as a single process. The server binds to `127.0.0.1` only.

Run `make help` to list every target.

## Using it

1. Choose a direction and type the foreign airport (name, city or IATA code).
2. Pick a date. The view covers 3 days before to 3 days after it. Use ◂ ▸ to move a week at a time.
3. The **sidebar** shows each Turkey airport group's cheapest fare that week. The **heatmap** shows the cheapest fare per airport and day (green is cheap, red is expensive).
4. Click an airport or cell to load its **day tabs** and **flight list**. Click any column header to sort. Click a row to see layovers, flight numbers, aircraft, baggage and provider.

Results fill in as they arrive: the page asks the server for each missing city-day in turn (a few at a time) and refreshes as they land. The status line shows progress ("Loading 23 of 77"), the active provider and any warnings. Hover a cell or tab to see when its data was fetched.

| Marker | Meaning |
| --- | --- |
| `£410*` | Partial: from a SerpApi overview search. Select the city to load the full list. |
| dashed cell / "stale" | Expired data, shown because a newer fetch hasn't succeeded yet |
| ⚠ | The fetch failed. It is retried after 15 minutes, or sooner with Refresh. |
| hatched cell | Date is in the past, or not yet on sale (more than ~330 days out) |

**⟳ Refresh week** (top bar) re-fetches the week shown. **Cache** (in ⚙ settings, admin only on a protected site): Refresh all cache (marks everything expired, then re-fetches the view) and Clear cache.
**⚙ settings**: provider mode, SerpApi cap and usage, concurrency, request delay (in ms, minimum 1) and which Turkey airports to include. Cache expiry is server configuration only (`CACHE_TTL_DAYS`). Enabling or disabling an airport updates the sidebar and heatmap straight away.

## Data providers

| Provider | Cost | Notes |
| --- | --- | --- |
| [fast-flights](https://github.com/AWeirdDev/fast-flights) 3.1.0 (default) | Free | Unofficial Google Flights scraper, one request per Turkey airport per day. Includes flight numbers. No baggage or self-transfer info. |
| [SerpApi](https://serpapi.com/google-flights-api) (optional) | 250 searches/month free | Richer data. Searches a whole city group in one request. Usage is tracked and never exceeds the cap (default 230). |

Provider modes:

- `fast_flights` (default): fast-flights only.
- `auto`: uses fast-flights. After 3 consecutive failures it switches to SerpApi for 30 minutes, if a key is set. When fast-flights finds no flights for some airports in a city on a given day, one SerpApi query re-checks just those airports. That costs 1 search per empty city-day, stays within the cap, and isn't repeated until the cache expires.
- `serpapi`: SerpApi only.

In SerpApi mode the other cities are filled by **overview** queries, which batch up to 7 airports per request (`SERPAPI_BATCH_MAX_AIRPORTS`). If SerpApi rejects a batch as too large, the batch size is halved and the lower size is remembered. The selected city gets a complete **detail** query per day. SerpApi accepted 8 airports in testing, so 7 is a conservative default. Overview results really are partial: in a 7-airport test, Luton was crowded out.

Switching provider mode applies from the next fetch, including the rest of a week that's still loading.

**fast-flights notes**

- Google sometimes answers with a temporary error instead of results, especially to cloud servers (Vercel got results about 60–75% of the time in testing). The adapter retries those twice, 1–2 s apart, and only then records an error (retried after 15 minutes). Routes with genuinely no flights return a normal empty result, so they're never confused with errors.
- Google shows a cookie-consent page to UK/EU IPs. The adapter sends consent cookies (`GOOGLE_CONSENT_COOKIE=true`) so results come back instead.
- fast-flights 3.1.0's own parser skips Google's "best flights" section and drops flight numbers, so the adapter parses the page payload itself and uses fast-flights only to build the query.
- For some less common routes, such as Bristol or Leeds Bradford to Karachi, Google's page holds no results even though SerpApi finds itineraries (usually a coach or rail leg to a hub airport). In `auto` mode the SerpApi double-check fills these in. In `fast_flights` mode they show "—".

## Configuration

`.env` values seed settings on first run. After that, settings live in the database and are edited in the UI. On Vercel, set these as Environment Variables in the project settings instead of a `.env` file.

| Variable | Default | |
| --- | --- | --- |
| `SERPAPI_API_KEY` | (empty) | Enables SerpApi |
| `PROVIDER_MODE` | `fast_flights` | `fast_flights`, `auto` or `serpapi` |
| `CACHE_TTL_DAYS` | `1` | Cache expiry, 1–5 days. Set here only, not in the UI. Applied to existing entries on restart; nothing is re-fetched until it expires or you refresh. |
| `SERPAPI_MONTHLY_CAP` | `230` | Hard cap, never exceeded |
| `SERPAPI_BATCH_MAX_AIRPORTS` | `7` | Max airports per overview query |
| `FETCH_CONCURRENCY` | `8` | City-days fetched in parallel by the browser, max 64 |
| `FETCH_DELAY_SECONDS` | `0.5-1` | Random delay between requests, in seconds (0.001–60). Doubles per consecutive fast-flights failure, up to 30 s. |
| `GOOGLE_CONSENT_COOKIE` | `true` | Send Google consent cookies with fast-flights requests |
| `TURSO_DATABASE_URL` | (empty) | Turso database URL (`libsql://….turso.io`). Empty means the local file `data/flights.db`. Needed on Vercel. |
| `TURSO_AUTH_TOKEN` | (empty) | Token for that Turso database |
| `ADMIN_PASSWORD` | (empty) | If set, changing settings or Turkey airports, Refresh all cache and Clear cache need this password. Leave empty for local use. |

Turkey airport groups are defined in [backend/config/turkey_airports.json](backend/config/turkey_airports.json), and their `"enabled"` values are the defaults. Turn airports on or off in ⚙ settings; that choice is saved in the database and overrides the JSON. Edit the JSON (and restart) only to add an airport or change its IATA code.


## Development

```bash
make test       # pytest + vitest (offline, uses recorded fixtures)
make lint       # ruff + tsc + eslint
make smoke      # one live NCL → KHI search per provider
make smoke ARGS=--record   # re-capture the live fixtures in backend/tests/fixtures/*_live.*
```

```text
backend/
  app/main.py            FastAPI app (the Vercel `api` service); locally also serves frontend/dist
  app/api/routes.py      REST endpoints (/api/...)
  app/fetcher.py         job planning (/week) and execution (/fetch), provider switching
  app/providers/         base.py (interface), fast_flights.py, serpapi.py
  app/cache.py           cache, settings, SerpApi usage, fetch claims
  app/db.py              database backends: local SQLite file or Turso (HTTP)
  app/summary.py         week / day summaries from cache entries
  app/models.py          FlightOption, summaries, jobs, settings
  config/turkey_airports.json
  scripts/smoke.py       live provider check (make smoke)
  tests/                 pytest suite; fixtures/ holds provider responses
frontend/src/
  components/            TopBar, CitySidebar, Heatmap, DayTabs, FlightTable, SettingsDialog, Footer, Logo
  hooks/                 TanStack Query hooks, useFetchQueue
  lib/                   API client, fetch queue, URL state, formatting
pyproject.toml, uv.lock  Python project (deps, tools, Vercel entrypoint)
vercel.json              Vercel services (frontend + api), routes, region, limits
data/                    local SQLite database (git-ignored)
```

### How fetching works

The unit of caching is a **route-day**: one Turkey airport, one foreign airport, one date, one direction. Work is done in **jobs** of one airport group on one date.

1. The page asks `/api/week` for a view. The answer has the cached summary plus the jobs still needed, highest priority first: the selected airport on the selected day, then its other days (nearest first), then every other airport group.
2. The browser runs those jobs through `/api/fetch`, a few at a time (`FETCH_CONCURRENCY`), waiting the delay the server suggests between requests. After each one it refreshes the week, so cells fill in as they land.
3. Changing the week, airport or day drops jobs that haven't started; running ones finish. A job isn't repeated within a view (failures are cached for 15 minutes), except by Refresh.

Every request is short, which is what lets the same code run on Vercel. Cached, unexpired data is never re-fetched unless you refresh, so reloading within the TTL makes no provider calls. A refresh ignores data fetched in the last 2 minutes, so mashing the button can't hammer Google; days that failed are always retried.
