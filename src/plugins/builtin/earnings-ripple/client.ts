import type { EarningsCalendarPayload, EarningsCalendarQuery } from "../../../api-client/earnings";
import type { SupplyChainPayload } from "../../../api-client/supply-chain";
import { DEFAULT_GRAPH_OPTIONS, type GraphPayload } from "../../../api-client/supply-chain-graph";
import { errorMessage } from "../../../utils/errors";
import { addDays, newYorkToday } from "../earnings/board-model";
import { loadEarningsBoard } from "../earnings/client";
import { loadSupplyChain } from "../supply-chain/client";
import { loadGraph } from "../supply-chain/graph-client";
import { projectRipple, projectSecondHop, rippleCompanyTickers, RIPPLE_DAYS, secondHopLinks, type RippleRow, type SecondHopRow } from "./model";

export interface RippleSources {
  supplyChain(symbol: string): Promise<SupplyChainPayload>;
  calendar(query: EarningsCalendarQuery): Promise<EarningsCalendarPayload>;
  /** SPLC's graph, which returns both hops around a holding in one call. Absent when the account sees one hop only. */
  graph?(symbol: string): Promise<GraphPayload>;
}

interface Failure { symbol: string; error: string }

export interface RippleSnapshot {
  rows: RippleRow[];
  /** Holdings whose disclosures could not be read, with the reason. */
  failures: Failure[];
  /** Holdings whose disclosures the free preview cut short, so a missing link may only be hidden. */
  truncated: string[];
  /** Companies two hops away, when asked for. `locked`: the account sees one hop only. */
  secondHop: { rows: SecondHopRow[]; failures: Failure[]; locked: boolean } | null;
  stale: boolean;
  from: string;
  to: string;
}

/** The same caches SPLC and ERN fill, so opening either pane after this costs nothing. */
export function cachedRippleSources(accessKey: string, force = false, graph = false): RippleSources & { staleFlags: boolean[] } {
  const staleFlags: boolean[] = [];
  return {
    staleFlags,
    supplyChain: async (symbol) => { const result = await loadSupplyChain(symbol, accessKey, force); staleFlags.push(result.stale); return result.payload; },
    calendar: async (query) => { const result = await loadEarningsBoard(query, force); staleFlags.push(result.stale); return result.payload; },
    // SPLC Graph's default query, so one cache serves this and an SPLC Graph tab on the holding.
    ...(graph ? { graph: async (symbol: string) => {
      const result = await loadGraph(symbol, "", DEFAULT_GRAPH_OPTIONS, accessKey, force); staleFlags.push(result.stale); return result.payload;
    } } : {}),
  };
}

const CONCURRENCY = 6;

async function eachLimited(symbols: readonly string[], load: (symbol: string) => Promise<void>) {
  const queue = [...symbols];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let symbol = queue.shift(); symbol; symbol = queue.shift()) await load(symbol);
  }));
}

/** One graph call per holding. The first answer says whether the account sees two hops; a one-hop preview skips the rest. */
async function loadGraphs(holdings: readonly string[], graph: NonNullable<RippleSources["graph"]>) {
  const graphs = new Map<string, GraphPayload>();
  const failures: Failure[] = [];
  const load = async (symbol: string) => {
    try { graphs.set(symbol, await graph(symbol)); }
    catch (error) { failures.push({ symbol, error: errorMessage(error) }); }
  };
  const [first, ...rest] = holdings;
  if (first) await load(first);
  if (first && graphs.get(first)?.access === "preview") return { graphs: new Map<string, GraphPayload>(), failures, locked: true };
  await eachLimited(rest, load);
  return { graphs, failures, locked: false };
}

export async function loadRipple(holdings: readonly string[], sources: RippleSources & { staleFlags?: boolean[] }, now = new Date(), { secondHop = false } = {}): Promise<RippleSnapshot> {
  const from = newYorkToday(now);
  const to = addDays(from, RIPPLE_DAYS);
  const symbols = [...new Set(holdings.map((symbol) => symbol.toUpperCase()))];
  const chains = new Map<string, SupplyChainPayload>();
  const failures: Failure[] = [];
  await eachLimited(symbols, async (symbol) => {
    try { chains.set(symbol, await sources.supplyChain(symbol)); }
    catch (error) { failures.push({ symbol, error: errorMessage(error) }); }
  });
  const second = !secondHop ? null
    : sources.graph ? await loadGraphs(symbols, sources.graph) : { graphs: new Map<string, GraphPayload>(), failures: [], locked: true };
  const graphs = second?.graphs ?? new Map<string, GraphPayload>();
  const companies = [...rippleCompanyTickers(chains), ...secondHopLinks(chains, graphs).map((link) => link.company.ticker!.toUpperCase())];
  const reports: EarningsCalendarPayload["reports"] = [];
  if (companies.length) {
    const calendarSymbols = [...new Set([...companies, ...symbols])].sort();
    for (let offset = 0; offset < calendarSymbols.length; offset += 200) {
      const payload = await sources.calendar({ from, to, perDay: 0, symbols: calendarSymbols.slice(offset, offset + 200) });
      reports.push(...payload.reports);
    }
  }
  const truncated = [...chains].filter(([, chain]) => chain.truncated).map(([symbol]) => symbol).sort();
  return {
    rows: projectRipple(chains, reports), failures, truncated,
    secondHop: second ? { rows: projectSecondHop(chains, graphs, reports), failures: second.failures, locked: second.locked } : null,
    stale: !!sources.staleFlags?.some(Boolean), from, to,
  };
}
