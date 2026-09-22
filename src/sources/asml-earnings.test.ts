import { parseReportedEarningsCohorts, promoteReportedEarningsResults, ownedReportedEarningsCohort } from "../utils/reported-earnings-result";
import { parseCompanyFactsFinancialStatements } from "./sec-edgar";
import { statementFieldAvailability } from "../utils/financial-statements";
import { expect, test } from "bun:test";
import type { FinancialStatement, TickerFinancials } from "../types/financials";
import fixture from "../test-support/fixtures/asml-earnings.json";
import { mapCloudFinancials } from "./gloomberb-cloud/normalizers";
import { withdrawKnownProviderStatements } from "../utils/statement-observations";
import { mergeFinancialStatementRows } from "../utils/financial-statements";
import { buildFinancialTableModel } from "../plugins/builtin/ticker-detail/financials/model";
import { extractFundamentalSeries } from "../time-series/fundamentals";

const captured = (exchange: "AMS" | "NASDAQ" = "AMS") => structuredClone(fixture.provider[exchange]) as unknown as TickerFinancials;
const affected = (rows: FinancialStatement[]) => rows.filter(row => ["2022-12-31", "2023-12-31"].includes(row.date));

test("captured mixed annual EPS is unavailable through Cloud mapping without changing income, quarters or later years", () => {
  for (const exchange of ["AMS", "NASDAQ"] as const) {
    const raw = captured(exchange);
    const clean = mapCloudFinancials(raw as any, undefined, { symbol: "ASML", exchange });
    for (const row of affected(clean.annualStatements)) {
      expect(row.eps).toBeUndefined();
      expect(row.basicEps).toBeUndefined();
      expect(row.withdrawnObservations?.length).toBe(2);
      expect(row.netIncome).toBe(raw.annualStatements.find(source => source.date === row.date)!.netIncome);
    }
    expect(clean.annualStatements.filter(row => !affected([row]).length)).toEqual(raw.annualStatements.filter(row => !affected([row]).length));
    expect(clean.quarterlyStatements).toEqual(raw.quarterlyStatements);
    expect(clean.financialCurrency).toBe("EUR");
    expect(clean.quote?.currency).toBe(exchange === "AMS" ? "EUR" : "USD");
    const table = buildFinancialTableModel(clean, { period: "annual", expandAll: true })!;
    const eps = table.rows.find(row => row.key === "eps")!;
    expect(eps.cells.filter((_, index) => ["2022-12-31", "2023-12-31", "2024-12-31"].includes(table.statements[index]!.date)).map(cell => cell.growth))
      .toEqual([undefined, undefined, undefined]);
  }
});

test("the same EPS numbers remain valid in coherent IFRS cohorts and unrelated listing/source identities", () => {
  const raw = captured();
  const ifrs = { ...raw, annualStatements: fixture.issuer.IFRS as FinancialStatement[] };
  expect(withdrawKnownProviderStatements(ifrs, { symbol: "ASML", exchange: "AMS" }, "provider:yahoo")).toEqual(ifrs);
  for (const [target, source] of [
    [{ symbol: "ASML", exchange: "VIE" }, "provider:yahoo"],
    [{ symbol: "OTHER", exchange: "AMS" }, "provider:yahoo"],
    [{ symbol: "ASML", exchange: "AMS" }, "broker:account"],
  ] as const) expect(withdrawKnownProviderStatements(raw, target, source)).toBe(raw);
  const contradictory = { ...raw, quoteMetadata: { symbol: "OTHER", listingExchangeName: "AMS" } } as TickerFinancials;
  expect(withdrawKnownProviderStatements(contradictory, { symbol: "ASML", exchange: "AMS" }, "provider:yahoo")).toBe(contradictory);
});

test("annual EPS withdrawals survive sparse merges and do not manufacture historical P/E from income and shares", () => {
  const raw = captured();
  const clean = withdrawKnownProviderStatements(raw, { symbol: "ASML", exchange: "AMS" }, "provider:yahoo");
  for (const [primary, fallback] of [[clean.annualStatements, raw.annualStatements], [raw.annualStatements, clean.annualStatements]]) {
    const rows = mergeFinancialStatementRows(primary!, fallback!);
    expect(affected(JSON.parse(JSON.stringify(rows))).every(row => row.eps === undefined && row.basicEps === undefined)).toBe(true);
    const input = { ...clean, annualStatements: rows, quarterlyStatements: [], quote: { ...clean.quote!, stale: true },
      priceHistory: rows.map(row => ({ date: new Date(row.date), close: 100 })) };
    const values = extractFundamentalSeries(input, { kind: "security", instrument: { symbol: "ASML", exchange: "AMS" }, fieldId: "valuation.trailingPE", period: "annual" });
    const gaps = values.filter(point => ["2022-12-31", "2023-12-31"].some(date => point.date.toISOString().startsWith(date)));
    expect(gaps).toHaveLength(2);
    expect(gaps.every(point => point.value === null)).toBe(true);
  }
});

const cohorts = () => parseReportedEarningsCohorts(fixture.companyfacts, "0000937966");
const corrected = (exchange: "AMS" | "NASDAQ" = "AMS") => {
  const raw = captured(exchange);
  return { ...raw, annualStatements: promoteReportedEarningsResults(raw.annualStatements, cohorts(), "annual") };
};

test("direct same-filing EUR EPS restores coherent growth and first availability in both listing currencies", () => {
  expect(cohorts()).toHaveLength(6);
  expect(cohorts().some(group => group.accessionNumber === "0001628280-26-011378")).toBe(true);
  // The existing generic parser stays limited to its supported USD statement facts.
  expect(parseCompanyFactsFinancialStatements(fixture.companyfacts).annualStatements).toEqual([]);
  for (const exchange of ["AMS", "NASDAQ"] as const) {
    const raw = captured(exchange);
    const withdrawn = withdrawKnownProviderStatements(raw, { symbol: "ASML", exchange }, "provider:yahoo");
    const recovered = corrected(exchange);
    for (const [primary, fallback] of [[withdrawn, recovered], [recovered, withdrawn]]) {
      const rows = mergeFinancialStatementRows(primary!.annualStatements, fallback!.annualStatements);
      const selected = affected(rows);
      expect(selected.map(row => [row.basicEps, row.eps])).toEqual([[14.14, 14.13], [19.91, 19.89]]);
      expect(selected.map(row => statementFieldAvailability(row, "eps"))).toEqual(["2023-02-15", "2024-02-14"]);
      expect(selected.every(row => !row.withdrawnObservations?.length && !!ownedReportedEarningsCohort(row))).toBe(true);
      const mapped = mapCloudFinancials({ ...recovered, annualStatements: rows } as any, undefined, { symbol: "ASML", exchange });
      expect(affected(mapped.annualStatements)).toEqual(selected);
      expect(mapped.quarterlyStatements).toEqual(raw.quarterlyStatements);
      const table = buildFinancialTableModel(mapped, { period: "annual", expandAll: true })!;
      const eps = table.rows.find(row => row.key === "eps")!;
      expect(eps.cells[table.statements.findIndex(row => row.date === "2023-12-31")]!.growth).toBeCloseTo(0.407643312101911, 10);
    }
  }
});

test("cohort parser rejects wrong issuer, units, forms, durations and conflicting or incomplete source groups", () => {
  expect(parseReportedEarningsCohorts(fixture.companyfacts, "0000320193")).toEqual([]);
  for (const mutate of [
    (value: any) => { value.cik = 320193; },
    (value: any) => { value.facts["us-gaap"].EarningsPerShareBasic.units.USD = value.facts["us-gaap"].EarningsPerShareBasic.units["EUR/shares"]; delete value.facts["us-gaap"].EarningsPerShareBasic.units["EUR/shares"]; },
    (value: any) => { for (const entry of value.facts["us-gaap"].EarningsPerShareBasic.units["EUR/shares"]) entry.form = "10-K"; },
    (value: any) => { for (const entry of value.facts["us-gaap"].EarningsPerShareBasic.units["EUR/shares"]) entry.start = "2022-10-01"; },
    (value: any) => { const entries = value.facts["us-gaap"].EarningsPerShareBasic.units["EUR/shares"]; entries.push(...entries.map((entry: any) => ({ ...entry, val: entry.val + 1 }))); },
    (value: any) => { delete value.facts["us-gaap"].NetIncomeLoss; },
  ]) {
    const bad = structuredClone(fixture.companyfacts); mutate(bad);
    expect(parseReportedEarningsCohorts(bad, "0000937966")).toEqual([]);
  }
});

test("detached earnings ownership cannot leak through wire, nearby periods or accounting-basis merges", () => {
  const good = affected(corrected().annualStatements)[0]!;
  for (const patch of [{ date: "2022-12-30" }, { netIncome: 1 }, { currency: "USD" },
    { earningsResult: { ...good.earningsResult!, reported: { ...good.earningsResult!.reported, cik: "0000320193" } } }]) {
    const bad = { ...good, ...patch } as FinancialStatement;
    for (const row of [mapCloudFinancials({ ...captured(), annualStatements: [bad] } as any, undefined, { symbol: "ASML", exchange: "AMS" }).annualStatements[0]!,
      mergeFinancialStatementRows([bad], [])[0]!]) {
      expect(row.earningsResult).toBeUndefined(); expect(row.eps).toBeUndefined(); expect(row.fieldAvailability?.eps).toBeUndefined();
    }
  }
  for (const target of [{ symbol: "OTHER", exchange: "AMS" }, { symbol: "ASML", exchange: "VIE" }]) {
    const row = mapCloudFinancials({ ...captured(), annualStatements: [good] } as any, undefined, target).annualStatements[0]!;
    expect(row.earningsResult).toBeUndefined(); expect(row.eps).toBeUndefined(); expect(row.fieldAvailability?.eps).toBeUndefined();
  }
  const quarter = mapCloudFinancials({ ...captured(), quarterlyStatements: [good] } as any, undefined, { symbol: "ASML", exchange: "AMS" }).quarterlyStatements[0]!;
  expect(quarter.eps).toBeUndefined(); expect(quarter.earningsResult).toBeUndefined();
  const ifrs = (fixture.issuer.IFRS as FinancialStatement[]).find(row => row.date === good.date)!;
  expect(mergeFinancialStatementRows([ifrs], [good])[0]!.eps).toBe(ifrs.eps);
  expect(mergeFinancialStatementRows([good], [ifrs])[0]!.eps).toBe(good.eps);
  const neighbor = { ...good, date: "2022-12-30", earningsResult: undefined };
  expect(mergeFinancialStatementRows([neighbor], [good])).toHaveLength(2);
});

test("withdrawal markers need qualified issuer and provider identity at incoming boundaries", () => {
  const raw = captured();
  const clean = withdrawKnownProviderStatements(raw, { symbol: "ASML", exchange: "AMS" }, "provider:yahoo");
  const markers = affected(clean.annualStatements)[0]!.withdrawnObservations;
  const supplied = { ...raw, annualStatements: raw.annualStatements.map(row => row.date === "2022-12-31" ? { ...row, withdrawnObservations: markers } : row) };
  for (const [target, source] of [[{ symbol: "OTHER", exchange: "AMS" }, "provider:yahoo"], [{ symbol: "ASML", exchange: "AMS" }, "broker:account"]] as const) {
    const row = affected(withdrawKnownProviderStatements(supplied, target, source).annualStatements)[0]!;
    expect(row.eps).toBe(16.07); expect(row.withdrawnObservations).toBeUndefined();
  }
});


test("EPS chart exports retain accounting ownership and historical P/E uses the reported filing EPS", () => {
  const value = corrected();
  const rows = affected(value.annualStatements);
  const input = { ...value, annualStatements: rows, quarterlyStatements: [], quote: { ...value.quote!, stale: true },
    priceHistory: ["2023-02-15", "2024-02-14"].map(date => ({ date: new Date(date), close: 100 })) };
  for (const fieldId of ["fundamental.eps", "valuation.trailingPE"]) {
    const points = extractFundamentalSeries(input, { kind: "security", instrument: { symbol: "ASML", exchange: "AMS" }, fieldId, period: "annual" });
    expect(points).toHaveLength(2);
    expect(points.map(point => point.date.toISOString().slice(0, 10))).toEqual(["2023-02-15", "2024-02-14"]);
    expect(points.map(point => point.value)).toEqual(fieldId === "fundamental.eps" ? [14.13, 19.89] : [100 / 14.13, 100 / 19.89]);
    expect(JSON.parse(JSON.stringify(points)).map((point: any) => point.provenance.earningsResult.reported.values.eps)).toEqual([14.13, 19.89]);
  }
});

test("detached filing EPS remains unavailable through sparse fallback and historical P/E reconstruction", () => {
  const good = affected(corrected().annualStatements)[0]!;
  const bad = { ...good, netIncome: 1 };
  const clean = mapCloudFinancials({ ...captured(), annualStatements: [bad], quarterlyStatements: [] } as any, undefined, { symbol: "ASML", exchange: "AMS" });
  for (const [primary, fallback] of [[clean.annualStatements, [{ date: bad.date, currency: "EUR", eps: good.eps, basicEps: good.basicEps }]],
    [[{ date: bad.date, currency: "EUR", eps: good.eps, basicEps: good.basicEps }], clean.annualStatements]]) {
    const rows = mergeFinancialStatementRows(primary!, fallback!);
    expect(rows[0]!.eps).toBeUndefined();
    const stored = JSON.parse(JSON.stringify({ ...clean, annualStatements: rows }));
    expect(withdrawKnownProviderStatements(stored, { symbol: "ASML", exchange: "AMS" }, "provider:yahoo")).toBe(stored);
    const neighbor = affected(corrected().annualStatements)[1]!;
    const points = extractFundamentalSeries({ ...clean, annualStatements: [...rows, neighbor], quote: { ...clean.quote!, stale: true },
      priceHistory: [{ date: new Date(bad.date), close: 100 }, { date: new Date("2024-02-14"), close: 100 }] }, {
      kind: "security", instrument: { symbol: "ASML", exchange: "AMS" }, fieldId: "valuation.trailingPE", period: "annual", timestampMode: "period-end",
    });
    expect(points).toHaveLength(2); expect(points[0]!.value).toBeNull(); expect(points[1]!.value).toBe(100 / 19.89);
  }
});


test("chart period deduplication keeps nearby provider EPS separate from an owned filing or an unavailable fiscal period", () => {
  const value = corrected();
  const [good, nextYear] = affected(value.annualStatements);
  const detached = mapCloudFinancials({ ...value, annualStatements: [{ ...good!, netIncome: 1 }] } as any, undefined,
    { symbol: "ASML", exchange: "AMS" }).annualStatements[0]!;
  for (const dated of [false, true]) for (const fiscal of [good!, detached]) {
    const neighbor = { date: "2022-12-30", currency: "EUR", eps: 14.13, basicEps: 14.14,
      ...(dated ? { availableAt: "2023-02-15" } : {}) };
    const points = extractFundamentalSeries({ ...value, annualStatements: [neighbor, fiscal, nextYear!], quarterlyStatements: [],
      quote: { ...value.quote!, stale: true }, priceHistory: ["2022-12-30", "2023-02-15", "2024-02-14"].map(date => ({ date: new Date(date), close: 100 })) }, {
      kind: "security", instrument: { symbol: "ASML", exchange: "AMS" }, fieldId: "valuation.trailingPE", period: "annual", timestampMode: "period-end",
    });
    expect(points.map(point => point.observedAt.toISOString().slice(0, 10))).toEqual(["2022-12-30", "2022-12-31", "2023-12-31"]);
    expect(points[1]!.value).toBe(fiscal === detached ? null : 100 / 14.13);
    expect(points[2]!.value).toBe(100 / 19.89);
    if (fiscal === detached) expect(points[1]!.provenance?.unavailableEarnings).toEqual(["eps"]);
  }
});
