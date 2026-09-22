/** Narrow operating-result ownership. Net-income attribution remains separate. */
export const OPERATING_FIELDS = ["grossProfit", "operatingExpense", "operatingIncome"] as const
export const OPERATING_PROVIDER_FIELDS = [...OPERATING_FIELDS, "totalExpenses", "ebitda"] as const
export type OperatingField = typeof OPERATING_FIELDS[number]
export type OperatingProviderField = typeof OPERATING_PROVIDER_FIELDS[number]
export type StatementPeriod = "annual" | "quarterly"

export interface ProviderOperatingObservation {
  provider: "yahoo" | "twelvedata"
  sourceField: string
  period: StatementPeriod
  endDate: string
  currency: string
  value: number
}

export interface ReportedOperatingCohort {
  cik: string
  period: StatementPeriod
  startDate: string
  endDate: string
  currency: "USD"
  accessionNumber: string
  filed: string
  form: string
  values: Record<OperatingField, number>
  anchors?: { totalRevenue?: number; costOfRevenue?: number }
  origin: { kind: "companyfacts" } | {
    kind: "filing-table"
    documentUrl: string
    documentSha256: string
    table: "summary-quarterly-results"
    unitScale: 1000000
  }
}

export interface OperatingResultProvenance {
  version: 1
  reported?: ReportedOperatingCohort
  provider?: Partial<Record<OperatingProviderField, ProviderOperatingObservation>>
  derived?: { ebitda?: DerivedOperatingObservation }
}

export interface DerivedOperatingObservation {
  definition: "operating-income-plus-depreciation-amortization"
  period: StatementPeriod
  endDate: string
  currency: string
  value: number
  inputs: { operatingIncome: number; depreciationAndAmortization: number }
}

export interface OperatingStatement {
  date: string
  currency?: string
  grossProfit?: number
  operatingExpense?: number
  operatingIncome?: number
  totalRevenue?: number
  costOfRevenue?: number
  totalExpenses?: number
  ebitda?: number
  depreciationAndAmortization?: number
  operatingResult?: OperatingResultProvenance
  fieldAvailability?: Record<string, string>
  availableAt?: string
  dateSource?: "sec" | "provider"
  dateEvidence?: { accessionNumber: string; filed: string; startDate: string }
}

const SHOP_CIK = "0001594805"
const CONCEPTS = {
  grossProfit: "GrossProfit",
  operatingExpense: "OperatingExpenses",
  operatingIncome: "OperatingIncomeLoss",
  totalRevenue: "Revenues",
  costOfRevenue: "CostOfGoodsAndServicesSold",
} as const
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const validDate = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value

/** This policy is deliberately issuer-specific; it does not authorize other US issuers. */
export function isShopOperatingTarget(symbol: string, exchange: string): boolean {
  return symbol.trim().toUpperCase() === "SHOP" && ["NASDAQ", "XNAS", "NMS", "NAS", "NASDAQGS"].includes(exchange.trim().toUpperCase())
}

export function isReportedOperatingCohort(value: unknown): value is ReportedOperatingCohort {
  if (!value || typeof value !== "object") return false
  const group = value as ReportedOperatingCohort
  if (group.cik !== SHOP_CIK || group.currency !== "USD"
    || !validDate(group.startDate) || !validDate(group.endDate) || !validDate(group.filed)
    || group.filed < group.endDate || !/^0001594805-\d{2}-\d{6}$/.test(group.accessionNumber)
    || !/^(10-K|10-Q)(\/A)?$/.test(group.form)
    || !group.values || !OPERATING_FIELDS.every(field => finite(group.values[field]))) return false
  const startMonth = Number(group.startDate.slice(5, 7))
  const endMonth = Number(group.endDate.slice(5, 7))
  if (group.startDate.slice(0, 4) !== group.endDate.slice(0, 4)) return false
  if (group.period === "annual") {
    if (!/^10-K(?:\/A)?$/.test(group.form) || !group.startDate.endsWith("-01-01") || !group.endDate.endsWith("-12-31")) return false
  } else if (group.period === "quarterly") {
    if (![1, 4, 7, 10].includes(startMonth) || endMonth !== startMonth + 2 || !group.startDate.endsWith("-01")
      || !["03-31", "06-30", "09-30", "12-31"].includes(group.endDate.slice(5))) return false
  } else return false
  if (!group.origin || !["companyfacts", "filing-table"].includes(group.origin.kind)) return false
  if (group.origin.kind === "filing-table") {
    if (group.period !== "quarterly" || group.origin.table !== "summary-quarterly-results" || group.origin.unitScale !== 1000000
      || !/^[a-f0-9]{64}$/.test(group.origin.documentSha256)) return false
    try {
      const url = new URL(group.origin.documentUrl)
      if (url.origin !== "https://www.sec.gov" || url.search || url.hash
        || !url.pathname.startsWith(`/Archives/edgar/data/1594805/${group.accessionNumber.replace(/-/g, "")}/`)
        || !/\/[^/]+\.html?$/.test(url.pathname)) return false
    } catch { return false }
  }
  return !group.anchors || Object.values(group.anchors).every(finite)
}

function sameValues(left: ReportedOperatingCohort, right: ReportedOperatingCohort): boolean {
  return OPERATING_FIELDS.every(field => Object.is(left.values[field], right.values[field]))
}

/** Unchanged comparative repeats retain their original complete cohort/date. */
export function selectReportedOperatingCohort(groups: readonly ReportedOperatingCohort[]): ReportedOperatingCohort | undefined {
  const sorted = groups.filter(isReportedOperatingCohort).sort((a, b) => a.filed.localeCompare(b.filed) || a.accessionNumber.localeCompare(b.accessionNumber))
  let selected: ReportedOperatingCohort | undefined
  for (const group of sorted) {
    if (!selected || !sameValues(selected, group)) selected = group
  }
  return selected
}

/** Build complete groups before selecting any field: no independent-field revision mixing. */
export function parseReportedOperatingCohorts(payload: unknown, expectedCik: string): ReportedOperatingCohort[] {
  if (expectedCik !== SHOP_CIK || !payload || typeof payload !== "object") return []
  const root = payload as { cik?: unknown; facts?: { "us-gaap"?: Record<string, { units?: { USD?: unknown[] } }> } }
  if (String(root.cik).padStart(10, "0") !== expectedCik) return []
  const groups = new Map<string, { cohort: ReportedOperatingCohort; observations: Map<string, Set<number>>; conflict: boolean }>()
  for (const [field, concept] of Object.entries(CONCEPTS)) {
    for (const raw of root.facts?.["us-gaap"]?.[concept]?.units?.USD ?? []) {
      if (!raw || typeof raw !== "object") continue
      const fact = raw as Record<string, unknown>
      if (!finite(fact.val) || !validDate(fact.start) || !validDate(fact.end) || !validDate(fact.filed)
        || typeof fact.accn !== "string" || typeof fact.form !== "string") continue
      const period: StatementPeriod = fact.start.endsWith("-01-01") && fact.end.endsWith("-12-31") ? "annual" : "quarterly"
      const key = `${fact.start}:${fact.end}:${fact.accn}`
      const item = groups.get(key) ?? { cohort: {
        cik: SHOP_CIK, period, startDate: fact.start, endDate: fact.end, currency: "USD",
        accessionNumber: fact.accn, filed: fact.filed, form: fact.form,
        values: {} as Record<OperatingField, number>, anchors: {}, origin: { kind: "companyfacts" as const },
      }, observations: new Map<string, Set<number>>(), conflict: false }
      if (item.cohort.filed !== fact.filed || item.cohort.form !== fact.form) item.conflict = true
      const values = item.observations.get(field) ?? new Set<number>()
      values.add(fact.val); item.observations.set(field, values)
      if (values.size > 1) item.conflict = true
      if (OPERATING_FIELDS.includes(field as OperatingField)) item.cohort.values[field as OperatingField] = fact.val
      else item.cohort.anchors![field as "totalRevenue" | "costOfRevenue"] = fact.val
      groups.set(key, item)
    }
  }
  return [...groups.values()].filter(item => !item.conflict && isReportedOperatingCohort(item.cohort)).map(item => item.cohort)
}

export function addProviderOperatingObservation<T extends OperatingStatement>(row: T, field: OperatingProviderField,
  provider: ProviderOperatingObservation["provider"], sourceField: string, period: StatementPeriod): void {
  if (!finite(row[field]) || !row.currency) return
  row.operatingResult = { ...(row.operatingResult?.version === 1 ? row.operatingResult : {}), version: 1, provider: { ...row.operatingResult?.provider,
    [field]: { provider, sourceField, period, endDate: row.date, currency: row.currency, value: row[field] },
  } }
}

export function providerOperatingObservation(row: OperatingStatement | undefined, field: OperatingProviderField): ProviderOperatingObservation | undefined {
  const observation = row?.operatingResult?.version === 1 ? row.operatingResult.provider?.[field] : undefined
  if (!row || !observation || !["yahoo", "twelvedata"].includes(observation.provider)
    || typeof observation.sourceField !== "string" || !observation.sourceField.trim() || !["annual", "quarterly"].includes(observation.period)
    || observation.endDate !== row.date || observation.currency !== row.currency || !finite(observation.value)) return undefined
  const native = observation.sourceField.replace(/[^a-z]/gi, "").toLowerCase()
  if (native !== field.toLowerCase() && !(field === "operatingExpense" && native === "operatingexpenses")) return undefined
  // The original provider operating observation is retained as discrepancy evidence.
  const direct = row.operatingResult?.reported
  const replaced = OPERATING_FIELDS.includes(field as OperatingField) && isReportedOperatingCohort(direct)
    && direct.endDate === row.date && direct.currency === row.currency
    && OPERATING_FIELDS.every(key => row[key] === direct.values[key])
  return row[field] === observation.value || replaced ? observation : undefined
}

export function ownedReportedOperatingCohort(row: OperatingStatement | undefined): ReportedOperatingCohort | undefined {
  const group = row?.operatingResult?.version === 1 ? row.operatingResult.reported : undefined
  return row && isReportedOperatingCohort(group) && group.endDate === row.date && group.currency === row.currency
    && OPERATING_FIELDS.every(field => row[field] === group.values[field]) ? group : undefined
}

export function addDerivedOperatingObservation(row: OperatingStatement, period: StatementPeriod): void {
  if (!row.currency || !finite(row.ebitda) || !finite(row.operatingIncome) || !finite(row.depreciationAndAmortization)) return
  row.operatingResult = { ...(row.operatingResult?.version === 1 ? row.operatingResult : {}), version: 1, derived: { ebitda: {
    definition: "operating-income-plus-depreciation-amortization", period, endDate: row.date,
    currency: row.currency, value: row.ebitda,
    inputs: { operatingIncome: row.operatingIncome, depreciationAndAmortization: row.depreciationAndAmortization },
  } } }
}

export function derivedOperatingObservation(row: OperatingStatement | undefined): DerivedOperatingObservation | undefined {
  const observation = row?.operatingResult?.version === 1 ? row.operatingResult.derived?.ebitda : undefined
  return observation && row && observation.definition === "operating-income-plus-depreciation-amortization"
    && ["annual", "quarterly"].includes(observation.period) && observation.endDate === row.date
    && observation.currency === row.currency && finite(observation.value) && row.ebitda === observation.value
    && finite(observation.inputs?.operatingIncome) && finite(observation.inputs?.depreciationAndAmortization)
    && row.operatingIncome === observation.inputs.operatingIncome && row.depreciationAndAmortization === observation.inputs.depreciationAndAmortization
    && observation.value === observation.inputs.operatingIncome + observation.inputs.depreciationAndAmortization
    ? observation : undefined
}

function compatibleOperatingAnchors(row: OperatingStatement, group: ReportedOperatingCohort): boolean {
  return !Object.entries(group.anchors ?? {}).some(([field, value]) => {
    const actual = row[field as "totalRevenue" | "costOfRevenue"]
    return finite(actual) && actual !== value
  })
}

/** Run after the ordinary sparse merge. Values and their source always move together. */
export function mergeOperatingResults<T extends OperatingStatement>(merged: T, primary?: T, fallback?: T): void {
  const compatible = [primary, fallback].filter((row): row is T => !!row && row.date === merged.date && row.currency === merged.currency)
  const groups = compatible.flatMap(row => { const group = ownedReportedOperatingCohort(row); return group && compatibleOperatingAnchors(merged, group) ? [group] : [] })
  const reported = selectReportedOperatingCohort(groups)
  const provider: NonNullable<OperatingResultProvenance["provider"]> = {}
  for (const field of OPERATING_PROVIDER_FIELDS) {
    const owner = OPERATING_FIELDS.includes(field as OperatingField)
      ? compatible.find(row => providerOperatingObservation(row, field))
      : compatible.find(row => finite(row[field]))
    const observation = providerOperatingObservation(owner, field)
    if (observation && (OPERATING_FIELDS.includes(field as OperatingField) || merged[field] === observation.value)) provider[field] = observation
  }
  const ebitdaOwner = compatible.find(row => finite(row.ebitda))
  const derivedEbitda = derivedOperatingObservation(ebitdaOwner)
  if (reported) {
    for (const field of OPERATING_FIELDS) merged[field] = reported.values[field]
    merged.fieldAvailability = { ...merged.fieldAvailability, ...Object.fromEntries(OPERATING_FIELDS.map(field => [field, reported.filed])) }
    delete merged.availableAt
  }
  if (reported || Object.keys(provider).length || derivedEbitda) merged.operatingResult = { version: 1,
    ...(reported ? { reported } : {}), ...(Object.keys(provider).length ? { provider } : {}),
    ...(derivedEbitda && merged.ebitda === derivedEbitda.value ? { derived: { ebitda: derivedEbitda } } : {}),
  }
  else delete merged.operatingResult
}

/** Only the reported trio is promoted. Other provider fields keep their amounts. */
export function promoteReportedOperatingResults<T extends OperatingStatement>(rows: T[], cohorts: readonly ReportedOperatingCohort[], period: StatementPeriod): T[] {
  const byDate = new Map(rows.map(row => [row.date, row]))
  const dates = new Set(cohorts.filter(group => isReportedOperatingCohort(group) && group.period === period).map(group => group.endDate))
  for (const date of dates) {
    const group = selectReportedOperatingCohort(cohorts.filter(group => group.endDate === date && group.period === period))
    if (!group) continue
    const row = byDate.get(date)
    if (row && row.currency !== "USD") continue
    // Conflicting independent top-line anchors are not proof of a matching vendor period.
    if (row && !compatibleOperatingAnchors(row, group)) continue
    const next = { ...(row ?? { date, currency: "USD" }), ...group.values,
      operatingResult: { ...(row?.operatingResult?.version === 1 ? row.operatingResult : {}), version: 1, reported: group },
      dateSource: "sec", dateEvidence: { accessionNumber: group.accessionNumber, filed: group.filed, startDate: group.startDate },
      fieldAvailability: { ...row?.fieldAvailability, ...Object.fromEntries(OPERATING_FIELDS.map(field => [field, group.filed])) },
    } as T
    delete next.availableAt
    // A newer complete group may invalidate the old derived EBITDA input binding.
    // Keep its amount, but never retain source metadata tied to different inputs.
    mergeOperatingResults(next, next)
    byDate.set(date, next)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}
