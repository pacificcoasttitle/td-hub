# SiteX response fixtures

Real vendor bytes, so a guard asserts against what SiteX actually sends rather
than against what we believe it sends.

## `multi-match-300-santa-ana.json`

The HTTP 300 for **4572 West 5th Street, Santa Ana, CA 92703** — the response
that produced "SiteX returned HTTP 300" in a red box and was attempted 14 times
in 53 minutes on 2026-10-08. It charged nothing: `creditsCharged` is
`response.ok ? 1 : 0`, and all 14 logged `creditsCharged: 0`.

**It is a condominium.** `UseCodeDescription` is `"Condominium Unit
(Residential)"`, `UnitType` is `"#"` and `UnitNumber` is `"31"` — so SiteX is
offering one candidate per unit for an address typed without one. That is why
`UnitType` is punctuation rather than a word, and why `candidateUnit()` prints
`#31` instead of `# 31`.

### THIS IS NOT THE WHOLE RESPONSE, AND THE MISSING PART IS THE COUNT

Taken from `vendor_api_logs.response_meta->>'body'`, which the feed client
**truncates at 400 characters**. The cut lands mid-`OrderInfo.Completed`, so:

- The one `Location` here is complete and is exactly as the vendor sent it.
- **How many candidates SiteX actually returned is not recoverable** from any
  of the 14 logged rows. It is at least one. A condominium at one street
  address is unlikely to be one, but "unlikely" is not a measurement, and this
  file must not be read as saying the response had a single candidate.
- `Completed` is dropped rather than guessed at.

The reason the count is unknown is the same reason the candidates are now
logged as a structured `candidates` array instead of a clipped body string: a
log that truncates the payload cannot answer questions about the payload.

Confirming the real count needs a live call. A 300 is free, but nothing
guarantees in advance that the next call to this address is a 300 rather than a
billable 200, so it waits for approval.
