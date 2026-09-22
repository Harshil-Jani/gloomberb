import type { FinancialStatement, TickerFinancials } from "../types/financials";
import { canonicalExchange, parsePublicTickerKey } from "./exchanges";
import { isIncomeStatementField } from "./income-statement";

type ObservationField = "totalRevenue" | "operatingRevenue" | "netIncome" | "netIncomeCommonStockholders" | "pretaxIncome" | "taxProvision";
type Withdrawal = { id: string; symbol: string; field: ObservationField; rejected: readonly number[] };

/** Exact September 2026 observations contradicted by the issuer's Q4 release.
 * These are withdrawals, never replacement values. Source packets and report
 * definitions: docs/data-quality/quarterly-statement-revisions.md. */
const WITHDRAWALS: readonly Withdrawal[] = [
  { id: "bac-2025q4-revenue", symbol: "BAC", field: "totalRevenue", rejected: [31_180_000_000, 29_319_000_000] },
  { id: "bac-2025q4-operating-revenue", symbol: "BAC", field: "operatingRevenue", rejected: [31_180_000_000] },
  { id: "bac-2025q4-parent-income", symbol: "BAC", field: "netIncome", rejected: [7_528_000_000, 7_510_000_000] },
  { id: "bac-2025q4-common-income", symbol: "BAC", field: "netIncomeCommonStockholders", rejected: [7_200_000_000, 7_182_000_000] },
  { id: "bac-2025q4-pretax", symbol: "BAC", field: "pretaxIncome", rejected: [12_435_000_000] },
  { id: "bac-2025q4-tax", symbol: "BAC", field: "taxProvision", rejected: [4_907_000_000] },
  { id: "o-2025q4-revenue", symbol: "O", field: "totalRevenue", rejected: [1_708_836_000] },
  { id: "o-2025q4-parent-income", symbol: "O", field: "netIncome", rejected: [301_636_000] },
];

function withdrawals(row: FinancialStatement): Withdrawal[] {
  if (row.date !== "2025-12-31" || row.currency !== "USD" || !Array.isArray(row.withdrawnObservations)) return [];
  return WITHDRAWALS.filter(item => row.withdrawnObservations!.includes(item.id));
}

export function hasStatementWithdrawals(row: FinancialStatement): boolean {
  return withdrawals(row).length > 0;
}

function hasDirectSecIncome(row: FinancialStatement, field: string): boolean {
  // A directly reported SEC fact has its own filing evidence. This registry
  // does not invalidate a later source correction or infer its accounting basis.
  return isIncomeStatementField(field) && row.fieldSources?.[field]?.source === "sec"
    && row.fieldSources[field]?.endDate === row.date && row.fieldSources[field]?.unit === row.currency;
}

export function isWithdrawnStatementValue(row: FinancialStatement, field: string, value: number): boolean {
  if (hasDirectSecIncome(row, field)) return false;
  return withdrawals(row).some(item => item.field === field && item.rejected.includes(value));
}

/** Normalize optional wire metadata and keep only unresolved withdrawals. */
export function redactWithdrawnStatement(row: FinancialStatement): FinancialStatement {
  if (!row.withdrawnObservations) return row;
  const result = { ...row };
  const active: string[] = [];
  let changed = false;
  for (const item of withdrawals(row)) {
    const value = row[item.field];
    if (typeof value === "number" && Number.isFinite(value)) {
      if (!isWithdrawnStatementValue(row, item.field, value)) continue;
      delete result[item.field];
      changed = true;
      if (result.fieldAvailability) {
        result.fieldAvailability = { ...result.fieldAvailability };
        delete result.fieldAvailability[item.field];
      }
    }
    active.push(item.id);
  }
  if (!changed && Array.isArray(row.withdrawnObservations) && active.length === row.withdrawnObservations.length
    && active.every((id, index) => id === row.withdrawnObservations![index])) return row;
  if (active.length) result.withdrawnObservations = active;
  else delete result.withdrawnObservations;
  return result;
}

/** Preserve unresolved source conflicts across sparse and cached row merges. */
export function mergeStatementWithdrawals(target: FinancialStatement, rows: readonly FinancialStatement[]): void {
  const ids = [...new Set(rows.filter(row => row.date === target.date && row.currency === target.currency)
    .flatMap(row => withdrawals(row).map(item => item.id)))];
  if (ids.length) target.withdrawnObservations = ids;
  else delete target.withdrawnObservations;
}

function withdrawQuarter<T extends Pick<TickerFinancials, "annualStatements" | "quarterlyStatements">>(financials: T, symbol: string): T {
  const rules = WITHDRAWALS.filter(item => item.symbol === symbol);
  if (!rules.length) return financials;
  const conflictingBacAnnual = symbol === "BAC" && financials.annualStatements.some(row => row.date === "2025-12-31" && row.currency === "USD"
    && row.totalRevenue === 113_097_000_000 && row.netIncome === 30_509_000_000);
  let quarters = financials.quarterlyStatements;
  // BAC has only balance facts for Q4 in companyfacts. Retain a dated gap so
  // chart completion can reject the attested mixed-revision subtraction too.
  if (conflictingBacAnnual && !quarters.some(row => row.date === "2025-12-31")) {
    quarters = [...quarters, { date: "2025-12-31", currency: "USD" }].sort((a, b) => a.date.localeCompare(b.date));
  }
  let changed = quarters !== financials.quarterlyStatements;
  quarters = quarters.map(row => {
    if (row.date !== "2025-12-31" || row.currency !== "USD") return row;
    const ids = rules.filter(item => (item.rejected.includes(row[item.field]!) && !hasDirectSecIncome(row, item.field)) || (row[item.field] === undefined
      && conflictingBacAnnual && ["totalRevenue", "netIncome", "netIncomeCommonStockholders"].includes(item.field))).map(item => item.id);
    if (!ids.length && !row.withdrawnObservations) return row;
    const combined = [...new Set([...(Array.isArray(row.withdrawnObservations) ? row.withdrawnObservations : []), ...ids])];
    const existing = Array.isArray(row.withdrawnObservations) ? row.withdrawnObservations : [];
    const same = combined.length === existing.length && combined.every((id, index) => id === existing[index]);
    const next = redactWithdrawnStatement(same ? row : { ...row, withdrawnObservations: combined });
    changed ||= next !== row;
    return next;
  });
  return changed ? { ...financials, quarterlyStatements: quarters } : financials;
}

export function withdrawKnownProviderStatements(
  financials: TickerFinancials,
  target: { symbol: string; exchange?: string },
  sourceKey: string,
): TickerFinancials {
  if (!["provider:gloomberb-cloud", "provider:yahoo", "provider:twelvedata"].includes(sourceKey)) return financials;
  const requested = parsePublicTickerKey(target.symbol);
  const identities = [financials.quote, financials.quoteMetadata].filter(Boolean);
  const declared = identities.flatMap(quote => quote?.symbol ? [parsePublicTickerKey(quote.symbol)] : []);
  if (declared.some(identity => identity.symbol !== requested.symbol)) return financials;
  const venues = [requested.exchange, target.exchange, ...declared.map(identity => identity.exchange),
    ...identities.map(quote => quote?.listingExchangeName), financials.quote?.exchangeName].filter(Boolean).map(venue => canonicalExchange(venue));
  if (!venues.includes("NYSE") || venues.some(venue => venue && venue !== "NYSE")) return financials;
  return withdrawQuarter(financials, requested.symbol);
}

export function withdrawKnownSecQuarter<T extends Pick<TickerFinancials, "annualStatements" | "quarterlyStatements">>(financials: T, cik: unknown): T {
  return String(cik).replace(/^0+/, "") === "70858" ? withdrawQuarter(financials, "BAC") : financials;
}
