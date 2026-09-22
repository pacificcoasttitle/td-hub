# A concierge profile knows its rep by name, not by id

**Status:** open — logged, not built
**Raised:** 2026-09-22, while building the rep's own Reports list

## What a rep sees

`/sales/reports` lists the reports branded to the signed-in rep. It lists
**farming reports only** — Sales Activity, Carrier Route, County Sales —
because those carry `branded_to_contact_id` and the route filters on it.

Concierge profiles do not appear, and at first glance that looks like a
missing column. It is not. `concierge_profiles` already stores
`presenting_rep_name`, `_email`, `_phone` and `_title`: the rep is on the
document, printed in the footer, correct.

What it does not store is **which contact row that rep is**.

## The id exists and is discarded

`resolvePresentingRep()` (`src/lib/domain/concierge/presenting-rep.ts:52`)
resolves the rep from a contact id every time — either the id the New Report
modal sends as `presentingRepContactId`, or `orders.sales_rep_id` when the
profile is generated from an order. It loads that contact, and returns the
name, email, phone and title.

`ingestPayload()` then writes those four strings
(`src/lib/domain/concierge/generate.ts:129`). The id is in hand one line
earlier and goes nowhere.

So a rep's own list cannot include concierge profiles: matching on a name
string against a contact row is the kind of join that works until two people
share a surname.

Accepted as-is for now (Gerard, 2026-09-22). This records the cost of fixing
it, which is smaller than it looked.

## What it would take

1. A nullable `presenting_rep_contact_id` on `concierge_profiles`, written
   from the resolution that already happens. One column, one line.
2. `/api/sales/reports` widens its union to include concierge profiles whose
   `presenting_rep_contact_id` is the caller's contact id.
3. The PDF route needs the matching check. `/api/reports/[type]/[id]/pdf`
   answers a rep asking for someone else's farming report exactly as it
   answers a missing one — 404, never 403, so a rep cannot learn which ids
   exist. Concierge has to do the same or it leaks that.
4. **Backfill is possible here**, unusually: `presenting_rep_email` was copied
   from a contact row, so matching it back is exact rather than a guess. Do it
   as a one-off script and leave unmatched rows null.

No rep picker work is needed — the modal already collects and sends
`presentingRepContactId`.

## Why it is worth doing

The concierge profile is the report a rep is most likely to want in their hand
— it is about one specific property, usually one they are about to walk into,
and their name is already on the front of it. It is the one report they cannot
reach today without asking an operator to send it. The farming reports, which
they *can* reach, are the ones they are least likely to need in a hurry.

Related: [REPORTS_CANNOT_BE_REMOVED.md](REPORTS_CANNOT_BE_REMOVED.md).
