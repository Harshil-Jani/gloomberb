import { expect, test } from "bun:test";
import type { FinancialStatement, TickerFinancials } from "../types/financials";
import { coalesceFinancialPeriodAliases, mergeFinancialStatementRows, statementFieldAvailability } from "../utils/financial-statements";
import { normalizeStatementOperatingResult, operatingResultDisagrees, providerOperatingObservation, reportedOperatingCohort } from "../utils/operating-result";
import { parseCompanyFactsFinancialStatements, SecEdgarClient } from "./sec-edgar";
import { buildYahooStatements, parseYahooTimeseries } from "./yahoo-finance/financials";
import { YahooFinanceClient } from "./yahoo-finance";
import { mapCloudFinancials } from "./gloomberb-cloud/normalizers";
import sec from "./fixtures/sec-operating-expenses.json";
import yahoo from "./fixtures/shop-operating-provider.json";
import { readFileSync } from "node:fs";

const metrics = parseYahooTimeseries(yahoo.timeseries.result);
const source = () => parseCompanyFactsFinancialStatements(sec.shop);
const provider = (period: "annual" | "quarterly") => buildYahooStatements({ ...metrics,
  // Controlled independent companion observations; the captured Yahoo request
  // above contained only the directly compared operating trio.
  [`${period}EBITDA`]: [{ asOfDate: period === "annual" ? "2025-12-31" : "2026-06-30", currency: "USD", periodType: period === "annual" ? "12M" : "3M", value: 17 }],
  [`${period}TotalExpenses`]: [{ asOfDate: period === "annual" ? "2025-12-31" : "2026-06-30", currency: "USD", periodType: period === "annual" ? "12M" : "3M", value: 23 }],
}, period, true)[0]!;
const financials = (row: FinancialStatement): TickerFinancials => ({
  quote: { symbol: "SHOP", currency: "USD", exchangeName: "NASDAQ", price: 100, change: 0, changePercent: 0 },
  financialCurrency: "USD", annualStatements: [row], quarterlyStatements: [], priceHistory: [],
});

test("captured native provider and SEC rows keep direct trio and independent companions in both merge orders", () => {
  for (const period of ["annual", "quarterly"] as const) {
    const original = provider(period);
    const direct = source()[period === "annual" ? "annualStatements" : "quarterlyStatements"][0]!;
    for (const [primary, fallback] of [[original, direct], [direct, original]]) {
      const merged = mergeFinancialStatementRows([primary!], [fallback!])[0]!;
      expect(reportedOperatingCohort(merged, period)?.values).toEqual({
        grossProfit: direct.grossProfit!, operatingExpense: direct.operatingExpense!, operatingIncome: direct.operatingIncome!,
      });
      expect(merged.operatingIncome).toBe(period === "annual" ? 1_468_000_000 : 488_000_000);
      expect(merged.operatingExpense).toBe(period === "annual" ? 4_087_000_000 : 1_220_000_000);
      expect(merged.ebitda).toBe(original.ebitda);
      expect(merged.totalExpenses).toBe(original.totalExpenses);
      expect(providerOperatingObservation(merged, "operatingIncome")?.value).toBe(original.operatingIncome);
      if (original.ebitda !== undefined) expect(providerOperatingObservation(merged, "ebitda")?.value).toBe(original.ebitda);
      expect(operatingResultDisagrees(merged)).toBe(true);
      expect(statementFieldAvailability(merged, "operatingExpense")).toBe(direct.operatingResult!.reported!.filed);
      expect(normalizeStatementOperatingResult(JSON.parse(JSON.stringify(merged)), period)).toEqual(merged);
    }
  }
});

test("native default supplementation changes only the qualified reported operating group, with unrelated controls", async () => {
  const client = new YahooFinanceClient() as any;
  let calls = 0;
  client.secClient.getFinancialStatements = async () => { calls++; return source(); };
  const original = financials(provider("annual"));
  const merged = await client.supplementSecStatements("SHOP", "NASDAQ", original, false) as TickerFinancials;
  expect(merged.annualStatements[0]!.operatingIncome).toBe(1_468_000_000);
  expect(merged.annualStatements[0]!.ebitda).toBe(original.annualStatements[0]!.ebitda);
  const toronto = { ...original, quote: { ...original.quote!, currency: "CAD", exchangeName: "TSX" } };
  expect((await client.supplementSecStatements("SHOP", "TSX", toronto, false)).annualStatements).toEqual(toronto.annualStatements);
  expect(calls).toBe(1);
  const alias = await client.supplementSecStatements("SHOP", "XNAS", original, true) as TickerFinancials;
  expect(alias.annualStatements[0]!.operatingIncome).toBe(1_468_000_000);
  expect(alias.annualStatements[0]!.ebitda).toBe(original.annualStatements[0]!.ebitda);
  const msft = parseCompanyFactsFinancialStatements(sec.msft).annualStatements[0]!;
  expect(msft.operatingResult).toBeUndefined();
  expect(mergeFinancialStatementRows([{ date: msft.date, currency: "USD", operatingIncome: 10 }], [msft])[0]!.operatingIncome).toBe(10);
});

test("owned operating rows cannot cross currency, neighboring period or conflicting top-line anchors", () => {
  const direct = source().quarterlyStatements[0]!;
  const original = provider("quarterly");
  const foreign = { ...original, currency: "CAD" };
  expect(mergeFinancialStatementRows([foreign], [direct])[0]!.operatingIncome).toBe(original.operatingIncome);
  const neighboring: FinancialStatement = { date: "2026-06-29", currency: "USD", operatingIncome: original.operatingIncome };
  const merged = mergeFinancialStatementRows([neighboring], [direct])[0]!;
  expect(merged.date).toBe(neighboring.date);
  expect(merged.operatingIncome).toBe(original.operatingIncome);
  expect(merged.operatingExpense).toBeUndefined();
  expect(merged.grossProfit).toBeUndefined();
  expect(merged.operatingResult?.reported).toBeUndefined();
  expect(mergeFinancialStatementRows([neighboring], [direct])).toHaveLength(2);
  const matchingNeighbor = { ...direct, date: neighboring.date, operatingResult: undefined };
  for (const [primary, fallback] of [[matchingNeighbor, direct], [direct, matchingNeighbor]] as const) {
    expect(coalesceFinancialPeriodAliases([primary, fallback]).map(row => row.date)).toEqual([neighboring.date, direct.date]);
    expect(mergeFinancialStatementRows([primary], [fallback]).map(row => row.date)).toEqual([neighboring.date, direct.date]);
    expect(mergeFinancialStatementRows([primary], [fallback]).find(row => row.date === direct.date)?.operatingResult).toEqual(direct.operatingResult);
  }
  const anchored = structuredClone(direct);
  anchored.operatingResult!.reported!.anchors = { totalRevenue: 3_583_000_000 };
  const conflict = mergeFinancialStatementRows([{ ...original, totalRevenue: 1 }], [anchored])[0]!;
  expect(conflict.operatingResult?.reported).toBeUndefined();
  expect(conflict.operatingIncome).toBe(original.operatingIncome);
});

test("Cloud ownership is listing, period and numeric-value bound rather than accepting arbitrary metadata", () => {
  const row = mergeFinancialStatementRows([provider("annual")], source().annualStatements)[0]!;
  const input = financials(row);
  expect(mapCloudFinancials(input as any, undefined, { symbol: "SHOP", exchange: "NASDAQ" }).annualStatements[0]!.operatingResult).toEqual(row.operatingResult);
  expect(mapCloudFinancials({ ...input, quote: undefined } as any, undefined, { symbol: "SHOP", exchange: "TSX" }).annualStatements[0]!.operatingResult).toBeUndefined();
  for (const mutate of [
    (bad: FinancialStatement) => { bad.operatingResult!.reported!.cik = "0000789019"; },
    (bad: FinancialStatement) => { bad.operatingResult!.reported!.period = "quarterly"; },
    (bad: FinancialStatement) => { bad.operatingIncome = 7; },
  ]) {
    const bad = structuredClone(row); mutate(bad);
    expect(mapCloudFinancials(financials(bad) as any, undefined, { symbol: "SHOP", exchange: "NASDAQ" }).annualStatements[0]!.operatingResult?.reported).toBeUndefined();
  }
  const bad = structuredClone(row);
  (bad.operatingResult!.provider!.operatingIncome as any).sourceField = 42;
  expect(normalizeStatementOperatingResult(bad).operatingResult?.provider?.operatingIncome).toBeUndefined();
});

test("companion provenance follows the actual numeric owner even when losing values happen to match", () => {
  const direct = { ...source().annualStatements[0]!, ebitda: provider("annual").ebitda, totalExpenses: provider("annual").totalExpenses };
  const merged = mergeFinancialStatementRows([direct], [provider("annual")])[0]!;
  expect(merged.ebitda).toBe(direct.ebitda);
  expect(merged.operatingResult?.provider?.ebitda).toBeUndefined();
  expect(merged.operatingResult?.provider?.totalExpenses).toBeUndefined();
  expect(merged.operatingResult?.provider?.operatingIncome).toBeDefined();
});

test("Yahoo ownership requires each observation's explicit currency and exact duration, including replacement points", () => {
  for (const period of ["annual", "quarterly"] as const) {
    const valid = { asOfDate: "2025-12-31", currency: "USD", periodType: period === "annual" ? "12M" : "3M", value: 100 };
    for (const unqualified of [{ ...valid, currency: undefined }, { ...valid, periodType: undefined },
      { ...valid, periodType: period === "annual" ? "3M" : "12M" }, { ...valid, value: undefined }]) {
      const row = buildYahooStatements({ [`${period}OperatingIncome`]: [valid, unqualified] }, period, true)[0]!;
      expect(row.operatingIncome).toBe(unqualified.value);
      expect(providerOperatingObservation(row, "operatingIncome")).toBeUndefined();
    }
  }
});

function nativeFixtureClient() {
  const client = new SecEdgarClient() as any;
  const requests: string[] = [];
  const state = { companyFactsFail: false, tableFail: false, submissionsFail: false, amendment: false };
  client.loadLookup = async () => new Map([
    ["SHOP", { cik: "0001594805", exchange: "Nasdaq" }],
    ["MSFT", { cik: "0000789019", exchange: "Nasdaq" }],
  ]);
  client.fetchJson = async (url: string) => {
    requests.push(url);
    if (url.includes("companyfacts")) {
      if (state.companyFactsFail) throw new Error("fixture companyfacts unavailable");
      return url.includes("1594805") ? sec.shop : sec.msft;
    }
    if (state.submissionsFail) throw new Error("fixture submissions unavailable");
    return { cik: "1594805", filings: { recent: {
      accessionNumber: [...(state.amendment ? ["0001594805-26-000048"] : []), "0001594805-26-000047", "0001594805-26-000007"],
      form: [...(state.amendment ? ["10-Q/A"] : []), "10-Q", "10-K"],
      filingDate: [...(state.amendment ? ["2026-08-06"] : []), "2026-08-05", "2026-02-11"],
      primaryDocument: [...(state.amendment ? ["shop-amendment.htm"] : []), "shop-20260630.htm", "shop-20251231.htm"],
    } } };
  };
  client.fetchText = async (url: string) => {
    requests.push(url);
    if (state.tableFail) throw new Error("fixture source unavailable");
    return { body: readFileSync(new URL(`./fixtures/shop-${url.includes("20260630") ? "20260630" : "20251231"}-quarterly-summary.html`, import.meta.url), "utf8") };
  };
  return { client, requests, state };
}

test("native acquisition loads direct Q4 table cohorts with bounded, cached issuer-qualified documents", async () => {
  const { client, requests } = nativeFixtureClient();
  const first = await client.getFinancialStatements("SHOP", { reportedOperatingResults: true });
  const q4 = first.quarterlyStatements.find((row: FinancialStatement) => row.date === "2025-12-31")!;
  expect(q4.operatingIncome).toBe(631_000_000);
  expect(q4.operatingExpense).toBe(1_062_000_000);
  expect(q4.operatingResult.reported.origin.kind).toBe("filing-table");
  expect(q4.operatingResult.reported.anchors).toEqual({ totalRevenue: 3_672_000_000, costOfRevenue: 1_979_000_000 });
  expect(q4.ebitda).toBeUndefined();
  expect(q4.totalExpenses).toBeUndefined();
  expect(requests.filter(url => url.includes("submissions"))).toHaveLength(1);
  expect(requests.filter(url => url.includes("Archives"))).toHaveLength(2);
  await client.getFinancialStatements("SHOP", { reportedOperatingResults: true });
  await client.getFinancialStatements("MSFT", { reportedOperatingResults: true });
  expect(requests.filter(url => url.includes("Archives"))).toHaveLength(2);
});

test("native sources fail independently and failed or unsupported table refresh retains the original qualified snapshot", async () => {
  for (const failure of ["tableFail", "submissionsFail", "amendment"] as const) {
    const { client, requests, state } = nativeFixtureClient();
    await client.getFinancialStatements("SHOP", { reportedOperatingResults: true });
    const snapshot = client.shopOperatingTables;
    snapshot.expiresAt = 0;
    state[failure] = true;
    const stale = await client.getFinancialStatements("SHOP", { reportedOperatingResults: true });
    expect(stale.quarterlyStatements.find((row: FinancialStatement) => row.date === "2025-12-31")?.operatingIncome).toBe(631_000_000);
    expect(client.shopOperatingTables).toBe(snapshot);
    expect(snapshot.expiresAt).toBe(0);
    const requestCount = requests.filter(url => url.includes("submissions")).length;
    await client.getFinancialStatements("SHOP", { reportedOperatingResults: true });
    expect(requests.filter(url => url.includes("submissions"))).toHaveLength(requestCount);
    const cold = nativeFixtureClient();
    cold.state[failure] = true;
    const fallback = await cold.client.getFinancialStatements("SHOP", { reportedOperatingResults: true });
    expect(fallback.annualStatements[0].operatingIncome).toBe(1_468_000_000);
    expect(fallback.quarterlyStatements.find((row: FinancialStatement) => row.date === "2025-12-31")).toBeUndefined();
    if (failure === "amendment") expect(cold.requests.some(url => url.includes("Archives") && url.includes("20260630"))).toBe(false);
  }
  const tablesOnly = nativeFixtureClient();
  tablesOnly.state.companyFactsFail = true;
  const rows = await tablesOnly.client.getFinancialStatements("SHOP", { reportedOperatingResults: true });
  expect(rows.quarterlyStatements.find((row: FinancialStatement) => row.date === "2025-12-31")?.operatingIncome).toBe(631_000_000);
  tablesOnly.client.shopOperatingTables = undefined;
  tablesOnly.state.tableFail = true;
  await expect(tablesOnly.client.getFinancialStatements("SHOP", { reportedOperatingResults: true })).rejects.toThrow("fixture companyfacts unavailable");
});
