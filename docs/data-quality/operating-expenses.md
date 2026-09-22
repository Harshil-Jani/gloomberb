# Reported operating expenses

The September 22, 2026 Shopify check found that Yahoo operating expenses excluded transaction and loan losses. SEC enrichment already supplied reported operating income, but left the lower provider expense total in the same row. For FY2025, gross profit of USD 5.555 billion minus provider expenses of USD 3.670 billion disagreed with reported operating income of USD 1.468 billion.

The SEC source adapter now projects the directly reported `us-gaap:OperatingExpenses` fact. Shopify's [2025 10-K](https://www.sec.gov/Archives/edgar/data/1594805/000159480526000007/shop-20251231.htm) reports USD 4.087 billion of operating expenses, including USD 417 million of transaction and loan losses. Its [Q2 2026 10-Q](https://www.sec.gov/Archives/edgar/data/1594805/000159480526000047/shop-20260630.htm) reports USD 1.220 billion, including USD 141 million of those losses. Filing periods and publication dates remain attached to the selected facts.

This uses reported facts, not gross-profit-minus-income reconstruction. `CostsAndExpenses` and `OperatingCostsAndExpenses` are not substitutes: they can include cost of revenue. Missing tags retain the existing provider fallback; unsupported reporting currencies and non-US listing eligibility are unchanged. This does not resolve the Toronto listing's provider definition or basic-EPS/share-basis differences.
