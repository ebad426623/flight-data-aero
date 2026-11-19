import { describe, expect, it } from "vitest";
import { addDays, isValidISODate, rangeLabel, todayISO, weekDates } from "../lib/dates";
import { expiresIn, fetchedAgo, formatDuration, formatPrice, localTime } from "../lib/format";
import { priceColor } from "../lib/heatmap";
import { DEFAULT_FOREIGN, parseState, serializeState } from "../lib/urlState";

describe("dates", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });
  it("builds a 7-day week centred on the date", () => {
    const w = weekDates("2026-12-31");
    expect(w).toHaveLength(7);
    expect(w[0]).toBe("2026-12-28");
    expect(w[3]).toBe("2026-12-31");
    expect(w[6]).toBe("2027-01-03");
  });
  it("labels the range", () => {
    expect(rangeLabel(weekDates("2027-01-01"))).toBe("29 Dec – 4 Jan 2027");
  });
  it("validates ISO dates", () => {
    expect(isValidISODate("2026-02-30")).toBe(false);
    expect(isValidISODate("2026-12-31")).toBe(true);
    expect(isValidISODate("31/12/2026")).toBe(false);
  });
  it("today uses local calendar date", () => {
    expect(todayISO(new Date(2026, 10, 17, 23, 30))).toBe("2026-11-17");
  });
});

describe("format", () => {
  it("formats prices", () => {
    expect(formatPrice(410)).toBe("₺410");
    expect(formatPrice(410.4, true)).toBe("₺410*");
    expect(formatPrice(null)).toBe("—");
    expect(formatPrice(1234)).toBe("₺1,234");
  });
  it("formats durations", () => {
    expect(formatDuration(670)).toBe("11h 10m");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(null)).toBe("—");
  });
  it("keeps airport-local wall-clock time", () => {
    expect(localTime("2026-12-31T00:20:00")).toBe("00:20");
  });
  it("describes cache age and expiry", () => {
    const now = new Date("2026-11-17T12:00:00Z");
    expect(fetchedAgo("2026-11-16T22:00:00Z", now)).toBe("fetched 14 h ago");
    expect(expiresIn("2026-11-18T22:00:00Z", now)).toBe("expires in 34 h");
    expect(expiresIn("2026-11-17T09:00:00Z", now)).toBe("expired 3 h ago");
    expect(fetchedAgo(null, now)).toBe("not fetched yet");
  });
});

describe("heatmap colour", () => {
  it("goes from green (min) to red (max)", () => {
    expect(priceColor(100, 100, 200)).toBe("hsl(120 70% 82%)");
    expect(priceColor(200, 100, 200)).toBe("hsl(0 70% 82%)");
    expect(priceColor(150, 100, 200)).toBe("hsl(60 70% 82%)");
  });
  it("handles a flat week and missing prices", () => {
    expect(priceColor(100, 100, 100)).toBe("hsl(120 70% 82%)");
    expect(priceColor(null, 100, 200)).toBeUndefined();
  });
});

describe("url state", () => {
  const now = new Date(2026, 10, 17);
  it("defaults to today + 10 days and KHI", () => {
    const s = parseState("", now);
    expect(s.center).toBe("2026-11-27");
    expect(s.day).toBe("2026-11-27");
    expect(s.foreign).toBe(DEFAULT_FOREIGN);
    expect(s.direction).toBe("from_tr");
    expect(s.sort).toEqual({ id: "price", dir: "asc" });
  });
  it("round-trips through the query string", () => {
    const s = parseState("dir=to_tr&foreign=dxb&date=2026-12-31&group=IST&day=week&sort=duration:desc&cities=alpha", now);
    expect(s).toMatchObject({
      direction: "to_tr",
      foreign: "DXB",
      center: "2026-12-31",
      group: "IST",
      day: "week",
      sort: { id: "duration", dir: "desc" },
      citySort: "alpha",
    });
    expect(parseState(serializeState(s), now)).toEqual(s);
  });
  it("ignores invalid values", () => {
    const s = parseState("dir=sideways&foreign=TOOLONG&date=nope&sort=x:y", now);
    expect(s.direction).toBe("from_tr");
    expect(s.foreign).toBe("KHI");
    expect(s.center).toBe("2026-11-27");
    expect(s.sort).toEqual({ id: "price", dir: "asc" });
  });
});
