/** Narrow accounting-basis ownership, separate from SEC stock-split projection.
 * Keep this dependency-free module identical in the native and cloud clients. */
export const EARNINGS_FIELDS = ["basicEps", "eps"] as const;
export type EarningsField = typeof EARNINGS_FIELDS[number];
const REQUIRED_ANCHORS = ["netIncome", "totalRevenue", "operatingIncome", "basicShares", "dilutedShares"] as const;
type Anchor = typeof REQUIRED_ANCHORS[number] | "grossProfit";
type FactField = EarningsField | Anchor;
const CONCEPTS: Record<FactField, { concept: string; unit: string }> = {
  basicEps: { concept: "EarningsPerShareBasic", unit: "EUR/shares" },
  eps: { concept: "EarningsPerShareDiluted", unit: "EUR/shares" },
  basicShares: { concept: "WeightedAverageNumberOfSharesOutstandingBasic", unit: "shares" },
  dilutedShares: { concept: "WeightedAverageNumberOfDilutedSharesOutstanding", unit: "shares" },
  netIncome: { concept: "NetIncomeLoss", unit: "EUR" },
  totalRevenue: { concept: "RevenueFromContractWithCustomerExcludingAssessedTax", unit: "EUR" },
  operatingIncome: { concept: "OperatingIncomeLoss", unit: "EUR" },
  grossProfit: { concept: "GrossProfit", unit: "EUR" },
};
const CIK = "0000937966";
const PERIOD_ENDS = ["2022-12-31", "2023-12-31"];

export interface ReportedEarningsCohort {
  cik: string;
  basis: "us-gaap";
  shareBasis: "ordinary";
  period: "annual";
  startDate: string;
  endDate: string;
  currency: "EUR";
  accessionNumber: string;
  filed: string;
  form: "20-F" | "20-F/A";
  values: Record<EarningsField, number>;
  anchors: Record<typeof REQUIRED_ANCHORS[number], number> & { grossProfit?: number };
  concepts: Record<EarningsField | typeof REQUIRED_ANCHORS[number], { concept: string; unit: string }>
    & { grossProfit?: { concept: string; unit: string } };
}
export interface EarningsResultProvenance { version: 1; reported: ReportedEarningsCohort }
export interface EarningsStatement {
  date: string;
  currency?: string;
  basicEps?: number;
  eps?: number;
  netIncome?: number;
  totalRevenue?: number;
  grossProfit?: number;
  operatingIncome?: number;
  basicShares?: number;
  dilutedShares?: number;
  fieldAvailability?: Record<string, string>;
  availableAt?: string;
  earningsResult?: EarningsResultProvenance;
  unavailableEarnings?: EarningsField[];
  withdrawnObservations?: string[];
}
interface Identity { symbol?: string; listingExchangeName?: string; exchangeName?: string; currency?: string }
interface EarningsFinancials {
  annualStatements: EarningsStatement[];
  quarterlyStatements: EarningsStatement[];
  financialCurrency?: string;
  quote?: Identity;
  quoteMetadata?: Identity;
}
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const venue = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toUpperCase();
  if (["NASDAQ", "XNAS", "XNGS", "NMS", "NAS", "NASDAQGS", "NASDAQ GLOBAL SELECT"].includes(normalized)) return "NASDAQ";
  if (["AMS", "XAMS", "AMSTERDAM", "EURONEXT AMSTERDAM"].includes(normalized)) return "AMS";
  return normalized;
};
function listing(symbol: unknown): { valid: boolean; exchange: string } {
  if (typeof symbol !== "string") return { valid: false, exchange: "" };
  const normalized = symbol.trim().toUpperCase();
  if (normalized === "ASML.AS") return { valid: true, exchange: "AMS" };
  const parts = normalized.split(":");
  return { valid: parts.length <= 2 && parts[0] === "ASML" && (parts.length === 1 || !!parts[1]), exchange: parts[1] ? venue(parts[1]) : "" };
}
export function isAsmlEarningsTarget(symbol: string, exchange = ""): boolean {
  if (typeof exchange !== "string") return false;
  const target = listing(symbol), declared = venue(exchange);
  const selected = target.exchange || declared;
  return target.valid && ["NASDAQ", "AMS"].includes(selected)
    && (!target.exchange || !declared || target.exchange === declared);
}
export function hasAsmlEarningsIdentity(financials: Pick<EarningsFinancials, "financialCurrency" | "quote" | "quoteMetadata">,
  target: { symbol: string; exchange?: string }): boolean {
  if (!isAsmlEarningsTarget(target.symbol, target.exchange)
    || (financials.financialCurrency !== undefined && financials.financialCurrency !== "" && financials.financialCurrency !== "EUR")) return false;
  const selected = listing(target.symbol).exchange || venue(target.exchange ?? "");
  return [financials.quote, financials.quoteMetadata].every(identity => {
    if (identity === undefined) return true;
    if (!identity || typeof identity !== "object" || Array.isArray(identity)) return false;
    const declared = identity.symbol !== undefined ? listing(identity.symbol) : undefined;
    return (!declared || (declared.valid && (!declared.exchange || declared.exchange === selected)))
      && (identity.currency === undefined || identity.currency === "" || identity.currency === (selected === "AMS" ? "EUR" : "USD"))
      && [identity.listingExchangeName, identity.exchangeName].every(value => value === undefined
        || (typeof value === "string" && (!value || venue(value) === selected)));
  });
}
export function isReportedEarningsCohort(value: unknown): value is ReportedEarningsCohort {
  const group = record(value);
  if (group.cik !== CIK || group.basis !== "us-gaap" || group.shareBasis !== "ordinary" || group.period !== "annual"
    || group.currency !== "EUR" || !PERIOD_ENDS.includes(group.endDate) || group.startDate !== `${group.endDate.slice(0, 4)}-01-01`
    || !date(group.filed) || group.filed < group.endDate || !/^\d{10}-\d{2}-\d{6}$/.test(group.accessionNumber)
    || !["20-F", "20-F/A"].includes(group.form)) return false;
  const fields: FactField[] = [...EARNINGS_FIELDS, ...REQUIRED_ANCHORS];
  if (group.anchors?.grossProfit !== undefined || group.concepts?.grossProfit !== undefined) fields.push("grossProfit");
  return fields.every(field => {
    const observed = EARNINGS_FIELDS.includes(field as EarningsField) ? group.values?.[field] : group.anchors?.[field];
    const definition = group.concepts?.[field];
    return finite(observed) && (!field.endsWith("Shares") || observed > 0)
      && definition?.concept === CONCEPTS[field].concept && definition?.unit === CONCEPTS[field].unit;
  });
}
export function parseReportedEarningsCohorts(payload: unknown, expectedCik: string): ReportedEarningsCohort[] {
  if (expectedCik !== CIK || String(record(payload).cik).padStart(10, "0") !== CIK) return [];
  const facts = record(record(payload).facts)["us-gaap"];
  const groups = new Map<string, { cohort: ReportedEarningsCohort; seen: Map<string, number>; conflict: boolean }>();
  for (const [field, definition] of Object.entries(CONCEPTS) as [FactField, typeof CONCEPTS[FactField]][]) {
    const entries = record(record(record(facts)[definition.concept]).units)[definition.unit];
    if (!Array.isArray(entries)) continue;
    for (const raw of entries) {
      const fact = record(raw);
      if (!finite(fact.val) || !date(fact.start) || !date(fact.end) || !date(fact.filed)
        || typeof fact.accn !== "string" || typeof fact.form !== "string") continue;
      const key = `${fact.start}:${fact.end}:${fact.accn}`;
      const item = groups.get(key) ?? { cohort: {
        cik: CIK, basis: "us-gaap", shareBasis: "ordinary", period: "annual", currency: "EUR",
        startDate: fact.start, endDate: fact.end, accessionNumber: fact.accn, filed: fact.filed, form: fact.form,
        values: {} as ReportedEarningsCohort["values"], anchors: {} as ReportedEarningsCohort["anchors"],
        concepts: {} as ReportedEarningsCohort["concepts"],
      } as ReportedEarningsCohort, seen: new Map<string, number>(), conflict: false };
      if (item.cohort.filed !== fact.filed || item.cohort.form !== fact.form
        || (item.seen.has(field) && item.seen.get(field) !== fact.val)) item.conflict = true;
      item.seen.set(field, fact.val);
      if (EARNINGS_FIELDS.includes(field as EarningsField)) item.cohort.values[field as EarningsField] = fact.val;
      else item.cohort.anchors[field as Anchor] = fact.val;
      item.cohort.concepts[field] = { ...definition };
      groups.set(key, item);
    }
  }
  return [...groups.values()].filter(item => !item.conflict && isReportedEarningsCohort(item.cohort)).map(item => item.cohort);
}
function matchesAnchors(row: EarningsStatement, group: ReportedEarningsCohort): boolean {
  return row.date === group.endDate && row.currency === group.currency
    && Object.entries(group.anchors).every(([field, value]) => row[field as Anchor] === value);
}
/** Missing source fields cannot erase an independently attested filing. An
 * explicit contradiction within that same filing cannot resurrect its cache. */
export function contradictsEarningsCohort(raw: unknown, group: ReportedEarningsCohort): boolean {
  const facts = record(record(record(raw).facts)["us-gaap"]);
  return Object.entries(group.concepts).some(([field, definition]) => {
    const units = record(record(facts[definition.concept]).units);
    return Object.entries(units).some(([unit, entries]) => Array.isArray(entries) && entries.some(entry => {
      const fact = record(entry);
      if (fact.accn !== group.accessionNumber || fact.start !== group.startDate || fact.end !== group.endDate) return false;
      const value = field in group.values ? group.values[field as EarningsField] : group.anchors[field as Anchor];
      return unit !== definition.unit || fact.val !== value || fact.form !== group.form || fact.filed !== group.filed;
    }));
  });
}
export function ownedReportedEarningsCohort(row: EarningsStatement | undefined): ReportedEarningsCohort | undefined {
  const group = row?.earningsResult?.version === 1 ? row.earningsResult.reported : undefined;
  return row && isReportedEarningsCohort(group) && matchesAnchors(row, group)
    && EARNINGS_FIELDS.every(field => row[field] === group.values[field]) ? group : undefined;
}
function completeIndependentEarnings(row: EarningsStatement): boolean {
  return row.earningsResult === undefined && date(row.date) && !!row.currency
    && !(Array.isArray(row.unavailableEarnings) && row.unavailableEarnings.some(field => EARNINGS_FIELDS.includes(field)))
    && [...REQUIRED_ANCHORS, ...EARNINGS_FIELDS].every(field => finite(row[field]));
}
export function hasUnavailableEarnings(row: EarningsStatement, field?: EarningsField): boolean {
  return !ownedReportedEarningsCohort(row)
    && Array.isArray(row.unavailableEarnings)
    && row.unavailableEarnings.some(item => EARNINGS_FIELDS.includes(item) && (!field || item === field));
}
/** Cached/wire source claims are useful only while their entire row is owned. */
export function normalizeReportedEarningsOwnership<T extends EarningsStatement>(row: T, qualified = true): T {
  const invalid = row.earningsResult !== undefined && (!qualified || !ownedReportedEarningsCohort(row));
  const unavailable = invalid ? [...EARNINGS_FIELDS] : EARNINGS_FIELDS.filter(field => hasUnavailableEarnings(row, field));
  if (!invalid && row.unavailableEarnings === undefined) return row;
  if (!invalid && unavailable.length && row.availableAt === undefined && Array.isArray(row.unavailableEarnings)
    && row.unavailableEarnings.length === unavailable.length
    && unavailable.every((field, index) => row.unavailableEarnings![index] === field && row[field] === undefined
      && !(row.fieldAvailability && field in row.fieldAvailability))) return row;
  const result = { ...row };
  if (invalid) delete result.earningsResult;
  if (unavailable.length) { result.unavailableEarnings = unavailable; delete result.availableAt; }
  else delete result.unavailableEarnings;
  for (const field of unavailable) {
    delete result[field];
    if (result.fieldAvailability && field in result.fieldAvailability) {
      result.fieldAvailability = { ...result.fieldAvailability };
      delete result.fieldAvailability[field];
    }
  }
  return result;
}
export function selectReportedEarningsCohort(groups: readonly ReportedEarningsCohort[]): ReportedEarningsCohort | undefined {
  let selected: ReportedEarningsCohort | undefined;
  for (const group of groups.filter(isReportedEarningsCohort).toSorted((a, b) => a.filed.localeCompare(b.filed) || a.accessionNumber.localeCompare(b.accessionNumber))) {
    if (!selected || [...EARNINGS_FIELDS, ...REQUIRED_ANCHORS, "grossProfit"].some(field =>
      (field in group.values ? group.values[field as EarningsField] : group.anchors[field as Anchor])
      !== (field in selected!.values ? selected!.values[field as EarningsField] : selected!.anchors[field as Anchor]))) selected = group;
  }
  return selected;
}

// Rejected source observations, never replacement EPS. The entire monetary/share
// fingerprint distinguishes these mixed rows from valid IFRS statements.
const MIXED = [
  { year: "2022", anchors: { netIncome: 5_624_200_000, totalRevenue: 21_173_400_000, grossProfit: 10_700_100_000,
    operatingIncome: 6_500_700_000, basicShares: 397_700_000, dilutedShares: 398_000_000 }, rejected: { basicEps: 16.08, eps: 16.07 } },
  { year: "2023", anchors: { netIncome: 7_839_000_000, totalRevenue: 27_558_500_000, grossProfit: 14_136_100_000,
    operatingIncome: 9_042_300_000, basicShares: 393_800_000, dilutedShares: 394_100_000 }, rejected: { basicEps: 20.61, eps: 20.59 } },
] as const;
const withdrawalId = (year: string, field: EarningsField) => `asml-${year}-annual-mixed-${field}`;
function mixedRow(row: EarningsStatement) {
  return row.currency === "EUR" ? MIXED.find(item => row.date === `${item.year}-12-31`
    && Object.entries(item.anchors).every(([field, value]) => row[field as Anchor] === value)) : undefined;
}
export function earningsWithdrawalIds(row: EarningsStatement): string[] {
  const mixed = mixedRow(row);
  if (!mixed || ownedReportedEarningsCohort(row) || !Array.isArray(row.withdrawnObservations)) return [];
  return EARNINGS_FIELDS.filter(field => row.withdrawnObservations!.includes(withdrawalId(mixed.year, field))
    && (row[field] === undefined || row[field] === mixed.rejected[field])).map(field => withdrawalId(mixed.year, field));
}
export function hasEarningsWithdrawal(row: EarningsStatement, field?: EarningsField): boolean {
  return earningsWithdrawalIds(row).some(id => !field || id.endsWith(`-${field}`));
}
export function isWithdrawnEarningsValue(row: EarningsStatement, field: string, value: number): boolean {
  const mixed = mixedRow(row);
  return EARNINGS_FIELDS.includes(field as EarningsField) && !!mixed && hasEarningsWithdrawal(row, field as EarningsField)
    && mixed.rejected[field as EarningsField] === value;
}
export function isEarningsWithdrawalId(id: string): boolean {
  return MIXED.some(item => EARNINGS_FIELDS.some(field => id === withdrawalId(item.year, field)));
}
export function redactWithdrawnEarnings<T extends EarningsStatement>(row: T): T {
  if (!Array.isArray(row.withdrawnObservations)) return row;
  const active = earningsWithdrawalIds(row);
  const markers = row.withdrawnObservations.filter(id => !isEarningsWithdrawalId(id) || active.includes(id));
  const result = { ...row };
  let changed = markers.length !== row.withdrawnObservations.length;
  for (const field of EARNINGS_FIELDS) {
    if (!active.some(id => id.endsWith(`-${field}`))) continue;
    if (result[field] !== undefined) { delete result[field]; changed = true; }
    if (result.fieldAvailability?.[field]) {
      result.fieldAvailability = { ...result.fieldAvailability }; delete result.fieldAvailability[field]; changed = true;
    }
  }
  if (active.length && result.availableAt !== undefined) changed = true;
  if (!changed) return row;
  if (markers.length) result.withdrawnObservations = markers;
  else delete result.withdrawnObservations;
  // A row-wide date cannot survive an explicitly unavailable field.
  if (active.length) delete result.availableAt;
  return result;
}
export function withdrawKnownProviderEarnings<T extends EarningsFinancials>(financials: T,
  target: { symbol: string; exchange?: string }, sourceKey: string): T {
  if (!["provider:gloomberb-cloud", "provider:yahoo", "provider:twelvedata"].includes(sourceKey)
    || !hasAsmlEarningsIdentity(financials, target)) return financials;
  let changed = false;
  const annualStatements = financials.annualStatements.map(row => {
    const mixed = mixedRow(row);
    if (!mixed || ownedReportedEarningsCohort(row)) return row;
    const ids = EARNINGS_FIELDS.filter(field => row[field] === mixed.rejected[field]).map(field => withdrawalId(mixed.year, field));
    if (!ids.length && !row.withdrawnObservations) return row;
    const markers = [...new Set([...(Array.isArray(row.withdrawnObservations) ? row.withdrawnObservations : []), ...ids])];
    const candidate = markers.length === row.withdrawnObservations?.length ? row : { ...row, withdrawnObservations: markers };
    const result = redactWithdrawnEarnings(candidate);
    changed ||= result !== row;
    return result;
  });
  return changed ? { ...financials, annualStatements } : financials;
}
function applyReported<T extends EarningsStatement>(row: T, group: ReportedEarningsCohort): T {
  const result = { ...row, ...group.values, earningsResult: { version: 1 as const, reported: group },
    fieldAvailability: { ...row.fieldAvailability, basicEps: group.filed, eps: group.filed } };
  // Other provider fields still have their original/unknown availability.
  if (row.availableAt) result.availableAt = [row.availableAt, group.filed].sort().at(-1);
  delete result.unavailableEarnings;
  return redactWithdrawnEarnings(result);
}
export function promoteReportedEarningsResults<T extends EarningsStatement>(rows: T[], cohorts: readonly ReportedEarningsCohort[], period: string): T[] {
  if (period !== "annual") return rows;
  return rows.map(row => {
    const cohort = selectReportedEarningsCohort(cohorts.filter(group => isReportedEarningsCohort(group) && matchesAnchors(row, group)));
    return cohort ? applyReported(row, cohort) : row;
  });
}
/** Called after a compatible row merge: source EPS and its anchors stay owned. */
export function mergeReportedEarningsResult(target: EarningsStatement, rows: readonly EarningsStatement[]): void {
  const cohorts = rows.map(ownedReportedEarningsCohort).filter((group): group is ReportedEarningsCohort => !!group && matchesAnchors(target, group));
  const cohort = selectReportedEarningsCohort(cohorts);
  const markers = [...new Set([...(Array.isArray(target.withdrawnObservations) ? target.withdrawnObservations : []),
    ...rows.filter(row => row.date === target.date && row.currency === target.currency).flatMap(earningsWithdrawalIds)])];
  if (markers.length) target.withdrawnObservations = markers;
  else delete target.withdrawnObservations;
  const unavailable = EARNINGS_FIELDS.filter(field => hasUnavailableEarnings(target, field) || rows.some(row =>
    row.date === target.date && row.currency === target.currency && hasUnavailableEarnings(row, field)));
  if (unavailable.length) target.unavailableEarnings = unavailable;
  if (cohort) Object.assign(target, applyReported(target, cohort));
  else if (target.earningsResult !== undefined || unavailable.length) {
    // A complete independent provider row can replace the accounting basis.
    // A sparse override cannot detach source EPS and keep it as a bare number.
    const independent = rows.find(row => completeIndependentEarnings(row)
      && row.date === target.date && row.currency === target.currency
      && REQUIRED_ANCHORS.every(field => finite(row[field]) && row[field] === target[field])
      && row.grossProfit === target.grossProfit);
    if (independent) {
      delete target.earningsResult;
      delete target.unavailableEarnings;
      for (const field of EARNINGS_FIELDS) {
        target[field] = independent[field];
        target.fieldAvailability = { ...target.fieldAvailability };
        const available = independent.fieldAvailability ? independent.fieldAvailability[field] : independent.availableAt;
        if (available) target.fieldAvailability[field] = available;
        else delete target.fieldAvailability[field];
      }
      delete target.availableAt;
    } else if (unavailable.length) {
      for (const field of unavailable) delete target[field];
    }
  }
  const normalized = redactWithdrawnEarnings(normalizeReportedEarningsOwnership(target));
  // Object.assign alone cannot propagate deletions from a normalized copy.
  for (const field of [...EARNINGS_FIELDS, "earningsResult", "unavailableEarnings", "withdrawnObservations", "availableAt"] as const) {
    if (!(field in normalized)) delete target[field];
  }
  Object.assign(target, normalized);
}
