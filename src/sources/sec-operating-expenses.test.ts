import { expect, test } from "bun:test";
import { parseCompanyFactsFinancialStatements } from "./sec-edgar";
import { mergeFinancialStatementRows, statementFieldAvailability } from "../utils/financial-statements";
import fixture from "./fixtures/sec-operating-expenses.json";

test("reported operating expenses keep enriched SHOP and MSFT statements consistent", () => {
  for (const issuer of [fixture.shop, fixture.msft]) {
    const parsed = parseCompanyFactsFinancialStatements(issuer);
    for (const row of [...parsed.annualStatements, ...parsed.quarterlyStatements]) {
      const reported = issuer.facts["us-gaap"].OperatingExpenses.units.USD.find(fact => fact.end === row.date)!;
      // The original SHOP vendor expenses excluded transaction and loan losses.
      const vendor = { date: row.date, currency: "USD", operatingExpense: issuer === fixture.shop
        ? (row.date === "2025-12-31" ? 3_670_000_000 : 1_079_000_000) : reported.val };
      const merged = mergeFinancialStatementRows([row], [vendor])[0]!;
      expect(merged.operatingExpense).toBe(reported.val);
      expect(merged.grossProfit! - merged.operatingExpense!).toBe(merged.operatingIncome!);
      expect(statementFieldAvailability(merged, "operatingExpense")).toBe(reported.filed);
      expect(merged.dateEvidence?.accessionNumber).toBe(reported.accn);
    }
  }
});

test("broader cost concepts and unsupported units do not overwrite provider operating expenses", () => {
  const usd = fixture.shop.facts["us-gaap"].OperatingExpenses.units.USD;
  for (const extra of [
    { CostsAndExpenses: { units: { USD: usd } }, OperatingCostsAndExpenses: { units: { USD: usd } } },
    { OperatingExpenses: { units: { EUR: usd } } },
    {},
  ]) {
    const parsed = parseCompanyFactsFinancialStatements({ ...fixture.shop, facts: { "us-gaap": {
      GrossProfit: fixture.shop.facts["us-gaap"].GrossProfit,
      OperatingIncomeLoss: fixture.shop.facts["us-gaap"].OperatingIncomeLoss,
      ...extra,
    } } });
    const row = parsed.annualStatements[0]!;
    expect(row.operatingExpense).toBeUndefined();
    expect(mergeFinancialStatementRows([row], [{ date: row.date, currency: "USD", operatingExpense: 3_670_000_000 }])[0]!.operatingExpense).toBe(3_670_000_000);
  }
  const row = parseCompanyFactsFinancialStatements(fixture.shop).annualStatements[0]!;
  const foreign = { date: row.date, currency: "CAD", operatingExpense: 5_000_000_000 };
  expect(mergeFinancialStatementRows([foreign], [row])).toEqual([foreign]);
});
