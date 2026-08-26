# Concierge operator UI needs its own gate

**For whoever builds the concierge operator UI. Read before merging that branch.**

Opened: 2026-08-26, when `feat/concierge-profile` landed in main.

## The thing to know

`SITEX_CONCIERGE_FEED_ID` **is already set in Vercel** — Preview and Production, added
2026-08-24.

There was an assumption in flight that it was unset, and that `getConciergeFeedId()`
throwing on a missing value would keep concierge generation inert until the UI was ready.
**That guard does not exist.** The value is there; the function returns it.

Today that costs nothing, because nothing calls it: the merged branch ships no UI, and its
only route (`/api/admin/concierge/usage`) sums stored credits and never generates.

**The moment an operator UI merges, concierge generation is live in Production.** No
further configuration stands between a button and a billable SiteX call.

## What the UI branch must carry

A deliberate gate of its own — **not** the absence of a config value:

- a feature flag, or
- a role restriction narrower than the route's current
  `super_admin, admin, cs_admin`, or
- both

Whichever is chosen, it should be something a reviewer can see in the diff. "It can't run
because an env var is missing" was true once, is not true now, and was never visible in
code.

## Why this matters more than usual here

Each generation spends a real SiteX credit against a production balance whose endpoint
returns `2147483647` — a sentinel, not a number — so **the vendor API cannot tell us how
much we have left**. Self-metering from `concierge_profiles.sitex_credits_charged` is the
only spend signal that exists.

An accidentally-live Generate button is not a cosmetic bug; it is unmetered spend against
a balance nobody can read.

## Not to be done here

Do not remove the env var to restore the accidental guard. It was reviewed and left in
place deliberately. The gate belongs in the UI branch, in code.
