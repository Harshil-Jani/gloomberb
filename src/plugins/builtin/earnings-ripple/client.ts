import type { EarningsCalendarPayload, EarningsCalendarQuery } from "../../../api-client/earnings";
import type { SupplyChainPayload } from "../../../api-client/supply-chain";
import { errorMessage } from "../../../utils/errors";
import { loadEarningsBoard } from "../earnings/client";
import { loadSupplyChain } from "../supply-chain/client";
import { projectRipple, RIPPLE_DAYS, type RippleRow } from "./model";

export interface RippleSources {
  supplyChain(symbol: string): Promise<SupplyChainPayload>;
  calendar(query: EarningsCalendarQuery): Promise<EarningsCalendarPayload>;
}

export interface RippleSnapshot {
  rows: RippleRow[];
  /** Holdings whose disclosures could not be read, with the reason. */
  failures: { symbol: string; error: string }[];
  stale: boolean;
  from: string;
  to: string;
}

/** The same caches SPLC and ERN fill, so opening either pane after this costs nothing. */
export function cachedRippleSources(accessKey: string, force = false): RippleSources & { staleFlags: boolean[] } {
  const staleFlags: boolean[] = [];
  return {
    staleFlags,
    supplyChain: async (symbol) => { const result = await loadSupplyChain(symbol, accessKey, force); staleFlags.push(result.stale); return result.payload; },
    calendar: async (query) => { const result = await loadEarningsBoard(query, force); staleFlags.push(result.stale); return result.payload; },
  };
}

const CONCURRENCY = 6;

export async function loadRipple(holdings: readonly string[], sources: RippleSources & { staleFlags?: boolean[] }, now = new Date()): Promise<RippleSnapshot> {
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + RIPPLE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const chains = new Map<string, SupplyChainPayload>();
  const failures: RippleSnapshot["failures"] = [];
  const queue = [...new Set(holdings.map((symbol) => symbol.toUpperCase()))];
  // Awaited together so a calendar that fails while disclosures load is never an unhandled rejection.
  const [payload] = await Promise.all([
    sources.calendar({ from, to }),
    Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let symbol = queue.shift(); symbol; symbol = queue.shift()) {
        try { chains.set(symbol, await sources.supplyChain(symbol)); }
        catch (error) { failures.push({ symbol, error: errorMessage(error) }); }
      }
    })),
  ]);
  return { rows: projectRipple(chains, payload.reports), failures, stale: !!sources.staleFlags?.some(Boolean), from, to };
}
