# Where else do we throw on a vendor error and discard the body?

**Status: SURVEY. Nothing fixed here beyond the Westcor site already
addressed.**
Opened: 2026-09-01
Prompted by: the Westcor partial-create bug, where a 200 carried both the
`tvid` and the error and we kept only the error.

## The pattern

A vendor answers with a body that contains **both** an error and state it just
created. We read the error, throw, and the body goes out of scope. Later,
something needs that state and the only copy was in the exception we discarded.

Order 6142 cost an evening to diagnose for exactly this reason, and orders 48,
49 and 6142 were unrecoverable through the UI because of it.

## Method

Every `throw new Error` in `src/lib` with a parsed response body in scope
above it, checked for whether anything persists that body first. **The
automated pass reported 7 sites; on inspection 4 were false positives.** That
gap is itself worth recording — the heuristic used a 12-line window and FNF
logs its bodies further up.

## Result: 9 throw sites with a parsed body, 3 genuine gaps

### SAFE — the body is persisted before the throw (4 sites)

`fnf/soap.ts:274, 288, 340, 355`

All four call `logSoapExchange({ ..., responseBody })` with the **complete**
XML before throwing, on both the HTTP-error and parse-failure paths. The FNF
SOAP client is the model the others should follow: it logs the full envelope
and the full response, then throws.

One caveat, not a gap: `logSoapExchange` truncates to 1,000 characters at the
storage boundary (`soap.ts:31`). Deliberate — CPL PDFs arrive base64 in the
same envelope — but it means a fault whose detail sits past 1,000 characters is
still lost. Worth knowing before relying on it in an incident.

### REAL, LOW STAKES — token responses (2 sites)

`fnf/auth.ts:77` and `fnf/auth.ts:135`

```ts
const data = await res.json() as { jwtToken: string; expiresAt: string };
const token = data.jwtToken;
if (!token) throw new Error('FNF returned empty vendor token (no jwtToken field)');
```

`logAuthRequest` runs on the `!res.ok` path but **not** on this one. A 200
whose body lacks the expected field — an error object, a renamed field, a
changed envelope — throws with nothing kept. We would know only that the token
was "empty", never what FNF actually said.

No created state is lost, so this is a diagnosability gap rather than a data
one. It is the cheapest of the three to close.

### REAL, HIGH STAKES — the sibling of the bug we just fixed (1 site)

`westcor/payloads.ts:496`, in `createOrUpdateOrder`:

```ts
if (!res.ok) {
  const text = await res.text().catch(() => '');
  throw new Error(`Westcor order update failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
}
```

**This is the same function, one branch over, from the bug fixed in
`dd3ac9f`.** That fix covers the 200-with-`messages.error` path. This branch —
a non-200 — still reads the body, truncates it into a message, and keeps
nothing.

It is the branch that produced:

```
HTTP 500 — Exception Errors Occurred: Agent Number - Order Number Must be Unique. |
```

**Does a Westcor 500 carry a tvid?** Unknown, and unknowable from what we
stored — which is the entire point. If it does, orders can still strand through
this branch after the fix.

## A second, quieter form: truncation into a message

Distinct from discarding, and easy to mistake for safety. A body is read,
sliced to 200–500 characters, and put in an error string that is not stored:

- `westcor/payloads.ts:496, 771` — `slice(0, 300)` into the message.
- `fnf/soap.ts:274, 340` — same, but the full body was already logged, so the
  truncation is cosmetic.
- `managers-report/client.ts:64-65` — logs `slice(0, 500)` to `responseMeta`
  **and** puts `slice(0, 200)` in the message. Persists, so it is safe.

Westcor's `generateCplPdf` (line 769, 781) does keep `diagnostics.rawResponse =
text.slice(0, 500)`, and those diagnostics reach the failure log — which is why
CPL PDF failures have historically been easier to read than Step A failures.

## What this suggests, without proposing it

The safe sites share one shape: **persist first, throw second.** The unsafe
ones read the body directly into a thrown string. A rule of "no vendor body may
be read except through a function that stores it" would make the difference
structural rather than remembered, in the same way `deliverableEmailsForSend`
takes an order id and nothing else.

Not proposed here. Reported, per the ask.

## Related

- `docs/tickets/WESTCOR_PARTIAL_CREATE_STRANDS_THE_ORDER.md` — the case that
  started this.
- `docs/claude-skills/claude-skills/watch-outs/` — the same evening produced two
  errors from reasoning about a payload instead of reading the source.
