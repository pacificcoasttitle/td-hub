# Pattern: SoftPro is the Source of Truth

## Summary

SoftPro is the canonical operational system. TD Hub mirrors SoftPro; SoftPro does not mirror TD Hub. When there's a conflict, SoftPro wins. When something is missing in our code, look to the legacy PHP system first.

## The principle

PCT has been using SoftPro for years. Their data, their workflows, their integrations are the truth. TD Hub vNext is a new interface on top of that truth.

Translation:

- **Order data:** SoftPro owns. We sync FROM SoftPro, not TO SoftPro (with explicit exceptions like AddNotes and AddDocuments).
- **Contact data:** SoftPro owns. We sync via GetLookUpTable.
- **Status:** SoftPro owns. Status changes flow SoftPro → TD Hub via webhook and sync.
- **Fees, milestones:** SoftPro owns. We display, we don't compute.

## The 95% / 5% rule

95% of orders enter TD Hub through SoftPro sync. They originated in SoftPro.

5% of orders are created via the TD Hub form (`/api/orders/create`) — manually opened by PCT staff or external submitters.

This affects which fields we trust at order creation:
- **softpro_sync orders:** Full enrichment depends on SoftPro returning data
- **manual_entry / web_form orders:** TD Hub captures the data directly at creation; order_parties is populated; client info is known

If the SoftPro sync is broken, only 5% of orders work correctly. We've hit this.

## Legacy code is the spec

The legacy PHP system has been in production for years. When TD Hub vNext needs to do something SoftPro-related, the legacy code shows you what works.

### Pattern: read the legacy code before writing new code

Before writing new SoftPro integration code:

1. Find the legacy equivalent in canon references
2. Read what it does — endpoint, params, error handling
3. Match that behavior exactly in TS
4. If you diverge, document WHY in a comment

### Examples of legacy patterns preserved in TD Hub

**TitlePoint WAF bypass:**
Legacy PHP `curl_post()` sends unencoded body params. URL-encoded POST is blocked by FortiWeb WAF. TD Hub matches this using Node's `https.request` with unencoded bodies.

**SoftPro's "Country" field actually contains county name:**
Legacy code maps `Country` → our county field. This looks wrong but it's correct. Preserved as a comment in the mapper.

**EscrowOfficer comes from GetOrderDetails, not GetOrderContacts:**
Legacy escrow officer parsing pulls from `GetOrderDetails.EscrowOfficer` (a name string), NOT from `GetOrderContacts.EscrowCompanies.PersonLookupCode` (a code). The latter was a bug we shipped briefly before correcting back to legacy behavior.

**Date format quirks:**
SoftPro returns dates in multiple formats. Legacy `parseSoftProDate` handles them. TD Hub uses the same parser.

## Zero deviations rule

When building a new SoftPro integration:

- No improvisation
- No "I think SoftPro should work this way"
- No guessing at field names
- No "let me use modern fetch instead of legacy patterns"

If the legacy code does it, you do it. If the legacy code doesn't do it, find out why before adding it.

## When SoftPro is missing a feature we need

Sometimes SoftPro doesn't expose what we need. Examples:

- No "list all tasks for this order" endpoint (only single-task by ID)
- No "primary contact" / "submitter" field on GetOrderDetails
- No "GetNotes" — we can add notes but can't read SoftPro-added ones

In these cases:

1. **First confirm the gap.** Read the SoftPro API docs carefully. Sometimes the feature exists under an unexpected name.
2. **Document the gap.** Add to project knowledge or a "SoftPro gaps" doc.
3. **Ask the API team.** PCT's API team can add fields/endpoints when justified.
4. **Don't fabricate a workaround that becomes the new "truth."** Anything we compute locally is at best a derivation. If we start treating it as authoritative, we'll diverge from SoftPro over time.

## Pushing back changes TO SoftPro

We push back limited data via specific endpoints:

| TD Hub action | SoftPro endpoint | Notes |
|---------------|------------------|-------|
| Note added in TD Hub | AddNotes | Best-effort sync |
| Document uploaded | AddDocuments | Required for workflow |
| Order created via Hub form | create | Full order package |
| Loan update | updateOrder | Specific field updates |
| Task status change | AddTask | Webhook reactions |

NEVER push:
- Status changes (SoftPro drives status)
- Party assignments (SoftPro drives party data)
- Fees (SoftPro computes fees)
- Marketing rep changes (SoftPro manages staff assignments)

## Anti-patterns

### Anti-pattern: Building features around derived data

If TD Hub computes "client" by inferring from order_parties, then we build the UI around our derived field, then SoftPro adds an authoritative field, we have to migrate the UI. Always design with "what does SoftPro actually have" in mind.

### Anti-pattern: "We'll just store it locally"

When SoftPro doesn't expose data we need, the instinct is to add it to TD Hub as a local field with manual editing. This creates drift — our local data becomes stale or wrong over time.

Better: Ask SoftPro to add it, even if temporary workaround uses derived data.

### Anti-pattern: Two-way sync without conflict resolution

If TD Hub edits something AND SoftPro edits something at the same time, who wins? Without explicit conflict resolution, you get data corruption. Default: one-way sync (SoftPro → TD Hub).

## Real incidents

- **The whole enrichment problem (May 2026):** SoftPro's date-range GetOrderDetails times out. We patched our cron to per-order calls. SoftPro is still the source — we just access it differently.
- **The client column:** SoftPro doesn't return a clean "submitter" field. We're asking the API team to add `MainContact` rather than building elaborate inference.

## Cross-references

- `/docs/claude-skills/patterns/softpro-integration-rules.md`
- `/docs/claude-skills/patterns/backlog-aware-crons.md`
- `/docs/claude-skills/agents/api-specialist.md`
- Project knowledge: `05-softpro.md`, `softpro.md`, `Softpro-API.md`
