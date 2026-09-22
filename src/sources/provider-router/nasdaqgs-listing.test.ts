import { afterEach, expect, spyOn, test } from "bun:test";
import { apiClient } from "../../api-client";
import { AppPersistence } from "../../data/app-persistence";
import type { Quote, TickerFinancials } from "../../types/financials";
import { GloomberbCloudProvider } from "../gloomberb-cloud";
import { AssetDataRouter } from "./index";
import { cacheRouterResource } from "./cache";
import fixture from "./fixtures/shop-nasdaqgs.json";

const originals = { getCloudFinancials: apiClient.getCloudFinancials, getCloudFinancialsBatch: apiClient.getCloudFinancialsBatch,
  getCloudQuote: apiClient.getCloudQuote };
afterEach(() => Object.assign(apiClient, originals));
const recorded = () => structuredClone(fixture.financials) as TickerFinancials;
const target = { symbol: "SHOP", exchange: "XNAS" };
const policy = { staleMs: 60_000, expireMs: 600_000 };

test("recorded SHOP NasdaqGS statements survive the actual Cloud adapter, router, batch and cache", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-16T20:36:00Z"));
  const store = new AppPersistence(":memory:");
  const value = recorded();
  apiClient.getCloudFinancials = async () => ({ status: "success", data: value });
  apiClient.getCloudQuote = async () => ({ status: "success", data: value.quote! });
  apiClient.getCloudFinancialsBatch = async requests => ({ status: "success", data: { items: requests.map(request => ({
    ...request, status: "success", data: value,
  })) } });
  try {
    const router = new AssetDataRouter(new GloomberbCloudProvider(), [], store.resources);
    const fresh = await router.getTickerFinancials(target.symbol, target.exchange);
    const batch = (await router.getTickerFinancialsBatch([target], { forceRefresh: true }))[0]!.financials!;
    const cached = new AssetDataRouter(new GloomberbCloudProvider(), [], store.resources)
      .getCachedFinancialsForTargets([target]).get("SHOP")!;
    for (const result of [fresh, batch, cached]) {
      expect(result.financialCurrency).toBe("USD");
      expect(result.annualStatements).toEqual(value.annualStatements);
      expect(result.quarterlyStatements).toEqual(value.quarterlyStatements);
      expect(result.profile).toEqual(value.profile);
      expect(result.quoteMetadata).toMatchObject({ symbol: "SHOP", listingExchangeName: "NASDAQGS", currency: "USD" });
    }
  } finally { store.close(); clock.mockRestore(); }
});

test("Nasdaq segment aliases retain the regular-session quote route and ordinary US listing controls", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-14T18:00:00Z"));
  try {
    for (const [symbol, declared, requested] of [["SHOP", "NASDAQGS", "XNAS"], ["AAPL", "NASDAQ", "XNAS"],
      ["MSFT", "NASDAQGM", "NASDAQ"], ["JPM", "NYSE", "XNYS"]]) {
      // Session-only control: original listing names are retained; a fresh
      // regular quote isolates identity acceptance from the captured POST gap.
      const quote: Quote = { ...recorded().quote!, symbol: symbol!, listingExchangeName: declared!, exchangeName: declared!,
        marketState: "REGULAR", lastUpdated: Date.now() };
      apiClient.getCloudQuote = async () => ({ status: "success", data: quote });
      const result = await new AssetDataRouter(new GloomberbCloudProvider()).getQuote(symbol!, requested!);
      expect(result).toMatchObject({ symbol, currency: "USD", price: quote.price, listingExchangeName: declared });
    }
  } finally { clock.mockRestore(); }
});

test("recognizing NasdaqGS does not accept Toronto, NYSE, contradictory metadata or another issuer", async () => {
  const original = recorded();
  for (const [index, value] of ([
    { ...original, quote: { ...original.quote!, listingExchangeName: "TSX", exchangeName: "TSX", currency: "CAD" } },
    { ...original, quote: { ...original.quote!, listingExchangeName: "NYSE", exchangeName: "NYSE" } },
    { ...original, quote: { ...original.quote!, symbol: "OTHER" } },
    { ...original, quoteMetadata: { symbol: "SHOP", currency: "CAD", listingExchangeName: "TSX" } },
  ] as TickerFinancials[]).entries()) {
    const store = new AppPersistence(":memory:");
    apiClient.getCloudFinancials = async () => ({ status: "success", data: value });
    apiClient.getCloudQuote = async () => ({ status: "error", message: "No quote in this control" });
    try {
      const router = new AssetDataRouter(new GloomberbCloudProvider(), [], store.resources);
      await expect(router.getTickerFinancials(target.symbol, target.exchange)).rejects.toThrow("No provider available for SHOP");
      if (index < 2) {
        cacheRouterResource(store.resources, "financials", "SHOP", "exchange=NASDAQ", "provider:gloomberb-cloud", value, policy);
        expect(router.getCachedFinancialsForTargets([target]).get("SHOP")).toBeUndefined();
      }
    } finally { store.close(); }
  }
});
