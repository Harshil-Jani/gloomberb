# ASML annual EPS accounting basis

The September 22, 2026 research sweep found that Amsterdam and NASDAQ annual statements for 2022 and 2023 combined US GAAP income totals with IFRS earnings per ordinary share. Tables and CSV exports faithfully reproduced the provider rows; the inconsistency was in the financial data.

| Fiscal year | Captured basic / diluted EPS, EUR | Direct US GAAP basic / diluted EPS, EUR | US GAAP net income, EUR | IFRS net income, EUR |
| --- | ---: | ---: | ---: | ---: |
| 2022 | 16.08 / 16.07 | 14.14 / 14.13 | 5,624,200,000 | 6,395,800,000 |
| 2023 | 20.61 / 20.59 | 19.91 / 19.89 | 7,839,000,000 | 8,115,200,000 |

The coherent US GAAP diluted EPS series produces 40.7643% growth in 2023. Mixing the captured IFRS EPS with US GAAP statements produced 28.1269%. IFRS statements containing the IFRS income totals and EPS remain valid and retain their values.

The repair reads directly reported `us-gaap:EarningsPerShareBasic` and `us-gaap:EarningsPerShareDiluted` in EUR/shares from [ASML SEC companyfacts](https://data.sec.gov/api/xbrl/companyfacts/CIK0000937966.json), issuer CIK 937966. It requires both EPS facts, income, revenue, operating income and weighted average basic/diluted shares from the same annual duration and 20-F accession. Gross profit corroborates the cohort where reported. The monetary and share anchors must match the target statement before source EPS can be promoted. The implementation does not reconstruct EPS from income and shares or store replacement EPS constants.

The earliest supporting filings are 0000937966-23-000014, filed February 15, 2023, and 0000937966-24-000008, filed February 14, 2024. Identical later comparatives retain the first supporting availability date. A filing agent's accession prefix is permitted when issuer identity and the complete filing cohort are valid; the 2026 comparative uses 0001628280-26-011378. Conflicting facts inside one cohort, wrong units, incomplete periods and mismatched issuers cannot supply a correction.

When source acquisition is unavailable, the exact captured mixed observations are withdrawn only for qualified ASML Amsterdam/NASDAQ provider rows with matching EUR monetary and share anchors. The marker survives cached and sparse merges. Historical P/E retains a gap instead of calculating substitute EPS from income and shares. Independent broker data and coherent IFRS rows are preserved. The optional filing request retries after a minute; it does not mark all statement history available or unavailable. Corrected fields retain their own filing availability and accounting/share basis in structured output. Detached provenance cannot turn a corrected EPS value into an unattributed provider observation. Its EPS fields remain explicitly unavailable through sparse merges and P/E calculations until a complete compatible provider statement or verified filing cohort restores them.

This correction covers these two annual periods. It does not fill missing quarterly EPS, combine the listings' quarterly coverage, create TTM EPS from annual values, change quote currency, or resolve the separate 2026 EBITDA-basis question. Active missing values use the existing financial-table warning; methodology stays in this document.

The regression fixture `src/test-support/fixtures/asml-earnings.json` contains six complete filing cohorts and captured provider/issuer comparison rows. It records the source hashes: companyfacts `28be6fd0f5608350ec396ae5d5097e45da95f4f29ad3fbd19aac328a15cce3d4`; [issuer 2023 financial workbooks](https://ourbrand.asml.com/m/36764fcac9b66344/original/All-2023-documents-fgde35.zip) `a2aadc53ba35ec6264de2253beeab1378ef7d20c3f5196f4f0f6e2f60d708a52`.
