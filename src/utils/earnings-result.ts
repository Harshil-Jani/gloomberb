import type { FinancialStatement, TickerFinancials } from "../types/financials";
import { hasAsmlEarningsIdentity, isEarningsWithdrawalId, normalizeReportedEarningsOwnership } from "./reported-earnings-result";

/** Application boundary for the pure earnings cohort shared with Cloud. */
export function normalizeStatementEarningsResult(row: FinancialStatement, period = "annual"): FinancialStatement {
  return normalizeReportedEarningsOwnership(row, period === "annual");
}

export function normalizeFinancialEarningsResults<T extends TickerFinancials>(financials: T,
  target?: { symbol: string; exchange?: string }, sourceKey = "provider:gloomberb-cloud"): T {
  const identity = target ?? { symbol: financials.quote?.symbol ?? financials.quoteMetadata?.symbol ?? "",
    exchange: financials.quote?.listingExchangeName ?? financials.quoteMetadata?.listingExchangeName ?? financials.quote?.exchangeName };
  const qualified = ["provider:gloomberb-cloud", "provider:yahoo", "provider:twelvedata"].includes(sourceKey)
    && hasAsmlEarningsIdentity(financials, identity);
  let changed = false;
  const normalize = (row: FinancialStatement, period: string) => {
    let next = normalizeStatementEarningsResult(row, qualified ? period : "unsupported");
    if ((!qualified || period !== "annual") && Array.isArray(next.withdrawnObservations)
      && next.withdrawnObservations.some(isEarningsWithdrawalId)) {
      next = { ...next, withdrawnObservations: next.withdrawnObservations.filter(id => !isEarningsWithdrawalId(id)) };
      if (!next.withdrawnObservations!.length) delete next.withdrawnObservations;
    }
    changed ||= row !== next;
    return next;
  };
  const annualStatements = financials.annualStatements.map(row => normalize(row, "annual"));
  const quarterlyStatements = financials.quarterlyStatements.map(row => normalize(row, "quarterly"));
  const validRetry = qualified && typeof financials.earningsHistoryRetryAt === "number"
    && Number.isFinite(financials.earningsHistoryRetryAt) && financials.earningsHistoryRetryAt > 0;
  if (!validRetry && financials.earningsHistoryRetryAt !== undefined) changed = true;
  if (!changed) return financials;
  const next = { ...financials, annualStatements, quarterlyStatements };
  if (!validRetry) delete next.earningsHistoryRetryAt;
  return next;
}
