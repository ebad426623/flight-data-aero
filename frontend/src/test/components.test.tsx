import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { cellTooltip } from "../components/cellTooltip";
import { CitySidebar, sortGroups } from "../components/CitySidebar";
import { computeHighlights } from "../components/flightHighlights";
import { FlightTable } from "../components/FlightTable";
import { Heatmap } from "../components/Heatmap";
import { day, flight, group, week } from "./fixtures";

describe("sortGroups", () => {
  const gs = [group("NCL", "Newcastle", 498), group("LON", "London", 388), group("BRS", "Bristol", null)];
  it("sorts by price with no-price groups last", () => {
    expect(sortGroups(gs, "price").map((g) => g.group_id)).toEqual(["LON", "NCL", "BRS"]);
  });
  it("sorts alphabetically", () => {
    expect(sortGroups(gs, "alpha").map((g) => g.name)).toEqual(["Bristol", "London", "Newcastle"]);
  });
});

describe("CitySidebar", () => {
  it("shows prices, dashes and selects a city", () => {
    const onSelect = vi.fn();
    render(
      <CitySidebar
        groups={[group("LON", "London", 388), group("BRS", "Bristol", null)]}
        selected="LON"
        sort="price"
        onSort={() => {}}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText("₺388")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Bristol"));
    expect(onSelect).toHaveBeenCalledWith("BRS");
  });
});

describe("cellTooltip", () => {
  it("includes fetch time, stale and partial notes", () => {
    const t = cellTooltip(day({ is_stale: true, is_partial: true }), "London");
    expect(t).toContain("London");
    expect(t).toContain("fetched");
    expect(t).toContain("Stale");
    expect(t).toContain("select this city for the full list");
  });
  it("describes not-on-sale days", () => {
    expect(cellTooltip(day({ status: "not_on_sale", cheapest_price: null }))).toContain("Not yet on sale");
  });
});

describe("Heatmap", () => {
  it("renders distinct cell states and handles clicks", () => {
    const onSelect = vi.fn();
    const dates = ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"];
    const days = [
      day({ date: dates[0], cheapest_price: 400, is_partial: true }),
      day({ date: dates[1], cheapest_price: null, status: "error", error: "boom" }),
      day({ date: dates[2], cheapest_price: null, status: "empty" }),
      day({ date: dates[3], cheapest_price: null, status: "not_on_sale" }),
    ];
    render(<Heatmap week={week([group("NCL", "Newcastle", 400, days)], dates)} selectedGroup="NCL" selectedDay={dates[0]!} onSelect={onSelect} />);
    expect(screen.getByText("₺400*")).toBeInTheDocument();
    expect(screen.getByText("⚠")).toBeInTheDocument();
    expect(screen.getByText("not on sale").closest("button")).toBeDisabled();
    fireEvent.click(screen.getByText("₺400*"));
    expect(onSelect).toHaveBeenCalledWith("NCL", dates[0]);
  });
});

describe("computeHighlights", () => {
  it("finds cheapest and shortest per day", () => {
    const a = flight({ id: "a", price_gbp: 300, duration_minutes: 900 });
    const b = flight({ id: "b", price_gbp: 450, duration_minutes: 500 });
    const c = flight({ id: "c", price_gbp: 200, departure_local: "2027-01-01T10:00:00" });
    const h = computeHighlights([a, b, c]);
    expect([...h.cheapest].sort()).toEqual(["a", "c"]);
    expect(h.shortest.has("b")).toBe(true);
  });
});

describe("FlightTable", () => {
  const flights = [
    flight({ id: "a", origin_airport: "LHR", price_gbp: 500, duration_minutes: 600 }),
    flight({ id: "b", origin_airport: "STN", price_gbp: 350, duration_minutes: 900, flight_numbers: ["PC 1"] }),
    flight({ id: "c", origin_airport: "LGW", price_gbp: null, duration_minutes: 700 }),
  ];

  const airportsInOrder = () =>
    screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0]!.textContent);

  it("sorts by the given column with nulls last", () => {
    render(<FlightTable flights={flights} direction="from_tr" showDate={false} sort={{ id: "price", dir: "asc" }} onSort={() => {}} />);
    expect(airportsInOrder()).toEqual(["STN", "LHR", "LGW"]);
  });

  it("reports header clicks as sort changes", () => {
    const onSort = vi.fn();
    render(<FlightTable flights={flights} direction="from_tr" showDate={false} sort={{ id: "price", dir: "asc" }} onSort={onSort} />);
    fireEvent.click(screen.getByRole("button", { name: /Duration/ }));
    expect(onSort).toHaveBeenCalledWith({ id: "duration", dir: "asc" });
    fireEvent.click(screen.getByRole("button", { name: /Price/ }));
    expect(onSort).toHaveBeenLastCalledWith({ id: "price", dir: "desc" });
  });

  it("expands a row to show details with dashes for missing fields", () => {
    render(<FlightTable flights={flights} direction="from_tr" showDate={false} sort={{ id: "price", dir: "asc" }} onSort={() => {}} />);
    fireEvent.click(screen.getAllByText("STN")[0]!);
    expect(screen.getByText("PC 1")).toBeInTheDocument();
    expect(screen.getByText("Self-transfer").nextSibling?.textContent).toBe("—");
  });

  it("shows the date column on the whole-week tab and +1 arrivals", () => {
    render(<FlightTable flights={flights} direction="from_tr" showDate sort={{ id: "price", dir: "asc" }} onSort={() => {}} />);
    expect(screen.getByRole("button", { name: /Date/ })).toBeInTheDocument();
    expect(screen.getAllByText("+1")).toHaveLength(3);
  });
});

describe("FlightTable render stability", () => {
  // Regression: an unstable `sorting` array plus TanStack's auto-reset caused an
  // endless synchronous re-render (page froze) when switching cities. A runaway
  // loop would starve the test timer, so a tripwire getter fails fast instead.
  function tripwireFlight(id: string) {
    let reads = 0;
    const f = flight({ id });
    Object.defineProperty(f, "price_gbp", {
      get() {
        if (++reads > 2000) throw new Error("FlightTable is re-rendering endlessly");
        return 400;
      },
    });
    return f;
  }

  it("settles after the parent re-renders with new data", async () => {
    const { useState } = await import("react");
    const { act } = await import("@testing-library/react");
    let setFlights: (f: ReturnType<typeof flight>[]) => void = () => {};
    function Parent() {
      const [fl, setFl] = useState([tripwireFlight("a")]);
      setFlights = setFl;
      // A fresh sort object every render, as App passes it from URL state.
      return <FlightTable flights={fl} direction="from_tr" showDate={false} sort={{ id: "price", dir: "asc" }} onSort={() => {}} />;
    }
    render(<Parent />);
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        setFlights([tripwireFlight(`b${i}`), flight({ id: `c${i}`, price_gbp: 100 })]);
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });
});
