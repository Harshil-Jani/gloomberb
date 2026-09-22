import { expect, test } from "bun:test";
import type { FinancialStatement, TickerFinancials } from "../types/financials";
import type { HeadlessPaneContext, HeadlessPaneLoadArgs } from "../types/headless";
import type { SecuritySeriesSource } from "../time-series/types";
import { createTestDataProvider } from "../test-support/data-provider";
import { renderHeadlessPaneText } from "../cli/pane-functions/headless";
import { deriveQuarterlyStatements, extractFundamentalSeries } from "../time-series/fundamentals";
import { computeTTM } from "../plugins/builtin/ticker-detail/financials/aggregation";
import { buildFinancialTableModel } from "../plugins/builtin/ticker-detail/financials/model";
import { financialStatementsHeadless } from "../plugins/builtin/ticker-detail/headless";
import { addDerivedOperatingObservation, addProviderOperatingObservation } from "./operating-result";
import { canCompareOperatingField } from "./operating-result-aggregation";

// The four directly printed operating results in SHOP's Q2 2026 quarterly table.
// Other fields below are controlled inputs for consumer/ownership regressions.
function quarters(): FinancialStatement[] {
  return [
    ["2025-07-01", "2025-09-30", 1048, 343],
    ["2025-10-01", "2025-12-31", 1062, 631],
    ["2026-01-01", "2026-03-31", 1164, 382],
    ["2026-04-01", "2026-06-30", 1220, 488],
  ].map(([start, end, expense, income]) => {
    const operatingExpense = Number(expense) * 1e6;
    const operatingIncome = Number(income) * 1e6;
    const row: FinancialStatement = { date: String(end), currency: "USD", availableAt: "2026-08-06",
      totalRevenue: 3e9, grossProfit: operatingExpense + operatingIncome,
      operatingExpense: operatingExpense - 100e6, operatingIncome: operatingIncome + 100e6,
      totalExpenses: 2e9, ebitda: 800e6, depreciationAndAmortization: 20e6,
      basicShares: 1e9, totalDebt: 0, cashAndCashEquivalents: 0,
    };
    for (const field of ["grossProfit", "operatingExpense", "operatingIncome", "totalExpenses", "ebitda"] as const) {
      addProviderOperatingObservation(row, field, "yahoo", field[0]!.toUpperCase() + field.slice(1), "quarterly");
    }
    row.operatingExpense = operatingExpense;
    row.operatingIncome = operatingIncome;
    row.operatingResult!.reported = {
      cik: "0001594805", period: "quarterly", startDate: String(start), endDate: row.date,
      currency: "USD", accessionNumber: "0001594805-26-000029", filed: "2026-08-06", form: "10-Q",
      values: { grossProfit: row.grossProfit!, operatingExpense, operatingIncome }, origin: { kind: "companyfacts" },
    };
    return row;
  });
}

function financials(rows = quarters(), annualStatements: FinancialStatement[] = []): TickerFinancials {
  return { quarterlyStatements: rows, annualStatements, financialCurrency: "USD", priceHistory: [{ date: new Date("2026-08-06"), close: 100 }],
    quote: { symbol: "SHOP", exchangeName: "NASDAQ", currency: "USD", price: 100,
      change: 0, changePercent: 0, lastUpdated: Date.parse("2026-09-22T10:00:00Z") },
  };
}

function source(field = "operatingIncome", period: SecuritySeriesSource["period"] = "ttm"): SecuritySeriesSource {
  return { kind: "security", instrument: { symbol: "SHOP", exchange: "NASDAQ" },
    fieldId: field === "ebitda" ? "valuation.evEbitda" : `fundamental.${field}`, period, timestampMode: "available-at" };
}

test("table and chart TTM sum direct operating quarters while keeping independent vendor companions", () => {
  const rows = quarters();
  const before = structuredClone(rows);
  const ttm = computeTTM(rows)!;
  expect(ttm).toMatchObject({ operatingExpense: 4_494_000_000, operatingIncome: 1_844_000_000,
    grossProfit: 6_338_000_000, totalExpenses: 8e9, ebitda: 3.2e9 });
  expect(ttm.operatingResult).toBeUndefined();
  expect(ttm.operatingResultAggregation?.sourcePeriods.map(row => row.date)).toEqual(rows.map(row => row.date));
  const [point] = extractFundamentalSeries(financials(rows), source());
  expect(point).toMatchObject({ value: 1_844_000_000, provenance: { quality: "derived",
    operatingResultAggregation: { kind: "trailing-four-quarters", unavailableFields: [] } } });
  expect(extractFundamentalSeries(financials(rows), source("ebitda"))[0]?.value).toBe(100e9 / 3.2e9);
  expect(canCompareOperatingField(ttm, JSON.parse(JSON.stringify(ttm)), "operatingIncome")).toBe(true);
  ttm.operatingResultAggregation!.sourcePeriods[0]!.operatingResult!.reported!.filed = "modified export";
  expect(rows).toEqual(before);
});

test("a vendor operating quarter blocks only mixed-basis TTM fields and growth", () => {
  const rows = quarters();
  delete rows[0]!.operatingResult!.reported;
  rows[0]!.operatingIncome = rows[0]!.operatingResult!.provider!.operatingIncome!.value;
  rows[0]!.operatingExpense = rows[0]!.operatingResult!.provider!.operatingExpense!.value;
  const ttm = computeTTM(rows)!;
  expect(ttm.operatingIncome).toBeUndefined();
  expect(ttm.operatingExpense).toBeUndefined();
  expect(ttm.grossProfit).toBeUndefined();
  expect(ttm.ebitda).toBe(3.2e9);
  expect(ttm.totalExpenses).toBe(8e9);
  expect(ttm.totalRevenue).toBe(12e9);
  expect(extractFundamentalSeries(financials(rows), source())).toEqual([]);
  expect(extractFundamentalSeries(financials(rows), source("ebitda"))[0]?.value).toBe(100e9 / 3.2e9);
  const table = buildFinancialTableModel(financials(rows), { period: "quarterly", expandAll: true })!;
  const income = table.rows.find(row => row.summaryKey === "operatingIncome" || row.key === "operatingIncome")!;
  expect(income.cells[2]!.growth).toBeUndefined();
  expect(income.cells[1]!.growth).toBeDefined();
});

test("four SEC-derived EBITDA quarters survive both consumers and JSON growth, but cannot mix with vendor EBITDA", () => {
  const rows = quarters();
  for (const row of rows) {
    delete row.operatingResult!.provider!.ebitda;
    row.ebitda = row.operatingIncome! + row.depreciationAndAmortization!;
    addDerivedOperatingObservation(row, "quarterly");
  }
  const ttm = computeTTM(rows)!;
  expect(ttm.ebitda).toBe(1_924_000_000);
  expect(canCompareOperatingField(ttm, JSON.parse(JSON.stringify(ttm)), "ebitda")).toBe(true);
  const point = extractFundamentalSeries(financials(rows), source("ebitda"))[0]!;
  expect(point.value).toBe(100e9 / ttm.ebitda!);
  const current = extractFundamentalSeries(financials(rows), source("ebitda")).at(-1)!;
  expect(current.periodLabel).toBe("Current");
  expect(current.provenance?.operatingResultAggregation).toEqual(point.provenance?.operatingResultAggregation);
  expect(point.provenance?.operatingResultAggregation?.sourcePeriods[0]?.operatingResult?.derived?.ebitda).toBeDefined();
  rows[0] = quarters()[0]!;
  expect(computeTTM(rows)?.ebitda).toBeUndefined();
  expect(extractFundamentalSeries(financials(rows), source("ebitda"))).toEqual([]);
  expect(computeTTM(rows)?.operatingIncome).toBe(1_844_000_000);
});

test("chart merging keeps unchanged comparative filing dates and does not borrow a losing equal-value companion owner", () => {
  const original = quarters()[0]!;
  original.operatingResult!.reported!.filed = "2025-11-04";
  original.operatingResult!.reported!.accessionNumber = "0001594805-25-000031";
  const repeated = structuredClone(original);
  repeated.operatingResult!.reported!.filed = "2026-08-06";
  repeated.operatingResult!.reported!.accessionNumber = "0001594805-26-000029";
  const point = extractFundamentalSeries(financials([repeated, original]), source("operatingIncome", "quarterly"))[0]!;
  expect(point.availableAt).toEqual(new Date("2025-11-04"));
  expect(point.provenance?.operatingResult?.reported?.accessionNumber).toBe("0001594805-25-000031");
  const unowned = { date: original.date, currency: "USD", availableAt: "2025-10-30", ebitda: original.ebitda };
  const ebitda = deriveQuarterlyStatements([original, unowned], [])[0]!;
  expect(ebitda.ebitda).toBe(original.ebitda);
  expect(ebitda.operatingResult?.provider?.ebitda).toBeUndefined();
  const neighboring = { date: "2025-09-29", currency: "USD", availableAt: "2025-10-30", operatingIncome: original.operatingIncome };
  const distinct = extractFundamentalSeries(financials([original, neighboring]), source("operatingIncome", "quarterly"));
  expect(distinct).toHaveLength(2);
  expect(distinct.find(point => point.provenance?.operatingResult)?.observedAt).toEqual(new Date(original.date));
  const amended = structuredClone(original);
  amended.operatingIncome = 400e6;
  amended.operatingExpense = amended.grossProfit! - amended.operatingIncome;
  Object.assign(amended.operatingResult!.reported!, { filed: "2026-03-01", accessionNumber: "0001594805-26-000010",
    values: { grossProfit: amended.grossProfit!, operatingExpense: amended.operatingExpense, operatingIncome: amended.operatingIncome } });
  // The latest revision restores the original amount. Sorting by input position
  // must not mistake that later observation for an unchanged comparative repeat.
  for (const revisions of [[original, amended, repeated], [original, repeated, amended], [repeated, original, amended]]) {
    const final = deriveQuarterlyStatements(revisions, [])[0]!;
    expect(final.operatingIncome).toBe(original.operatingIncome);
    expect(final.operatingResult!.reported!.filed).toBe("2026-08-06");
  }
});

test("scoped missing Q4 is not synthesized from other filing vintages; ordinary issuers retain Q4 derivation", () => {
  const rows = quarters().map((row, index) => {
    const dates = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"];
    const starts = ["2025-01-01", "2025-04-01", "2025-07-01", "2025-10-01"];
    row.date = dates[index]!;
    row.operatingResult!.reported!.startDate = starts[index]!;
    row.operatingResult!.reported!.endDate = row.date;
    for (const value of Object.values(row.operatingResult!.provider!)) value.endDate = row.date;
    return row;
  });
  const annual: FinancialStatement = { date: "2025-12-31", currency: "USD", operatingIncome: 2e9, totalRevenue: 12e9 };
  const missing = deriveQuarterlyStatements(rows.slice(0, 3), [annual]).find(row => row.date === annual.date)!;
  expect(missing.operatingIncome).toBeUndefined();
  expect(missing.totalRevenue).toBe(3e9);
  const direct = deriveQuarterlyStatements(rows, [annual]).find(row => row.date === annual.date)!;
  expect(direct.operatingIncome).toBe(rows[3]!.operatingIncome);
  expect(direct.operatingResult?.reported).toEqual(rows[3]!.operatingResult?.reported);
  const ordinary = rows.slice(0, 3).map(({ operatingResult, ...row }) => row);
  expect(deriveQuarterlyStatements(ordinary, [annual]).find(row => row.date === annual.date)?.operatingIncome)
    .toBe(2e9 - ordinary.reduce((sum, row) => sum + row.operatingIncome!, 0));
});

test("zero and loss quarters aggregate, while malformed or repeated cached inputs cannot establish comparable TTM", () => {
  const rows = quarters();
  for (const [index, value] of [[0, 0], [1, -100e6]] as const) {
    rows[index]!.operatingIncome = value;
    rows[index]!.operatingResult!.reported!.values.operatingIncome = value;
  }
  const ttm = computeTTM(rows)!;
  expect(ttm.operatingIncome).toBe(770e6);
  for (const corrupt of [
    (row: any) => { delete row.operatingResultAggregation.unavailableFields; },
    (row: any) => { row.operatingResultAggregation.sourcePeriods = null; },
    (row: any) => { row.operatingResultAggregation.sourcePeriods[0] = null; },
    (row: any) => {
      row.operatingResultAggregation.sourcePeriods = Array(4).fill(row.operatingResultAggregation.sourcePeriods[1]);
      row.operatingIncome = -400e6;
    },
  ]) {
    const broken = structuredClone(ttm); corrupt(broken);
    expect(canCompareOperatingField(broken, ttm, "operatingIncome")).toBe(false);
  }
});

test("headless financial exports preserve direct and aggregate ownership and disclose an active source disagreement", async () => {
  const rows = quarters();
  const annual = structuredClone(rows[0]!);
  annual.date = "2025-12-31";
  Object.assign(annual.operatingResult!.reported!, { period: "annual", startDate: "2025-01-01", endDate: annual.date, form: "10-K" });
  for (const observation of Object.values(annual.operatingResult!.provider!)) {
    observation.period = "annual"; observation.endDate = annual.date;
  }
  const ctx = { marketData: createTestDataProvider({ getTickerFinancials: async () => financials(rows, [annual]) }) } as HeadlessPaneContext;
  const args: HeadlessPaneLoadArgs = { symbols: ["SHOP:NASDAQ"], argument: ["SHOP:NASDAQ"], rawArgument: "SHOP:NASDAQ",
    options: { period: "annual", statement: "income" } };
  const result = await financialStatementsHeadless.load(args, ctx);
  const json = JSON.parse(JSON.stringify(result));
  const ttm = json.metadata.columns.find((column: any) => column.date === "TTM");
  expect(ttm.operatingResultAggregation.sourcePeriods).toHaveLength(4);
  expect(ttm.operatingResult).toBeUndefined();
  expect(json.metadata.columns.find((column: any) => column.date === annual.date).operatingResult).toEqual(annual.operatingResult);
  expect(json.rows.find((row: any) => row.id === "income:operating").TTM).toBe(1_844_000_000);
  const text = renderHeadlessPaneText(financialStatementsHeadless, result, args, "Financials");
  expect(text).toContain("Reported operating results differ from provider figures.");
});
