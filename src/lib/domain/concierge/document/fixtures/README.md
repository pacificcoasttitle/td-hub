# Document fixtures

Real stored payloads, committed because a synthetic one does not reproduce what
they are here to test (EVIDENCE_RULES.md rule 7).

## `gemma-tax-report.json`

`concierge_profiles.tax_report` for profile 12, **2111 Gemma Ct, Perris** —
the `parseTitlePointTaxReport()` output of a real TitlePoint tax search.

**Why it is committed.** Gemma's page 4 put its footnote alone on an otherwise
blank sheet. The orphan depended on the exact height of that tax content: seven
direct assessments, two of them Mello-Roos districts, plus a rate area, an
assessed bar and two installments. A fixture with three assessments does not
fill the sheet, so it cannot strand anything — mutation testing proved exactly
that, by leaving the "never strands a footnote" test green with the protection
removed.

**What it does not contain.** The normalized report, never the raw payload.
`NormalizedTaxReport` has no field for delinquency, redemption schedules, back
taxes or open prior years, so none of it can be here — see
`titlepoint-tax-report.ts`. The raw response lives in `title_point_data`, which
is where vendor payloads are already governed, and is 111 KB besides.

**What is in it.** The county's own figures for one parcel: valuations, a tax
rate, a rate area, two installment amounts and dates, and the named assessment
districts. No owner, no address, no parcel number.
