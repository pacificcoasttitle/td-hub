# The unit was never captured, and the legal-vesting search ran on the building

Reported by the open order team: searching `16281 Castello Lane, Fontana CA 92336`
gives a list of identical rows with no way to tell the units apart.

## What the operator sees

```
0239-145-36-0000   16281 CASTELLO LN
0239-145-37-0000   16281 CASTELLO LN
0239-145-38-0000   16281 CASTELLO LN
0239-145-39-0000   16281 CASTELLO LN
0239-145-40-0000   16281 CASTELLO LN
0239-145-41-0000   16281 CASTELLO LN   …
```

Verbatim from `vendor_api_logs`. It was searched four times in six minutes on
2026-09-08 — someone retrying and getting the same unusable list each time.

## Cause

SiteX returns `UnitNumber` and `UnitType` on every candidate. `mapLocations`
dropped both. The data never reached the screen, so this was never a rendering
problem.

Confirmed from the vendor's own OpenAPI — free, non-billable, at
`GET /realestatedata/search/schema/{feedId}`:

```
Location { FIPS, APN, Address, City, State, ZIP, ZIP4,
           UnitType, UnitNumber, Latitude, Longitude,
           UseCode, UseCodeDescription }
```

**Our logs could not have answered this.** `mapLocations` narrows each candidate
before `logRequest` writes it, so the log records our shape, not SiteX's — the
unit was absent from the log for the same reason it was absent from the screen.
Reading the log would only have confirmed what we already kept.

## Three defects, one parse

**1. The unit is discarded.** Fixed: `mapLocations` keeps `UnitNumber`,
`UnitType` and `FIPS`, and the picker shows the unit so the six rows separate.

**2. The zip has always been empty.** We read `loc.Zip`; the field is `ZIP`.
The old spelling matched nothing, which is why every candidate ever logged
carries `"zip": ""` — visible in the Castello and Lake Arrowhead responses and
never questioned. `Zip` is kept as a fallback.

**3. Picking a candidate has never resolved.** `handlePickLocation` sent
`county: ''`, so no FIPS could be derived, so the lookup could not succeed and
every pick fell through to the stub branch — no county, no owner, no legal
description. Fixed by sending the candidate's own `Location.FIPS`.

### Does defect 3 explain the orders with no address and no documents?

**No.** Measured: **zero** hub-created orders currently have an empty county,
against 112 multi-match searches on record.

The reason is that the stub only degrades the *prefill*. `create-order` re-derives
the county from its own SiteX lookup —
`input.property.county ?? sitexData?.county ?? ''` — so a null county from the
picker gets filled in before the property row is written. The cost of defect 3
is a worse form for the operator, not a missing document.

## The part nobody reported

`buildLegacyLvParameters` has always had a `unitInfo` slot and **nothing ever
filled it** — four references, all inside `params.ts`. So the legal-vesting
search ran on the address alone, which on a condo resolves to the building.

Confirmed on a real logged request, order 8162, a Condominium Unit:

```
Address1      = 2570 Rudder Avenue
LvLookupValue = 2570 Rudder Avenue, Port Hueneme
```

Nothing between the comma and the city. **The legal description that came back
is the building's, not the unit's** — wrong on a prelim, and it does not look
like an error, which is why no one reported it.

`lvUnitInfo` now supplies it. The value is passed through unchanged **because
that is what legacy does**; an earlier draft added `#` to bare numbers, which
was an invention. Matching legacy is not confirmation from TitlePoint, and is
not claimed to be — if a condo search still returns the building's legal
description, the spelling is the first thing to change.

## Scope

605 condo properties, but **604 are `softpro_sync`** — legacy's, with the unit
already inline in the address. Exactly one is hub-created. So the realised
damage today is about one order; the exposure is forward, growing with hub
volume.

## Not done

No historical repair. No re-run of any existing search.
