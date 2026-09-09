# Features that exist and cannot be reached

**Status:** open — one instance fixed, the sweep not done
**Raised:** 2026-09-10, after the sidebar clipping regression

## The immediate one

`/admin/ops` is a real, working page with **no nav entry anywhere**. It is
reachable only by typing the URL. Found by running every route under
`src/app` against every `href` in the sidebar.

Nothing else is unlinked: 20 routes matched a nav entry both ways. `/contacts`
is an index landing page whose children the sidebar links, and `/client`,
`/sales` and `/hub` are separate surfaces with their own navigation.

`/admin/ops` is now listed in `INTENTIONALLY_UNLINKED` in
`src/components/admin/sidebar-nav.test.ts` — **listed because it is true, not
because it is right.** Give it a nav entry or delete it; either way take it off
that list.

## The pattern

This is the fourth time in a week that a capability existed and could not be
reached:

| What | How long | How it was found |
|---|---|---|
| The contact **edit button**, `opacity-0` until hover | unknown | Aileen asked for a feature that already existed |
| The **unit number** in every SiteX multi-match response | since the integration | reading a logged response, not the types |
| **Mortgage Companies / Mortgage Employees / Companies**, clipped by `max-h-60` | Companies since 2026-05-19, ~4 months | Gerard looked at the sidebar |
| **`/admin/ops`**, no nav entry at all | unknown | the route/nav sweep run while fixing the above |

None were bugs in the feature. Every one of them worked. In each case the
*path to it* was missing, and in each case the thing that found it was a person
noticing, not a check.

The common shape: **we verify that a thing is correct, not that it is
reachable.** A label can be correct, permitted, routed and typed right and
still sit 100px below a clipping boundary. A field can be present in every
vendor response and never read. A button can be rendered and invisible.

## The sweep worth doing

Deliberate, once, rather than one discovery at a time:

1. **Every route against every nav entry**, both directions — now automated in
   `sidebar-nav.test.ts`, so this half is done and will stay done.
2. **Every capability against something that reaches it.** Not automated and
   probably not automatable: for each thing the app can do, name the control
   that invokes it and confirm a person can find that control. Candidates to
   start from — anything behind a hover state, anything gated on a role nobody
   currently holds, anything whose only caller is a job.
3. **Every vendor response field against something that reads it.** The unit
   number was in the payload for the life of the integration. Diff a logged
   response against the fields we actually map, per integration.

Item 2 is the expensive one and the one most likely to find something.

## Related

- `CONDO_UNIT_NEVER_CAPTURED.md` — the SiteX unit number
- `CONTACT_CREATE_MODAL_ROUTING.md` — the hidden edit button
