# Nothing can be taken off the Reports list

**Status:** open — logged, deliberately not built yet
**Raised:** 2026-09-22, as farming reports became producible from the hub (#185)

## The gap

Every report the hub generates — the three farming reports and the concierge
profile — becomes a permanent row on `/reports`. There is no delete, no
archive and no hide. Someone will upload the wrong file, pick the wrong rep or
the wrong county, and that mistake stays on the list for everyone, as
permanently as a correct report.

It gets more likely now, not less: until #185 only a concierge profile could
be made, and each of those costs a credit, so they were made carefully. A
farming report costs nothing and takes a file and three choices.

## What removal must not do

- **Hide spend.** A concierge profile that cost a credit must still count in
  the spend figures after it is removed from view. Archive, don't delete, for
  anything that spent money.
- **Orphan the delivery log.** `report_deliveries` rows reference the report by
  type and id. A removed report's log must stay readable — "we emailed Maria a
  report that was later withdrawn" is a fact someone will need.
- **Break a link already sent.** Notify rep attaches the PDF rather than
  linking it, so removal cannot break an email. Keep it that way: if a signed
  link is ever used, removal should end it on purpose, not by accident.
- **Be silent.** Who removed it, when, and why, recorded on the row.

## The likely shape

An `archived_at` / `archived_by` / `archived_reason` group on the four report
tables, the list filtering archived rows out by default with a way to show
them, and the Delivery log untouched. Deleting stored objects (dataset CSV,
PDF) is a separate decision with a retention question behind it.

## Why not now

Not urgent: no farming report exists in production yet, and the first one is
being held for a real CSV from the team. But a list that nothing can be taken
off will bite the first time someone makes a mistake on it, and the mistake
will be visible to every operator until this exists.
