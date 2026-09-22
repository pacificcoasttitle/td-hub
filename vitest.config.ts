import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// ─── Why this file caps the worker count ────────────────────────────────────
//
// Left alone, Vitest starts one forked process per core. On a 16-core Windows
// machine that is sixteen Node processes, each re-importing the whole module
// graph from cold, because an isolated fork shares nothing with its siblings.
// The suite is 256 files and only 90 seconds of actual test work, so nearly
// all of that is import cost paid 256 times over.
//
// Measured on 2026-09-22, full suite, nothing else running:
//
//                        16 workers      6 workers
//     wall clock            218.6s          213.0s
//     aggregate import    2,359.2s          667.9s
//     failures                   2               0
//
// CAPPING DOES NOT MAKE IT FASTER. The wall clock is the same either way —
// past six workers they only compete for the same disk and memory, and the
// aggregate import time shows the waste. What capping buys is that the run
// STOPS FAILING.
//
// The two failures at 16 workers were `Test timed out in 5000ms` in tests
// that do no slow work at all — every dependency is mocked. They were starved
// of CPU, not slow, which is why they always passed when run on their own.
//
// It gets worse with load. With a second test run competing — a dev server or
// another agent would do it — the same suite produced five failures AND three
// `[vitest-pool]: Timeout starting forks runner` errors, where a fork never
// finished starting at all. That timeout is WORKER_START_TIMEOUT in Vitest's
// own source, hardcoded at 90s, so there is no knob to raise for it: the only
// fix is to stop starving the workers.
//
// CI has never seen any of this. GitHub runners have far fewer cores, so they
// were already below the threshold that causes it — which is why this was a
// local-only failure for weeks.

// Half the cores, never more than six and never fewer than two. A fixed 6
// would OVERSUBSCRIBE a 2-core CI runner, which is the very problem this is
// meant to fix, pointed the other way.
const WORKERS = Math.max(2, Math.min(6, Math.floor(os.cpus().length / 2)));

export default defineConfig({
  test: {
    environment: 'node',
    maxWorkers: WORKERS,

    // Five seconds is plenty for any test here — they are mocked to the point
    // that the slow ones take milliseconds. It is NOT plenty for a test that
    // spends four of those seconds waiting for a core. Raised deliberately so
    // that a scheduling hiccup is not reported as a failing assertion; a test
    // that genuinely takes fifteen seconds is still a broken test and still
    // fails.
    testTimeout: 15_000,

    // ─── Isolation stays ON, deliberately ──────────────────────────────────
    //
    // Turning it off is the tempting wrong turn. It cuts the suite from 213s
    // to 150s, because a worker then reuses its module registry across files
    // instead of paying the import cost 256 times. It also FAILS 71 TESTS:
    // this suite has real state that leaks between files when they share a
    // process. Those tests pass today only because each file gets a fresh
    // process to itself.
    //
    // That latent coupling is worth fixing on its own terms — see
    // docs/tickets/TESTS_DEPEND_ON_PROCESS_ISOLATION.md. Until then,
    // correctness wins over 60 seconds.
    //
    // `pool: 'threads'` is not an alternative either. It is twice as fast on
    // a 30-file sample and SEGFAULTS on the full suite (exit 139), at 16
    // workers and at 6 alike.
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
