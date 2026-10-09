import type { CloudMarketResponse, CloudPricePointPayload } from "../../../api-client/types";
import { fxLegForCurrency, type FxLeg } from "../../../market-data/coordinator/fx-legs";
import { getPublishedUsEquityCalendarDay } from "../../../market-data/published-us-sessions";
import type { PricePoint } from "../../../types/financials";
import { resolveCurrencyUnit } from "../../../utils/currency-units";
import { evidenceDay } from "./risk-evidence";

/** USD per unit of one currency at each completed daily FX close, by date. */
export interface FxCloses {
  currency: string;
  closes: ReadonlyMap<string, number>;
  first: string;
  asOf: string;
}

/** How a listing quoted in another currency is restated in USD. */
export interface RiskConversion {
  /** The listing currency as quoted, sub-units included (GBp, ZAc). */
  listingCurrency: string;
  /** The currency the FX pair prices (GBP for GBp). */
  currency: string;
  /** Listing units per currency unit: 100 for pence. */
  divisor: number;
  leg: FxLeg;
}

export const FX_UNAVAILABLE = "Foreign holdings: daily FX closes unavailable";
export const FX_NO_PAIR = "Foreign holdings: no daily FX pair for this currency";
export const FX_STALE = "Foreign holdings: daily FX history is stale";
export const FX_GAP = "Foreign holdings: daily FX history has gaps on the holding's dates";
export const FX_DISAGREES = "Foreign holdings: daily FX closes disagree with the current rate";
export const LOCAL_GAP = "Foreign holdings: local daily history has a gap longer than a market holiday";

/**
 * Longest run of calendar days a listing may go without a close while US
 * sessions continue (Golden Week, Lunar New Year, national holidays). A longer
 * silence is missing data, not a holiday, and is never carried across.
 */
const MAX_LOCAL_CLOSED_DAYS = 10;
/** The calendar the basket, SPY and the factor proxies share. */
const BASKET_CALENDAR = "NYSE";
const DAY_MS = 86_400_000;

/** The pair that restates a listing currency in USD, or null when there is none. */
export function riskConversion(listingCurrency: string): RiskConversion | null {
  const unit = resolveCurrencyUnit(listingCurrency);
  if (!unit.currency || unit.currency === "USD") return null;
  const leg = fxLegForCurrency(unit.currency);
  return leg ? { listingCurrency, currency: unit.currency, divisor: unit.divisor, leg } : null;
}

/** Completed daily closes of the pair as USD per unit, today's still-trading bar left out. */
export function validateFxHistory(
  response: CloudMarketResponse<CloudPricePointPayload[]>,
  leg: FxLeg,
  now = new Date(),
): FxCloses {
  if (response.status !== "success" || !Array.isArray(response.data) || response.data.length < 2)
    throw new Error(FX_UNAVAILABLE);
  if (response.stale || response.providerMeta?.stale) throw new Error(FX_STALE);
  if (response.data.length > 1500) throw new Error(FX_UNAVAILABLE);
  const today = now.toISOString().slice(0, 10);
  const closes = new Map<string, number>();
  for (const row of response.data) {
    if (
      !row ||
      typeof row.date !== "string" ||
      !Number.isFinite(Date.parse(row.date)) ||
      !evidenceDay(row.date.slice(0, 10)) ||
      !Number.isFinite(row.close) ||
      row.close <= 0
    )
      throw new Error(FX_UNAVAILABLE);
    const date = new Date(row.date).toISOString().slice(0, 10);
    if (date >= today) continue;
    const rate = leg.invert ? 1 / row.close : row.close;
    const previous = closes.get(date);
    if (previous != null && previous !== rate) throw new Error(FX_UNAVAILABLE);
    closes.set(date, rate);
  }
  const dates = [...closes.keys()].sort();
  const asOf = dates.at(-1);
  if (!asOf || Date.parse(today) - Date.parse(asOf) > 7 * DAY_MS) throw new Error(FX_STALE);
  return { currency: leg.currency, closes, first: dates[0]!, asOf };
}

/**
 * Restates a listing's completed local closes in USD on every NYSE session
 * they span, each at the FX close of that same date, so the converted series
 * shares the basket's calendar and its returns pair with SPY and the other
 * holdings interval for interval.
 *
 * On a US session the listing did not trade (its own holiday), the holding is
 * worth its last local close at that day's FX close: its USD value moves with
 * the currency alone, as it would in the account. A US session with no FX
 * close, or a local silence longer than any market holiday, rejects the whole
 * series instead of bridging it. The series ends at the earlier of the last
 * local close and the last FX close, so no close is carried past the data.
 */
export function convertClosesToUsd(
  local: readonly { date: string; close: number }[],
  fx: FxCloses,
  divisor: number,
): PricePoint[] {
  const points = [...local]
    .map((point) => ({ date: point.date.slice(0, 10), close: point.close }))
    .sort((left, right) => left.date.localeCompare(right.date));
  if (points.length < 2) throw new Error("Daily history unavailable");
  const start = points[0]!.date > fx.first ? points[0]!.date : fx.first;
  const end = points.at(-1)!.date < fx.asOf ? points.at(-1)!.date : fx.asOf;
  const converted: PricePoint[] = [];
  let cursor = 0;
  for (let time = Date.parse(`${start}T00:00:00Z`); time <= Date.parse(`${end}T00:00:00Z`); time += DAY_MS) {
    const date = new Date(time).toISOString().slice(0, 10);
    const day = getPublishedUsEquityCalendarDay(BASKET_CALENDAR, date);
    if (day == null) throw new Error("Daily calendar unavailable");
    if (day !== "session") continue;
    while (cursor + 1 < points.length && points[cursor + 1]!.date <= date) cursor += 1;
    const last = points[cursor]!;
    if (last.date > date) continue;
    if (time - Date.parse(`${last.date}T00:00:00Z`) > MAX_LOCAL_CLOSED_DAYS * DAY_MS) throw new Error(LOCAL_GAP);
    const rate = fx.closes.get(date);
    if (rate == null) throw new Error(FX_GAP);
    const close = (last.close * rate) / divisor;
    converted.push({ date: new Date(time), open: close, high: close, low: close, close });
  }
  if (converted.length < 2) throw new Error("Daily history unavailable");
  return converted;
}
