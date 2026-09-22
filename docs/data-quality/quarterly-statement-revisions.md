# Quarterly statement source disagreements

The September 16, 2026 research audit compared NYSE BAC and Realty Income (O), USD, quarter ended December 31, 2025 against their issuer releases. Fresh Yahoo timeseries and Twelve Data quarterly income statements repeated the discrepancies in Cloud. A provider switch therefore did not repair them.

| Issuer / field | Observed vendor value, USD | Issuer release, USD |
| --- | ---: | ---: |
| BAC total revenue | 31,180,000,000 | 28,367,000,000 |
| BAC operating revenue (Yahoo alias, checked September 22) | 31,180,000,000 | 28,367,000,000 |
| BAC parent net income | 7,528,000,000 | 7,647,000,000 |
| BAC common-shareholder income | 7,200,000,000 | 7,319,000,000 |
| BAC pretax income | 12,435,000,000 | 9,622,000,000 |
| BAC income tax expense | 4,907,000,000 | 1,975,000,000 |
| O total revenue | 1,708,836,000 | 1,487,942,000 |
| O parent net income (Twelve Data adapter) | 301,636,000 | 296,085,000 |

[BAC's January 14 release](https://investor.bankofamerica.com/regulatory-and-other-filings/select-sec-filings/content/0000070858-26-000020/bac12312025ex991.htm), accession 0000070858-26-000020, exhibit 99.1, page 14, separately identifies the fourth-quarter 2025 column and amounts in millions. The tax-equity accounting footnote explains retrospective presentation changes. [Realty Income's February 24 release](https://www.realtyincome.com/sites/realty-income/files/2026-02/02-24-26-realty-income-announces-operating-results-for-the-three-months-and-year-ended-december-31-2025.pdf), page 9, identifies three months ended December 31, 2025 and amounts in thousands.

Native chart subtraction also combined revised BAC Q1/Q2 with older Q3 facts. For the recorded facts it produced revenue 29,319,000,000, parent income 7,510,000,000 and common income 7,182,000,000. These disagree with the same release. The captured SEC arrays supply neither a direct Q4 fact for these fields nor annual/nine-month facts in the same accession. Later filing dates alone do not establish a consistent accounting presentation.

The app withdraws these exact source observations for the identified listing, reporting currency and quarter, and retains withdrawal identifiers through statement merges, caches and structured exports. It also blocks recreation of those attested bad results during chart completion. A different reported value can restore the field; directly sourced SEC income retains its own filing evidence. No replacement figures are inserted from this document. A valid source correction or supported issuer-document ingestion is needed to restore the unavailable observations.

The September 22 follow-up confirmed that Yahoo's separately named `OperatingRevenue` repeated the rejected BAC revenue observation. That exact alias is also withdrawn with `bac-2025q4-operating-revenue`, including from older client caches and sparse merges. BAC's release reports Q4 revenue as net interest income plus noninterest income; it does not support the vendor's 31,180,000,000 observation. Other periods and corrected values are preserved.

O's parent/common income of 296,085,000 and consolidated income of 301,636,000 remain distinct, valid measures. Its pretax income of 323,436,000 and tax expense of 21,800,000 are not withdrawn. Other vendor aliases, adjusted earnings, O's interest/EBITDA definitions and later balance-sheet revisions are separate checks; matching numbers do not establish matching definitions.

The captured Twelve Data O quarter places 301,636,000 in generic `net_income`, which the adapter mapped to parent income. The issuer release identifies that amount as consolidated income before subtracting 5,551,000 attributable to noncontrolling interests. The app withdraws this exact parent-field observation with `o-2025q4-parent-income`; the explicitly consolidated field remains valid. [Twelve Data's standard endpoint documentation](https://twelvedata.com/docs/llms/fundamentals/income-statement.md) defines `net_income` as pretax income minus income tax without a universal parent-attribution guarantee. This bounded repair does not reclassify the generic field for other issuers or switch endpoints.

This is a bounded observation repair, not general revision-safe quarterly reconstruction. Unrecognized source revisions, fiscal intervals, non-additive shareholder allocations and historical data vintages still require their own evidence. Active withdrawals appear through the existing financial-table footer warning; no permanent methodology text is added to the research view.
