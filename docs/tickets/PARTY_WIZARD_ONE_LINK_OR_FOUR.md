# One link with a picker, or four role-scoped links in one email

**Status: PARKED.** Opened 2026-08-31. Nothing in this ticket is being built.
No picker, no new forms, no email change, invite stays off. No PR.

Decider is a business fact from PCT's COO, then Gerard picks. The COO
answer chooses one of the two options below. It does not reopen the
design.

**Blocked either way** on the other three forms existing (`buyer_agent`,
`buyer`, `seller`). Listing agent is the only form today. Do not build a
picker that offers roles with no form behind them.

## The parked question

When an escrow officer needs details from several parties on a file, do
they send **one message to all of them**, or **separate ones**?

| COO fact | We take |
|---|---|
| One group message | **B** — one link, role picker (accept the loss of role-scope) |
| Separate messages | **Four-link** — four role-scoped tokens in **one** email |

Same send count either way: one email per file. Four emails becoming one
is the stated pain. Four-link keeps today's security. B does not.

If B is chosen later, this ticket is the moment and the why: group-forward
is how EOs actually message parties. Someone in six months should find
that here, not rediscover the security loss as a bug.

## What is already true (do not relitigate)

- Invite stays off (`party_wizard_invite_enabled` unset). Eligibility stays
  listing-agent absent. Rolling 3–7 day window is ~75 reachable. Do not
  quote 170. One email per file does not multiply sends to ×4.
- Confirm form + latch already on main (#69). Confirm letters do not send.
  The job stays collect-only; confirm copy is built for review.
- `FORMS` holds `listing_agent` only. `getSubmissionSchema` returns null
  for everything else. A picker that offers `buyer_agent` / `buyer` /
  `seller` now is a dead end.
- Email builder already accepts `roleLinks[]` and renders one forward
  block per entry. Four-link does not need a new email shape.

## Option A is not live

Gerard asked for group-forward and no-four-identity-replay in the same
breath, then withdrew the second half. We did not split the difference.
**B is group-forward.** A (kill the whole link on first submit) was
rejected by that choice. Do not present A as an option.

---

## Option B — one link, role picker

One order-scoped token. Visitor picks a role. That role's form opens.
Prefill is role-scoped **after** the pick, not before.

### What the picker may show

The picker page reveals **nothing** about parties before a role is chosen:
no party names, no counterpart, no confirm prefill. File / property chips
are a separate call; party data is not.

Choosing a role opens that role's form only.

### Close per role, not per link

Once a role is submitted, that role is **CLOSED** on that link via
`party_submissions` (already keyed order+role). Other roles stay open so
a group forward can finish.

`used_at` is a milestone, not a lock. Schema comment already says so:
first successful submission, resume stays open. Do not reuse it as
"this URL is spent."

### Claim audit

Record which role each visitor claimed, and when. Possession of the URL
is not identity; the claim log is what we have.

### Token — HMAC does not change

HMAC stays `tokenId.secretHalf`. Role is **not** in the HMAC today.
Role-scope today is a DB property (one `party_wizard_links` row, one
role). Two-stage verify is HMAC, then row state
(`party-wizard-token.ts` then `resolvePartyWizardLink`).

B makes the row **order-scoped**. The same two-stage verify survives.
Do not put role in the HMAC to "fix" B — picking is free either way.

### What we lose (verbatim — do not paraphrase)

Role-scope was the security property. A picker does not restore it. Picker-with-no-reveal helps until they pick. Picking is free. A listing agent with that URL can open Buyer *before* anyone submits buyer, and then see the name we hold — including a wrong SiteX name. Email-match at the picker cannot cover buyer or seller: those roles have **zero** emails in this window.

That is the cost of group-forward. If we take B, the sentence above is
why, recorded on 2026-08-31.

The RPA path does not change that cost. It changes **who sees the
picker**. Only people arriving via a forward ever see it — the escrow
officer who uploads never does. That may reduce how much the picker's
loss of role-scope actually costs us. Frame and latch live in
`RPA_UPLOAD_COMPLEMENTS_WIZARD.md`. This ticket stays the parked COO
question.

---

## Four-link — one email, four role-scoped tokens

Four tokens, one email. Builder already takes `roleLinks[]`. Same send
count as today (one email). If the EO forwards separately, that is four
forwards from them, not four sends from us.

Keeps today's security: possession of the listing-agent token ≠ see or
edit buyer.

Each URL is still one row, one role. HMAC is still `tokenId.secretHalf`.
Row still gates role. A listing agent who is forwarded the listing-agent
block cannot open Buyer.

### What the email looks like

Shipped copy in `party-wizard-email.ts`. Confirm letters do not send;
both axes are shown because the builder already has them. File numbers
and names below are the same fixtures the email tests use.

**Collect, internal** (what the job would send):

- Subject: `Missing listing agent and buyer agent and buyer and seller details — file 20020625-OCT`
- Badge: Action required
- Ask: *We do not have the listing agent and buyer agent and buyer and seller details for this file, so we cannot contact them directly. Please forward the secure links below.*
- Consequence: *This is the only reminder we send for this file. Until the listing agent and buyer agent and buyer and seller details are on the order we have no way to contact them ourselves, so anything they need keeps coming back to you.*

**Collect, external** (outside escrow firm; domain-selected, not lookup-selected):

- Subject: `Pacific Coast Title — listing agent and buyer agent and buyer and seller details needed on file 20020625-OCT`
- Badge: Request
- Ask: *Pacific Coast Title is handling the title work on this file, which you are holding escrow on. We do not have the listing agent and buyer agent and buyer and seller details, so we cannot contact them directly. If you have them, please forward the secure links below.*
- Consequence ends: *the order stays incomplete on our end.*
- Disregard: *If this file is not one of yours, please disregard this message — no reply is needed and we will not follow up.*

**Confirm, internal** (built, not sent):

- Subject: `Please confirm listing agent and buyer agent and buyer and seller details — file 20020625-OCT`
- Ask: *We have listing agent and buyer agent and buyer and seller details on file for this order. Please forward the secure links below so they can confirm or correct them.*
- Consequence: *This is the only reminder we send for this file. Until they confirm, the names we have stay on the file, so anything they need keeps coming back to you.*

**Confirm, external** (built, not sent):

- Subject: `Pacific Coast Title — please confirm listing agent and buyer agent and buyer and seller details on file 20020625-OCT`
- Ask: *Pacific Coast Title is handling the title work on this file, which you are holding escrow on. We have listing agent and buyer agent and buyer and seller details on file. If this is your file, please forward the secure links below so they can confirm or correct what we have.*
- Consequence: *…the names we have stay on the file.* (no "coming back to you")
- Same disregard line as collect-external.

Plain-text body already emits one labeled block per `roleLinks[]` entry.
Four-link is four of those, not a new template:

```
FORWARD THIS TO THE LISTING AGENT:
https://hub.pctitle.com/party-wizard/<listing_agent token>

FORWARD THIS TO THE BUYER AGENT:
https://hub.pctitle.com/party-wizard/<buyer_agent token>

FORWARD THIS TO THE BUYER:
https://hub.pctitle.com/party-wizard/<buyer token>

FORWARD THIS TO THE SELLER:
https://hub.pctitle.com/party-wizard/<seller token>
```

HTML is the same four orange blocks the builder already renders: "Forward
this to the …", then the role CTA (`Listing agent — enter details` on
collect, `Listing agent — confirm details` on confirm), then the raw URL
under the button. Each URL is that role's token. 60-day expiry copy is
already in the block.

---

## After the COO answer

1. Build the three missing forms. Neither option ships without them.
2. Then either B (picker on one order-scoped link) or four-link (mint
   four role-scoped rows, pass all four into `roleLinks[]`).
3. Invite still off until a separate enable decision.

Do not start the picker, do not change the email, do not flip the flag
from this ticket.
