import type { FinancialStatement, ProviderOperatingField } from "../types/financials";
import {
  derivedOperatingObservation,
  providerOperatingObservation,
  reportedOperatingCohort,
} from "./operating-result";

const FIELDS: readonly ProviderOperatingField[] = [
  "grossProfit", "operatingExpense", "operatingIncome", "totalExpenses", "ebitda",
];

type OperatingPeriod = Pick<FinancialStatement, "date" | "currency" | "operatingResult" | "depreciationAndAmortization" | ProviderOperatingField>;

/** A sum keeps all its inputs; it is never represented as one filed fact. */
export interface OperatingResultAggregation {
  kind: "trailing-four-quarters";
  sourcePeriods: OperatingPeriod[];
  unavailableFields: ProviderOperatingField[];
}

export function isOperatingField(field: string): field is ProviderOperatingField {
  return FIELDS.includes(field as ProviderOperatingField);
}

function isTracked(statement: FinancialStatement): boolean {
  return statement.operatingResult !== undefined || statement.operatingResultAggregation !== undefined;
}

function directBasis(statement: FinancialStatement, field: ProviderOperatingField, period?: "annual" | "quarterly"): string | undefined {
  if (!Number.isFinite(statement[field])) return undefined;
  if (field === "grossProfit" || field === "operatingExpense" || field === "operatingIncome") {
    const reported = reportedOperatingCohort(statement, period);
    if (reported) return `sec:${reported.cik}:${reported.currency}:${field}`;
  }
  if (field === "ebitda") {
    const derived = derivedOperatingObservation(statement, field, period);
    if (derived) return `derived:${derived.definition}:${derived.currency}:${field}`;
  }
  const provider = providerOperatingObservation(statement, field, period);
  // A retained vendor operating observation can explain a disagreement, but
  // cannot own a different value selected from a reported cohort.
  if (provider && Object.is(provider.value, statement[field])) {
    return `provider:${provider.provider}:${provider.sourceField}:${provider.currency}`;
  }
  return undefined;
}

function aggregateBasis(statement: FinancialStatement, field: ProviderOperatingField): string | undefined {
  const aggregation = statement.operatingResultAggregation;
  if (!aggregation) return directBasis(statement, field);
  if (aggregation.kind !== "trailing-four-quarters" || !Array.isArray(aggregation.sourcePeriods) || aggregation.sourcePeriods.length !== 4
    || !Array.isArray(aggregation.unavailableFields) || aggregation.unavailableFields.includes(field)) return undefined;
  const inputs = aggregation.sourcePeriods;
  if (inputs.some(input => !input || typeof input !== "object") || !canAggregateOperatingField(inputs, field)) return undefined;
  const bases = inputs.map(input => directBasis(input, field, "quarterly"));
  if (!bases[0] || bases.some(basis => basis !== bases[0])) return undefined;
  const total = inputs.reduce((sum, input) => sum + (input[field] ?? NaN), 0);
  return Number.isFinite(total) && Object.is(total, statement[field]) ? bases[0] : undefined;
}

/** Existing unqualified issuers retain their behavior. Once ownership is
 * present, every contributing quarter must establish a compatible measure. */
export function canAggregateOperatingField(statements: readonly FinancialStatement[], field: string): boolean {
  if (!isOperatingField(field) || !statements.some(isTracked)) return true;
  if (statements.length !== 4) return false;
  const dates = statements.map(statement => Date.parse(statement.date)).sort((a, b) => a - b);
  if (dates.some((date, index) => !Number.isFinite(date) || (index > 0
    && (date - dates[index - 1]! < 60 * 86_400_000 || date - dates[index - 1]! > 120 * 86_400_000)))) return false;
  const bases = statements.map(statement => directBasis(statement, field, "quarterly"));
  if (!bases[0] || bases.some(basis => basis !== bases[0])) return false;
  const reported = statements.map(statement => reportedOperatingCohort(statement, "quarterly"));
  if ((field === "grossProfit" || field === "operatingExpense" || field === "operatingIncome")
    && reported.every(cohort => cohort !== undefined)) {
    const sorted = reported.toSorted((a, b) => a!.endDate.localeCompare(b!.endDate));
    if (sorted.some((cohort, index) => index > 0
      && Date.parse(cohort!.startDate) - Date.parse(sorted[index - 1]!.endDate) !== 86_400_000)) return false;
  }
  return true;
}

export function canCompareOperatingField(current: FinancialStatement, previous: FinancialStatement, field: string): boolean {
  if (!isOperatingField(field) || (!isTracked(current) && !isTracked(previous))) return true;
  const currentBasis = aggregateBasis(current, field);
  return !!currentBasis && currentBasis === aggregateBasis(previous, field);
}

export function operatingResultAggregation(statements: readonly FinancialStatement[]): OperatingResultAggregation | undefined {
  if (!statements.some(isTracked)) return undefined;
  return {
    kind: "trailing-four-quarters",
    sourcePeriods: statements.map(statement => ({
      date: statement.date,
      currency: statement.currency,
      ...(Number.isFinite(statement.depreciationAndAmortization) ? { depreciationAndAmortization: statement.depreciationAndAmortization } : {}),
      ...(statement.operatingResult ? { operatingResult: structuredClone(statement.operatingResult) } : {}),
      ...Object.fromEntries(FIELDS.flatMap(field => Number.isFinite(statement[field]) ? [[field, statement[field]]] : [])),
    })),
    unavailableFields: FIELDS.filter(field => !canAggregateOperatingField(statements, field)),
  };
}

/** Direct filing-table quarters own their period. Do not synthesize a missing
 * scoped quarter by combining annual and quarterly observations of other vintages. */
export function canDeriveOperatingQuarter(annual: FinancialStatement, quarters: readonly FinancialStatement[], field: string): boolean {
  return !isOperatingField(field) || ![annual, ...quarters].some(isTracked);
}
