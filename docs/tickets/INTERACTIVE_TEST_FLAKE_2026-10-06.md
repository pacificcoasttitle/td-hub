# A modal interactive test failed once and would not reproduce

**Status: mitigated, cause inferred not proven.** Reopen if it recurs.

## What happened

On 2026-10-06 one full-suite run reported:

```
× opens unticked, and opens unticked again after a cancel with it ticked  1654ms
  Test Files  1 failed | 288 passed (289)
       Tests  1 failed |  2914 passed (2915)
```

`src/components/admin/reports/new-report-modal.interactive.test.tsx`.

It did not reproduce:

- the file alone — passed
- the whole suite again — 289 files / 2915 tests, green
- `src/components/admin/reports/` six consecutive times — 153/153 every time

## What was ruled out

**A leak between cases.** Every listener and timer the components register is
cleaned up and that was checked rather than assumed:

| source | registers | cleanup |
|---|---|---|
| `components/ui/combobox.tsx` | `document.addEventListener('pointerdown')` | removed in the effect's return |
| `components/admin/reports/row-menu.tsx` | same | same |
| `components/hub/split/prepared-for-field.tsx` | 200ms debounce `setTimeout` | `clearTimeout` in the return |
| `rep-combobox.tsx` | fetch on mount | `cancelled` flag |

The file calls `afterEach(cleanup)` and `vi.unstubAllGlobals()` in `beforeEach`,
so the fetch stub does not survive a case.

**A global shared across files.** `vi.stubGlobal` is per-file, and the failure
did not reproduce when the whole directory ran together six times — which is
where cross-file interference inside one worker would show.

## What is suspected

**`waitFor` spending its default 1000ms budget under full-suite parallelism.**

The number is the evidence. That test takes 400–600ms in isolation; the failing
run took **1654ms**, which is what it looks like when a `waitFor` burns its
whole timeout and then fails the assertion.

The modal does a lot of real async work before the gate opens — `/access`,
`/reports/access`, `/concierge/reps`, `/concierge/prepared-for` behind a 200ms
debounce, then `/for-property` — each a stubbed promise plus a React render.
Against a 1000ms default that is roughly two times headroom, and 289 test files
running at once eats it.

## Mitigation

`src/test-support/interactive-timeout.ts` sets `asyncUtilTimeout: 5000`, and is
imported by the five `*.interactive.test.tsx` files that drive async components.

**This does not mask a defect.** A component that never reaches the asserted
state fails at five seconds exactly as it fails at one. The only thing the
larger budget buys is tolerance for a loaded machine. The thing a short timeout
buys is a suite that goes red for reasons unrelated to the code — and a red
suite that means nothing is how the verify gate sat broken for a month
(`AGENTS.md`, "Before you say it is ready").

## If it recurs

The mitigation is wrong and this is a real defect. In order:

1. **Check the duration.** Near 5000ms means the component genuinely never
   settles — a pending promise or a state update that never lands. Fast failure
   means it is not timing at all and this ticket's inference was wrong.
2. **Run with `--no-file-parallelism`.** If it only fails under parallelism and
   not under load, the cause is shared state and the leak audit above missed
   something.
3. **Do not raise the timeout again.** Five seconds is already past anything
   this component should need; a sixth second is folklore.
