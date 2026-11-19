from datetime import date, timedelta
from app.currency import convert_currency, get_exchange_rates
from app.models import Direction
from app.fetcher import route_endpoints
from tests.conftest import GROUPS, FakeProvider, FakeSerpApi, make_db, no_sleep
from app.state import AppState
from app.main import create_app
from fastapi.testclient import TestClient
from app.uk_groups import load_groups

CENTER = (date.today() + timedelta(days=30)).isoformat()


def test_turkey_airports_configuration():
    groups = load_groups()
    group_map = {g.id: g for g in groups}
    
    # Verify Ankara and both Istanbul airports exist and are enabled
    assert "ESB" in group_map
    assert "IST" in group_map
    assert "SAW" in group_map
    assert "IST_ALL" in group_map
    
    assert group_map["ESB"].enabled
    assert group_map["IST"].enabled
    assert group_map["SAW"].enabled
    assert group_map["IST_ALL"].enabled
    
    assert "ESB" in group_map["ESB"].airports
    assert "IST" in group_map["IST"].airports
    assert "SAW" in group_map["SAW"].airports
    assert "IST" in group_map["IST_ALL"].airports and "SAW" in group_map["IST_ALL"].airports


def test_directions_from_tr_and_to_tr():
    assert Direction.FROM_TR == "from_tr"
    assert Direction.TO_TR == "to_tr"
    
    # Check route endpoints
    orig, dest = route_endpoints(Direction.FROM_TR, "IST", "KHI")
    assert orig == "IST" and dest == "KHI"
    
    orig, dest = route_endpoints(Direction.TO_TR, "IST", "KHI")
    assert orig == "KHI" and dest == "IST"


def test_currency_conversion_tl_and_pkr():
    rates = get_exchange_rates()
    assert "TRY" in rates and "PKR" in rates
    assert rates["TRY"] == 1.0
    assert rates["PKR"] > 1.0  # 1 TRY is multiple PKR
    
    # Convert 1000 TRY to PKR
    pkr = convert_currency(1000.0, "TRY", "PKR")
    assert pkr is not None and pkr > 1000.0
    
    # Round-trip conversion
    back_to_try = convert_currency(pkr, "PKR", "TRY")
    assert back_to_try is not None and abs(back_to_try - 1000.0) < 1.0


def test_api_rates_endpoint(env):
    state = AppState.build(
        env,
        fast_flights=FakeProvider(),
        serpapi=FakeSerpApi(available=False),
        groups=GROUPS,
        sleep=no_sleep,
    )
    client = TestClient(create_app(state, serve_frontend=False))
    res = client.get("/api/rates")
    assert res.status_code == 200
    data = res.json()
    assert data["base"] == "TRY"
    assert "PKR" in data["rates"]
    assert "symbols" in data
    assert data["symbols"]["TRY"] == "₺"
    assert data["symbols"]["PKR"] == "₨"


def test_api_week_with_turkey_direction(env):
    state = AppState.build(
        env,
        fast_flights=FakeProvider(),
        serpapi=FakeSerpApi(available=False),
        groups=GROUPS,
        sleep=no_sleep,
    )
    client = TestClient(create_app(state, serve_frontend=False))
    res = client.get(
        "/api/week",
        params={"direction": "from_tr", "foreign": "KHI", "center_date": CENTER, "selected_group": "LON"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["direction"] == "from_tr"
