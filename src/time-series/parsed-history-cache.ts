import type { PricePoint } from "../types/financials";
import type { InstrumentRef } from "../market-data/request-types";
import { instrumentIdentityKey } from "../utils/instrument-identity";
import type { TimeRange } from "./range";
import type { ManualChartResolution } from "./resolution";

const MAX_PARSED_HISTORY = 32;
const parsedHistory = new Map<string, PricePoint[]>();

export function parsedPriceHistoryKey(
  instrument: InstrumentRef,
  range: TimeRange,
  resolution?: ManualChartResolution,
): string {
  // This is an in-memory seed cache. Never reuse earlier symbol-only keys:
  // their observations may have come from a different broker contract.
  return JSON.stringify([
    "parsed-history-v2",
    instrumentIdentityKey({ ...instrument,
      brokerId: instrument.brokerId ?? instrument.instrument?.brokerId,
      brokerInstanceId: instrument.brokerInstanceId ?? instrument.instrument?.brokerInstanceId,
    }),
    range,
    resolution ?? "",
  ]);
}

export function rememberParsedPriceHistory(key: string, points: PricePoint[]): void {
  if (points.length === 0) return;
  if (parsedHistory.has(key)) parsedHistory.delete(key);
  parsedHistory.set(key, points);
  while (parsedHistory.size > MAX_PARSED_HISTORY) {
    const oldest = parsedHistory.keys().next().value;
    if (oldest === undefined) break;
    parsedHistory.delete(oldest);
  }
}

export function readParsedPriceHistory(key: string): PricePoint[] | undefined {
  return parsedHistory.get(key);
}
