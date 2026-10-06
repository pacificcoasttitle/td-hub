import { configure } from '@testing-library/dom';

// ─── Why the interactive tests need longer than one second ──────────────────
//
// Imported for its side effect by every *.interactive.test.tsx that drives a
// component doing real async work.
//
// THE DEFAULT IS 1000ms AND THESE TESTS NEED ~500ms OF IT. new-report-modal
// alone fetches /api/concierge/access and /api/reports/access on mount, then
// /api/concierge/reps when the rep field appears, then
// /api/concierge/prepared-for behind a 200ms debounce, then
// /api/concierge/for-property before the gate opens — each a stubbed promise
// plus a React render. In isolation that is 400-600ms. Two times headroom.
//
// On 2026-10-06 one full-suite run failed "opens unticked, and opens unticked
// again after a cancel with it ticked" at 1654ms, while the same file passed
// alone and across six consecutive runs of its directory. 1654ms is the
// signature of a waitFor spending its whole 1000ms and then failing: the
// assertion never became true in time, not because the component was wrong.
//
// IT DOES NOT MASK A DEFECT. A component that never reaches the asserted state
// fails at five seconds exactly as it fails at one; the only thing a longer
// budget buys is tolerance for a machine running 289 test files at once. What a
// short timeout buys is a suite that goes red for reasons unrelated to the code,
// and a red suite that means nothing is how the verify gate sat broken for a
// month.
//
// If a test here starts taking anywhere near five seconds, that is a real
// finding and not a reason to raise this again.
configure({ asyncUtilTimeout: 5_000 });
