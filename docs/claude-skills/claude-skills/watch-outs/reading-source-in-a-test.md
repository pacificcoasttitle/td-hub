# Watch-Out: Reading Source In A Test — Right Twice, Wrong Four Times

## The distinction

A test can read a module's own source text instead of running it. Same
technique, two opposite verdicts, and which one applies is decided by **what
kind of claim you are making**:

| The claim | Verdict | Why |
| --- | --- | --- |
| "The UI says X" | **Never slice** | Render it. A comment can contain X. A bad slice returns `''`, and `''.includes(X)` is false, so a "does not contain" test passes while asserting nothing. |
| "This module does not IMPORT Y" | **Slice** | There is no runtime state that shows an import is absent. Executing the module proves it did not *call* Y today, not that it *cannot*. |
| "This function takes no parameter that could do Y" | **Slice** | A rendered or executed test can only exercise parameters that exist. It cannot demonstrate the absence of one. |

The rule underneath: **run the code to prove behaviour; read the source to
prove the absence of a capability.** Behaviour is observable at runtime.
Absence of a capability is not.

## Real Incident A — four vacuous checks, 2026-08-26

Source-slicing was used to assert UI strings in `documents-panel.test.tsx`, and
failed silently four times:

1. A numeric shortcut made `"31195 EMERY CT"` and `"31195 Emery City"` compare
   equal.
2. `expect(r.secondary).not.toBeNull()` passed while hiding a wrong surname.
3. A map keyed without `is_primary` made a real party look dropped — a finding
   that had to be publicly retracted.
4. A slice between `"None on file"` and a function name ran **backwards**,
   because the phrase also appeared in the comment above the code. It returned
   `''`, and every `not.toContain` assertion against `''` passed.

The verdict then: *"four vacuous checks of the same kind means the technique is
wrong, not the anchors."* The tests were converted to render the component with
`renderToStaticMarkup` and assert on visible text.

**The conversion immediately caught a real error** that source-counting had
missed: the Preliminary Report tile says "Find", not "Generate" — you do not
generate a prelim, you look for one.

## Real Incident B — the same technique, correctly, 2026-08-28

`deliverable-emails.ts` exists to guarantee that a send path cannot take a
recipient from a request payload. The guarantee is structural: the loader takes
an order id and nothing else.

```ts
it('the send loader takes an order id and nothing else', () => {
  const sig = src.match(/export async function deliverableEmailsForSend\(([^)]*)\)/);
  expect(sig![1].replace(/\s+/g, ' ').trim()).toBe('orderId: number');
});
```

**A rendered or executed test cannot make this claim.** Calling the function
with an order id proves it works with an order id. It says nothing about
whether a second parameter exists that a future caller could pass an address
to. The absence of that parameter is a fact about the source, so the test reads
the source.

Two more of the same shape, both correct:

- `render.test.ts` asserts the concierge render path imports nothing from
  `integrations/sitex` — proving it *cannot* spend a credit, not merely that it
  did not on this run.
- `routes.test.ts` asserts the free routes do not import the generator.

## How to tell which you are doing

Ask: **could this test fail if the code were correct, and pass if it were
broken?**

- "The panel says 'Not received'" — a slice can pass on an empty string, and
  can match a comment. It fails both directions. Render it.
- "This function has one parameter" — running it cannot show a second parameter
  is absent. Slicing is the only instrument.

And when slicing, the guard the four vacuous checks lacked:

```ts
if (text.length === 0) throw new Error('component rendered no visible text');
```

**A slice that produces nothing must fail loudly, never satisfy a negative
assertion.** That single line is what turns the fourth failure above from
invisible into obvious.

## The rule

Run it to prove what the code **does**. Read it to prove what the code
**cannot do**.

If you are slicing for a string a human is meant to read, you are on the wrong
side of that line.
