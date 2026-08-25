# `deliverableEmails`: what the operator asks for, and who actually gets the email

Investigation only. Nothing in this document is implemented.

The open-order form and the client wizard both collect up to five "deliverable
emails". Nothing reads them. This document answers the question that has to come
first: **if the operator's five addresses are discarded, who has been receiving
our confirmations and documents instead?**

Short answer: one address, plus `openorders@pct.com`. Every outbound email in the
system resolves its recipients from order FKs and party rows, and there is no
code path anywhere — not in the confirmation, not in prelim delivery, not in the
generic outbox — where an operator-supplied address can enter the recipient list
at order-open time.

## The field itself

| | |
| --- | --- |
| Schema | `createOrderInputSchema.deliverableEmails: z.array(z.string().email()).optional()` — `create-order.ts:72` |
| Hub UI | `components/admin/quick-entry/parties-section.tsx:191–198` — add/remove, capped at 5 |
| Client wizard UI | `components/client/new-order/step-add-parties.tsx:63–143`, echoed on review at `step-review.tsx:142` |
| Carried to input | `client-wizard-to-create.ts:97–165`, `use-quick-entry.ts:325` |
| Written to the database | **nowhere** — `createLocalRecords` never references it, and no column exists |
| Sent to SoftPro | **no** — absent from `buildSoftProPayload` |
| Read by any recipient resolver | **no** |

The addresses are validated, displayed back to the operator on the review step,
submitted, and then discarded in memory. There is no record of what anyone ever
typed, so the size of the loss is not measurable — which is itself the finding.

Separately: `companies.deliverableEmails` appears on a UI type at
`app/(admin)/contacts/companies/page.tsx:26`, but the `companies` table has no
such column. The field is always `undefined`. It is not a second, working
implementation of this feature.

## What each resolver actually uses

### 1. Order confirmation — `buildConfirmationRecipients`

`src/lib/domain/notifications/confirmation-recipients.ts`, fed by
`loadRecipientEmails` in `order-confirmation.ts:278–317`.

**TO**, deduped, in this order:

| Candidate | Source |
| --- | --- |
| Client | `orders.client_contact_id` → `contacts.email` |
| Escrow officer | `orders.escrow_officer_id` → `contacts.email` |
| Listing agent | `orders.listing_agent_id` → `contacts.email` (the **FK**, not the party row) |
| Buyer agent | `order_parties` role `buyer_agent` → `contacts.email` ?? `external_email` |

**CC**, deduped and minus anything already in TO:

| Candidate | Source |
| --- | --- |
| Sales rep | `orders.sales_rep_id` → `contacts.email` |
| `openorders@pct.com` | hardcoded constant, always present |
| Extras | `process.env.PCT_INTERNAL_CC_EMAILS`, comma-separated |

If TO ends up empty, `openorders@pct.com` is promoted out of CC into TO so a
confirmation can never have zero recipients. A missing client email does not
block the send; it sets `orders.email_status = 'sent_no_client'` and logs.

Fill rates on the 4,055 active orders, i.e. how often each candidate can resolve
at all:

| Candidate column | Populated |
| --- | --- |
| `sales_rep_id` | 3,952 (97%) |
| `client_contact_id` | 3,469 (86%) |
| `escrow_officer_id` | 1,596 (39%) |
| `listing_agent_id` | 607 (15%) |
| `order_parties` role `buyer_agent` | **0 rows exist in the entire table** |

The buyer-agent TO candidate has never resolved for anyone. The only writer of
that role is the hub create path, and the confirmation reads the FK rather than
the party row for the listing agent, so a listing agent captured on the form does
not become a recipient until an enrichment job populates the FK.

### What our team has actually received

Every confirmation ever logged — 6 orders, 14 `notification_logs` rows, all
`status = 'sent'`:

| File | TO | CC |
| --- | --- | --- |
| 20021378-GLT | `escrow@firstpriorityescrow.com` | `openorders@pct.com` |
| 20021376-OCT | `grace.yu@atlasescrow.us` | `openorders@pct.com` |
| 20020404-GLT | `gerardoh@gmail.com` | `openorders@pct.com` |
| 20020403-GLT | `gerardoh@gmail.com` | `openorders@pct.com` |
| 20015757-GLT | `gerardoh@gmail.com` | `openorders@pct.com`, `ghernandez@pct.com` |
| 20015183-GLT | `teamrose@powerhouseescrow.com` | `openorders@pct.com`, `kgreen@pct.com` |

Every one of them: **exactly one TO address**, which is the client contact, and
`openorders@pct.com` in CC. Maximum TO count across the whole table is 1.

The two orders opened on 24 Aug have no sales rep in CC, and the two from July do.
That is Cause B of the confirmation bug from the other side — `sales_rep_id` was
only ever written by the SoftPro read-back, which runs after the confirmation has
already sent, so the newest hub orders lost the one CC recipient they had.

### 2. Prelim / document delivery — `resolvePrelimRecipients`

`src/lib/domain/notifications/prelim-recipient-resolution.ts:106–219`.

**TO** is a single address, resolved in strict order:

1. `orders.escrow_officer_id` → `contacts.email`
2. otherwise `order_parties` role `escrow_company` → `external_email` ?? joined `contacts.email`
3. otherwise **blocked**, `blockReason: 'No valid primary prelim recipient resolved'`

**CC**: sales rep from `orders.sales_rep_id`, plus ad-hoc addresses passed in.

This is the one place an operator can add a recipient today, and only on a manual
send: the deliver-prelim modal collects CC addresses client-side and posts them,
and `deliver-prelim/route.ts:85–87` deliberately ignores the posted TO and
re-resolves it server-side. Auto-delivery calls `resolvePrelimRecipients(orderId)`
with no ad-hoc argument, so an automatic prelim goes to the escrow officer and the
sales rep and no one else.

`officer_cc_defaults` (`cc_email`) exists as a table and is read by no sending
code — a second, already-built place where standing CC instructions go nowhere.

### 3. Generic outbox notifications — `resolveRecipients`

`src/lib/domain/notifications/recipients.ts`, used by `handleGenericDispatch` for
document-ready, milestone and order-closed events. Recipients come from
`notification_types.recipient_roles` (officer FKs on `orders`, or `order_parties`
roles) plus `notification_types.internal_cc`. One separate email per recipient.

Configuration lives in the database, not in code, so the live role lists for each
slug are not knowable from the repository.

### 4. Party wizard invite

`src/lib/jobs/handlers/party-wizard-invite.ts:174` — TO is `contacts.email` for
`orders.escrow_officer_id`, no CC, no alternative. See
`CREATE_ORDER_DROPPED_FIELDS.md` for why that reaches 18.5% of candidates.

### 5. Everything else

`ops-daily-report.ts` uses `OPS_REPORT_RECIPIENT` (default `ghernandez@pct.com`);
`invite-user/route.ts` uses the invited address; the dev sample sender is
hardcoded. The direct-send handlers in `notifications/service.ts:195–243` are
marked deprecated and are not on the live outbox path — worth knowing before
anyone "fixes" recipients there and sees no change in production.

## The divergence, stated plainly

The operator is offered a field labelled as delivery instructions. What actually
determines delivery is four foreign keys and a hardcoded internal address. The
two have never been connected. Where the FKs are empty — 61% of active orders
have no escrow officer, 85% have no listing agent FK — the confirmation
narrows to the client contact alone, and prelim delivery is blocked outright.

## Proposal — not implemented, needs decisions

The mechanics are small. The product questions are not, so nothing here is built.

1. **Persist the addresses.** A `text[]` column on `orders`, or an
   `order_deliverable_emails` table if we want per-address provenance and an
   audit trail of who added one and when.
2. **Confirmation.** Add them as a candidate list in
   `buildConfirmationRecipients`. Existing dedupe and the `openorders@pct.com`
   guarantee already cover the rest.
3. **Prelim.** Load them in `resolvePrelimRecipients` and merge into CC, which
   also closes the auto-delivery gap and would be the natural place to finally
   read `officer_cc_defaults`.

Open questions, in the order they need answering:

- **TO or CC?** "Deliverable emails" reads like a delivery instruction, which
  argues TO. Treating them as CC is safer and quieter. This changes what the
  recipient sees in the header and cannot be inferred from the code.
- **Which emails?** Confirmation only, or every document that goes out on the
  order for its lifetime? The label implies the latter and the form gives no way
  to scope it.
- **Editable after open?** Today the list would be frozen at create. Order detail
  has no UI for it.
- **Do the existing 7,342 orders get anything?** There is no history to backfill
  from — the addresses were never stored.

Until these are answered, the honest interim fix is to stop implying a promise we
do not keep: either remove the field from both forms or label it as not yet
active. Silently accepting a delivery instruction is worse than not offering one.
