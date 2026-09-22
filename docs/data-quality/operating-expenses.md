# Reported operating results

The September 22, 2026 Shopify check found that Yahoo's operating expense and income definitions excluded transaction and loan losses. An earlier SEC expense-only correction did not ensure that default and extended statement paths selected a consistent definition. The repair now selects gross profit, operating expenses and operating income together from one directly reported period, currency, accession and filing cohort.

This policy applies only to Shopify's Nasdaq USD listing, CIK `0001594805`. It does not make SEC facts the preferred operating source for other issuers, currencies or listings. In particular, it does not resolve Toronto-listed Shopify's provider definition, ADR conversion or basic-EPS/share-basis differences.

## Source and selection

Shopify's [2025 10-K](https://www.sec.gov/Archives/edgar/data/1594805/000159480526000007/shop-20251231.htm) reports gross profit of USD 5.555 billion, operating expenses of USD 4.087 billion and operating income of USD 1.468 billion. Expenses include USD 417 million of transaction and loan losses. Its [Q2 2026 10-Q](https://www.sec.gov/Archives/edgar/data/1594805/000159480526000047/shop-20260630.htm) reports USD 1.708 billion, USD 1.220 billion and USD 488 million respectively, including USD 141 million of those losses. The captured Yahoo operating income values were USD 1.885 billion and USD 629 million.

The adapter accepts a complete, coherent trio of `GrossProfit`, `OperatingExpenses` and `OperatingIncomeLoss` companyfacts observations. The validated primary filing's Summary Quarterly Results table supplies directly reported quarters, including Q4. Its identity, period headers, units and table structure must match the supported layout; document URL and content hash remain in the provenance. Q4 is not reconstructed by subtracting three quarters from an annual operating result. `CostsAndExpenses` and `OperatingCostsAndExpenses` are not substitutes for operating expenses because they can include cost of revenue.

The loader reads current submissions and at most the latest annual and quarterly primary documents. Unsupported amendments, changed table layouts and source failures do not silently verify an older document as current. A previously qualified table snapshot retains its original dates and expiry while refresh retries back off. Companyfacts and document acquisition can succeed independently. A native optional table wait is bounded; a completed background fetch is available to subsequent requests.

Both default and extended statement paths promote the same qualified reported trio. The selected cohort carries exact period and filing dates through Cloud normalization, native acquisition, cache reopen, chart inputs and JSON export. Conflicting revenue/cost anchors, currency mismatches or nearby period dates cannot qualify a different row. Unchanged comparative repeats retain the original complete cohort's filing date; a changed complete cohort carries its own revision date. Historical as-of statements are not reconstructed.

## Independent companion measures

`totalExpenses` and `ebitda` remain independently owned measures. Promotion of the reported trio does not recompute them or label them as directly reported SEC operating results. Provider ownership is attached only to an observation with matching numeric value, exact period and explicit currency. A losing fallback cannot supply provenance merely because its value happens to equal the selected value.

Cloud extended history already derives some EBITDA observations as operating income plus depreciation and amortization. That arithmetic remains available with explicit derived provenance bound to the actual two inputs; it is not relabeled as Yahoo EBITDA. The native SEC path does not introduce a new EBITDA calculation. For example, the captured default FY2025 EBITDA of USD 1.916 billion and total expenses of USD 9.671 billion remain separate from the reported operating trio.

Trailing aggregates require four consecutive compatible quarters for each tracked operating measure. Reported and provider operating definitions, or provider and derived EBITDA, cannot silently form one sum or growth comparison. Missing or incompatible inputs leave the affected aggregate unavailable; other issuers retain their existing behavior.

An active disagreement appears in the existing statement footer warning. Recurring methodology remains here. This repair adds no standing explanatory block, duplicate action, font change or price-formatting policy.
