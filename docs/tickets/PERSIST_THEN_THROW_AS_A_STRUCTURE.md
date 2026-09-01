# Making persist-then-throw structural, not remembered

**Status: DESIGN. Not built. Decide before anyone writes the tenth vendor
call.**
Opened: 2026-09-01

## The shape

Safe sites persist the body, then throw. Unsafe sites read a body straight into
a thrown string:

```ts
// unsafe — the body exists only inside this string, truncated
throw new Error(`Vendor failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
```

Three of these have now been fixed by hand (`westcor/payloads.ts` twice,
`fnf/auth.ts` twice). Every fix was three lines. **That is the problem**: it is
cheap to fix and cheaper to forget, and the cost only appears months later when
somebody needs the body that was thrown away. Orders 48, 49 and 6142 were
unrecoverable through the UI for five months for exactly this reason.

Convention will not hold it. There are 40 `throw new Error` sites in
`src/lib/integrations` today and the count only goes up.

## Three options

### A. A helper that takes the response and returns the error

```ts
const err = await vendorFailure(res, { vendor, operation, orderId, requestId });
throw err;   // body already persisted; err carries diagnostics
```

- **Pro:** one call site, impossible to use wrongly, works today with no
  tooling. Persisting happens inside, so forgetting is not an available move
  once you have reached for the helper.
- **Con:** *reaching for it* is still voluntary. Nothing stops the eleventh
  integration from writing `throw new Error(await res.text())`.
- **Effort:** small. This is close to what `westcorOrderError` already is,
  generalised across vendors.

### B. A lint rule

`no-restricted-syntax` banning a template literal containing an awaited
`res.text()` / `res.json()` inside a `throw`, plus a ban on `.slice(` applied to
a response body inside a throw.

- **Pro:** catches the unsafe shape at authoring time, in CI, for code nobody
  has reviewed yet. It is the only option that makes the bad version *hard to
  write* rather than *easy to avoid*.
- **Con:** syntactic. It catches the literal pattern and misses
  `const msg = text.slice(0,300); throw new Error(msg)`. Rules that are easy to
  sidestep teach people to sidestep them.
- **Effort:** small, but needs care to avoid false positives on
  non-vendor throws.

### C. A shared fetch wrapper that owns the whole exchange

```ts
const result = await vendorFetch({ vendor, operation, orderId }, url, init);
// logs request AND response, always, then returns a discriminated union
```

Nobody touches `res.text()`. There is no body to discard because callers never
hold one — the same move as `deliverableEmailsForSend(orderId)`, where the
unsafe call is not expressible rather than merely discouraged.

- **Pro:** the only structural fix. It also removes the duplicated logging in
  every client, and would have made the FNF/Westcor asymmetry impossible: FNF's
  SOAP client logs the full body and Westcor's did not, purely because two
  people wrote them.
- **Con:** the largest change, and it has to accommodate real differences —
  SOAP vs REST, base64 documents that must not be logged whole, per-vendor
  error categories, streaming. A wrapper that cannot express those gets
  bypassed, and a bypassed wrapper is worse than none because it looks like
  coverage.
- **Effort:** significant. Touches every integration.

## Recommendation

**A now, B alongside it, C only if it earns its way in.**

A is worth doing on its own merits and takes an afternoon. B raises the cost of
the unsafe shape without pretending to eliminate it, and — importantly — its
failure mode is a false negative, not a false positive, so it never blocks
legitimate work.

C is the right *end state* and the wrong *next step*. The honest reason: we do
not yet know what the wrapper needs to express. Three data points across two
vendors is not enough to design an abstraction every future integration must
fit through, and the failure mode of getting it wrong — a wrapper people route
around — is worse than the problem. Do A and B, let the next two integrations
use them, and revisit C when the shape of the exceptions is known rather than
guessed.

That is the same reasoning that kept `LegalNameIndicator` unchanged: build on
what has been measured, not on what is plausible.

## What A should guarantee

1. **The full body is persisted before the error is constructed** — not after,
   not by the caller.
2. **The error carries the body** in `diagnostics`, so a caller that logs the
   exception gets it too.
3. **Truncation is bounded and declared** — store the length and a truncated
   flag, never a silent cut. See `RAW_BODY_LIMIT` / `SOAP_LOG_LIMIT`, both
   64 KB, both recording `*Bytes` and `*Truncated`.
4. **Documents are stripped, not the message** — the reason the FNF cap existed
   was base64 PDFs in the envelope. Strip the blob, keep the fault.
5. **Vendor-specific extraction is a callback**, not a special case inside the
   helper — Westcor's `tvid` is the only one today and there will be others.

## Related

- `docs/tickets/THROWING_ON_A_VENDOR_ERROR_DISCARDS_THE_BODY.md` — the survey
  that found the sites.
- `docs/tickets/WESTCOR_PARTIAL_CREATE_STRANDS_THE_ORDER.md` — what the
  discarded body cost.
- `src/lib/domain/notifications/deliverable-emails.ts` — the precedent for
  option C's reasoning: the unsafe call made unrepresentable rather than
  discouraged.
