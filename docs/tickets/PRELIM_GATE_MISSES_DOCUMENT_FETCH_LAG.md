# The Aug 27 prelim gate does not cover a late-fetched document

**Status: measured. Age rule now lives on the live path — see
`PRELIM_AGE_GUARD.md`.** Opened 2026-08-31.
The hole is independent of the T&E prelim backfill that found it.

2026-09-17: Jerry locked a three-day product cutoff (SoftPro date, else
order open date). That is not the paper-over this ticket warned against.
The T&E one-shot still hardcodes `deliver: false`. Live fetch is armed
again behind that age rule.

## Why this is a different lag than the gate measures

The Aug 27 gate (`isBackfilledOrder` / `skipped_backfilled_order`) measures
**ORDER import lag**: `created_at − opened_at > 10d`. A row written long after
its open date is a backfill artifact; mailing its prelim is not news, it is
spam. That is what last week's incident was — recovering 221 never-ingested
orders sent 18 prelim emails to 16 external escrow companies — and the gate
was written for that.

This recovery is **DOCUMENT fetch lag**. A prelim issued in May and fetched by
us in August is not news either — whoever needed it got it from SoftPro at the
time — but the *order* was synced normally (lag ~0). The gate does not fire.

A late-fetched document on a normally-synced order is therefore a real
delivery as far as `maybeAutoDeliverPrelim` is concerned. That is by design of
the Aug 27 comment: "a file we have held since April whose prelim finally
lands in October is a real delivery and must still fire." For a *live* late
prelim that is correct. For a bulk historical ingest it is the next incident.

## Measured against the T&E-without-prelim set (2026-08-31)

| set | would still send |
|---|---:|
| First 50 | **42** |
| All 548 missing a hub prelim | **371** |

The other 177 of 548 are held by the existing order-lag gate. 371 would
proceed. Next person landing documents in bulk on normally-synced orders
will hit this.

## What not to do

Do **not** add a new suppression rule inside `maybeAutoDeliverPrelim` to paper
over a backfill. Getting "already open" / "document is old" wrong there would
silently stop real deliveries. The live `fetch_prelims` / webhook path must
keep `deliver: true`.

A backfill that must not mail anyone should not enter the delivery function
at all: a dedicated one-shot with `deliver: false` hardcoded, not a settings
flag, not a change to `handleFetchPrelims`. See
`src/lib/jobs/handlers/backfill-te-prelims.ts` and the source-slice test
on that file.

## Durable answer (not this ticket)

Provenance recorded at write time — "this ingest is a historical fetch, not
an observation" — rather than inferring either order-lag or document-lag from
timestamps. Same conclusion `orders.opened_at` and the Aug 27 gate already
reached. Until that exists, every bulk document land needs its own
`deliver: false` path.
