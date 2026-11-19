import type { BagStatus, Currency } from "./types";

export const TRY_TO_PKR_APPROX = 5.5;

export interface PriceHolder {
  cheapest_price?: number | null;
  cheapest_price_try?: number | null;
  cheapest_price_pkr?: number | null;
  cheapest_price_gbp?: number | null;
  price?: number | null;
  price_try?: number | null;
  price_pkr?: number | null;
  price_gbp?: number | null;
}

export function getPrice(item: PriceHolder | null | undefined, currency: Currency): number | null {
  if (!item) return null;
  if (currency === "PKR") {
    if (item.price_pkr != null) return item.price_pkr;
    if (item.cheapest_price_pkr != null) return item.cheapest_price_pkr;
    const base = item.cheapest_price ?? item.price;
    return base != null ? base * TRY_TO_PKR_APPROX : null;
  }
  if (item.price_try != null) return item.price_try;
  if (item.cheapest_price_try != null) return item.cheapest_price_try;
  return item.cheapest_price ?? item.price ?? item.price_gbp ?? null;
}

export function getSecondaryPrice(item: PriceHolder | null | undefined): number | null {
  if (!item) return null;
  if (item.price_pkr != null) return item.price_pkr;
  if (item.cheapest_price_pkr != null) return item.cheapest_price_pkr;
  const base = item.cheapest_price_try ?? item.cheapest_price ?? item.price;
  return base != null ? base * TRY_TO_PKR_APPROX : null;
}

export function formatPrice(
  p: number | null | undefined,
  partial = false,
  currency: Currency | "GBP" = "TRY",
  secondary?: number | null,
): string {
  if (p == null) return "—";
  const num = Math.round(p).toLocaleString("en-GB");
  const star = partial ? "*" : "";

  if (currency === "PKR") {
    return `₨${num}${star}`;
  }
  if (currency === "GBP") {
    return `£${num}${star}`;
  }
  if (currency === "BOTH") {
    const sec = secondary != null ? secondary : p * TRY_TO_PKR_APPROX;
    const secNum = Math.round(sec).toLocaleString("en-GB");
    return `₺${num} (₨${secNum})${star}`;
  }
  return `₺${num}${star}`;
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m}m`;
}

/** Local wall-clock time from a naive ISO datetime ("2026-12-31T14:30:00") — no TZ conversion. */
export function localTime(iso: string): string {
  return iso.slice(11, 16);
}

export function localDate(iso: string): string {
  return iso.slice(0, 10);
}

function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 3_600_000;
}

function humanSpan(hours: number): string {
  const abs = Math.abs(hours);
  if (abs < 1) return `${Math.max(1, Math.round(abs * 60))} min`;
  if (abs < 48) return `${Math.round(abs)} h`;
  return `${Math.round(abs / 24)} days`;
}

/** "fetched 14 h ago" */
export function fetchedAgo(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "not fetched yet";
  return `fetched ${humanSpan(hoursBetween(new Date(iso), now))} ago`;
}

/** "expires in 34 h" / "expired 3 h ago" */
export function expiresIn(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "";
  const h = hoursBetween(now, new Date(iso));
  return h > 0 ? `expires in ${humanSpan(h)}` : `expired ${humanSpan(h)} ago`;
}

const stampFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** "29 Dec 09:12" in the user's local time. */
export function formatStamp(iso: string | null | undefined): string {
  return iso ? stampFmt.format(new Date(iso)).replace(",", "") : "—";
}

export const BAG_LABEL: Record<BagStatus, string> = {
  included: "included",
  fee: "for a fee",
  unknown: "unknown",
};

export const PARTIAL_TOOLTIP = "From an overview search; select this city for the full list.";
