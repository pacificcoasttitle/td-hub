import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── The abuse limit on the public page ──────────────────────────────────────
//
// The thing being protected is the only unauthenticated page in TD Hub that
// serves order data, so these tests are written against the two failure
// directions that matter and are not symmetric:
//
//   - Blocking a real party is a lost order and, per the executive, the thing
//     that must not happen. So there is a test that walks the honest pattern —
//     one person opening one forwarded link a dozen times — and asserts nothing
//     is ever refused.
//   - Serving an enumerator is a data leak. So there are tests that the limits
//     bite EXACTLY at their threshold, that a wrong signature is punished
//     harder than a right one, and that a throttled response is not usable as
//     an oracle for whether a token was real.
//
// The store is faked rather than mocked call-by-call: rows accumulate and the
// counters are computed from them, so the tests exercise the guard's real
// sequencing — what it records, when it stops recording, and how the sliding
// window behaves — instead of asserting that a mock was called.

const store: StoredRow[] = [];
const consoleErrorSpy = vi.fn();

interface StoredRow {
  operation: string;
  createdAt: number;
  ipHash: string;
  tokenId: string | null;
  success: boolean | null;
  httpStatus: number | null;
  errorCategory: string | null;
  requestMeta: Record<string, unknown>;
}

/** Set by a test to make the counter read blow up. */
let executeShouldThrow = false;
/** Set by a test to make the counter WRITE blow up. */
let insertShouldThrow = false;

vi.mock('@/lib/db/schema', () => ({ vendorApiLogs: { _: 'vendor_api_logs' } }));

vi.mock('@/lib/domain/settings/service', () => ({
  getSettings: async (keys: string[]) => {
    const out: Record<string, string | null> = {};
    for (const k of keys) out[k] = settingOverrides[k] ?? null;
    return out;
  },
}));

let settingOverrides: Record<string, string> = {};

vi.mock('@/lib/db/client', () => ({
  db: {
    execute: async (statement: unknown) => {
      if (executeShouldThrow) throw new Error('connection terminated unexpectedly');
      return [computeCounters(ipHashFromStatement(statement))];
    },
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        if (insertShouldThrow) throw new Error('could not write');
        const meta = (row.requestMeta ?? {}) as Record<string, unknown>;
        store.push({
          operation: String(row.operation),
          createdAt: Date.now(),
          ipHash: String(meta.ipHash),
          tokenId: (meta.tokenId as string | null) ?? null,
          success: (row.success as boolean | null) ?? null,
          httpStatus: (row.httpStatus as number | null) ?? null,
          errorCategory: (row.errorCategory as string | null) ?? null,
          requestMeta: meta,
        });
      },
    }),
  },
}));

const MOD = await import('./party-wizard-abuse');
const {
  BREADTH_WINDOW_MS, BURST_WINDOW_MS, DEFAULT_DISTINCT_TOKEN_LIMIT, DEFAULT_GET_LIMIT,
  DEFAULT_INVALID_LIMIT, DEFAULT_POST_LIMIT, OP_INVALID_TOKEN, OP_PAGE_VIEW, OP_SUBMIT,
  OP_THROTTLED, PARTY_WIZARD_VENDOR, clientIpFromHeaders, evaluate,
  guardPartyWizardRequest, hashIp, loadAbuseLimits,
} = MOD;

const { mintPartyWizardToken } = await import('./party-wizard-token');

/**
 * Pull the IP hash out of the drizzle statement so the fake store filters the
 * way the real query does.
 *
 * drizzle interpolates primitives into queryChunks as raw values alongside
 * StringChunk objects holding the literal SQL, so the interpolated parameters
 * are the entries that are plain strings. The hash is the only one shaped like
 * 32 hex characters — the others are operation names and the vendor.
 */
function ipHashFromStatement(statement: unknown): string {
  const chunks = (statement as { queryChunks?: unknown[] }).queryChunks ?? [];
  for (const chunk of chunks) {
    if (typeof chunk === 'string' && /^[0-9a-f]{32}$/.test(chunk)) return chunk;
  }
  throw new Error('no ipHash parameter found in statement');
}

/** The same aggregates the real SQL computes, over the faked rows. */
function computeCounters(ipHash: string) {
  const now = Date.now();
  const mine = store.filter((r) => r.ipHash === ipHash);
  const inBurst = (r: StoredRow) => r.createdAt > now - BURST_WINDOW_MS;
  const inBreadth = (r: StoredRow) => r.createdAt > now - BREADTH_WINDOW_MS;

  const pageViewsInBreadth = mine.filter((r) => r.operation === OP_PAGE_VIEW && inBreadth(r));

  return {
    get_attempts: mine.filter((r) => r.operation === OP_PAGE_VIEW && inBurst(r)).length,
    post_attempts: mine.filter((r) => r.operation === OP_SUBMIT && inBurst(r)).length,
    invalid_attempts: mine.filter((r) => r.operation === OP_INVALID_TOKEN && inBreadth(r)).length,
    distinct_tokens: new Set(pageViewsInBreadth.map((r) => r.tokenId)).size,
    recent_block_logs: mine.filter(
      (r) => r.operation === OP_THROTTLED && r.createdAt > now - 60_000,
    ).length,
  };
}

const IP = '203.0.113.44';

function headersWith(ip: string | null) {
  return {
    get: (name: string) => (name === 'x-vercel-forwarded-for' && ip ? ip : null),
  };
}

/** A signature-valid token. Minted in-process; never touches a database. */
function validToken(): string {
  return mintPartyWizardToken().token;
}

function openPage(token: string, ip = IP) {
  return guardPartyWizardRequest({ kind: 'page_view', token, headers: headersWith(ip) });
}

function submit(token: string, ip = IP) {
  return guardPartyWizardRequest({ kind: 'submit', token, headers: headersWith(ip) });
}

const LIMITS = {
  get: DEFAULT_GET_LIMIT,
  post: DEFAULT_POST_LIMIT,
  invalid: DEFAULT_INVALID_LIMIT,
  distinctTokens: DEFAULT_DISTINCT_TOKEN_LIMIT,
};

function counters(over: Partial<ReturnType<typeof zeroCounters>> = {}) {
  return { ...zeroCounters(), ...over };
}

function zeroCounters() {
  return {
    getAttempts: 0, postAttempts: 0, invalidAttempts: 0, distinctTokens: 0, recentBlockLogs: 0,
  };
}

beforeEach(() => {
  store.length = 0;
  settingOverrides = {};
  executeShouldThrow = false;
  insertShouldThrow = false;
  consoleErrorSpy.mockClear();
  vi.spyOn(console, 'error').mockImplementation(consoleErrorSpy);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-26T18:00:00Z'));
  process.env.PARTY_WIZARD_TOKEN_SECRET = 'test-secret-for-abuse-tests';
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── Thresholds, exactly ─────────────────────────────────────────────────────

describe('where each limit bites', () => {
  it('admits the request that reaches one below the page-load limit', () => {
    expect(evaluate({
      kind: 'page_view', signatureValid: true, tokenId: 'a'.repeat(32), limits: LIMITS,
      counters: counters({ getAttempts: DEFAULT_GET_LIMIT - 1, distinctTokens: 1 }),
    })).toBeNull();
  });

  it('refuses at the page-load limit, not before and not after', () => {
    expect(evaluate({
      kind: 'page_view', signatureValid: true, tokenId: 'a'.repeat(32), limits: LIMITS,
      counters: counters({ getAttempts: DEFAULT_GET_LIMIT, distinctTokens: 1 }),
    })).toBe('get');
  });

  it('refuses the submission that reaches the submit limit', () => {
    expect(evaluate({
      kind: 'submit', signatureValid: true, tokenId: 'a'.repeat(32), limits: LIMITS,
      counters: counters({ postAttempts: DEFAULT_POST_LIMIT }),
    })).toBe('post');
    expect(evaluate({
      kind: 'submit', signatureValid: true, tokenId: 'a'.repeat(32), limits: LIMITS,
      counters: counters({ postAttempts: DEFAULT_POST_LIMIT - 1 }),
    })).toBeNull();
  });

  it('refuses the open that reaches the distinct-token limit', () => {
    expect(evaluate({
      kind: 'page_view', signatureValid: true, tokenId: 'a'.repeat(32), limits: LIMITS,
      counters: counters({ distinctTokens: DEFAULT_DISTINCT_TOKEN_LIMIT }),
    })).toBe('distinct_tokens');
    expect(evaluate({
      kind: 'page_view', signatureValid: true, tokenId: 'a'.repeat(32), limits: LIMITS,
      counters: counters({ distinctTokens: DEFAULT_DISTINCT_TOKEN_LIMIT - 1 }),
    })).toBeNull();
  });

  it('holds the submit limit tighter than the page-load limit', () => {
    expect(DEFAULT_POST_LIMIT).toBeLessThan(DEFAULT_GET_LIMIT);
  });

  it('holds the invalid-token limit tighter than the page-load limit', () => {
    expect(DEFAULT_INVALID_LIMIT).toBeLessThan(DEFAULT_GET_LIMIT);
  });

  it('applies a tripped invalid-token budget to valid tokens too', () => {
    // The whole reason for counting bad signatures separately: an IP that has
    // been guessing loses access to real links as well.
    expect(evaluate({
      kind: 'page_view', signatureValid: true, tokenId: 'a'.repeat(32), limits: LIMITS,
      counters: counters({ invalidAttempts: DEFAULT_INVALID_LIMIT, getAttempts: 0, distinctTokens: 0 }),
    })).toBe('invalid');
    expect(evaluate({
      kind: 'submit', signatureValid: true, tokenId: 'a'.repeat(32), limits: LIMITS,
      counters: counters({ invalidAttempts: DEFAULT_INVALID_LIMIT, postAttempts: 0 }),
    })).toBe('invalid');
  });
});

// ─── The honest pattern ──────────────────────────────────────────────────────

describe('a real recipient opening a forwarded link', () => {
  it('is never throttled across a dozen opens of the same link', async () => {
    const token = validToken();

    const verdicts = [];
    for (let i = 0; i < 12; i += 1) {
      verdicts.push(await openPage(token));
      vi.advanceTimersByTime(15_000);
    }

    expect(verdicts.every((v) => v.allowed)).toBe(true);
    expect(verdicts.map((v) => v.outcome)).toEqual(Array(12).fill('allowed'));
    expect(store.filter((r) => r.operation === OP_THROTTLED)).toHaveLength(0);
    expect(store.filter((r) => r.operation === OP_PAGE_VIEW)).toHaveLength(12);
  });

  it('does not accrue breadth from reloading one link', async () => {
    const token = validToken();
    for (let i = 0; i < 20; i += 1) await openPage(token);

    const seen = new Set(store.filter((r) => r.operation === OP_PAGE_VIEW).map((r) => r.tokenId));
    expect(seen.size).toBe(1);
  });

  it('is never throttled when two people share the office IP and then submit', async () => {
    const token = validToken();
    for (let i = 0; i < 8; i += 1) await openPage(token);

    const first = await submit(token);
    const second = await submit(token);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
  });

  it('lets a second office open a different link without tripping breadth', async () => {
    for (let i = 0; i < 3; i += 1) {
      const verdict = await openPage(validToken());
      expect(verdict.allowed).toBe(true);
    }
  });
});

// ─── Enumeration ─────────────────────────────────────────────────────────────

describe('an IP working through links', () => {
  it('throttles the page load that exceeds the burst limit', async () => {
    const token = validToken();
    for (let i = 0; i < DEFAULT_GET_LIMIT; i += 1) {
      const verdict = await openPage(token);
      expect(verdict.allowed).toBe(true);
    }

    const blocked = await openPage(token);
    expect(blocked.allowed).toBe(false);
    expect(blocked.outcome).toBe('throttled');
    expect(blocked.tripped).toBe('get');
    expect(blocked.retryAfterSeconds).toBe(BURST_WINDOW_MS / 1000);
  });

  it('throttles breadth before volume when many distinct links are opened', async () => {
    for (let i = 0; i < DEFAULT_DISTINCT_TOKEN_LIMIT; i += 1) {
      expect((await openPage(validToken())).allowed).toBe(true);
    }

    const blocked = await openPage(validToken());
    expect(blocked.tripped).toBe('distinct_tokens');
    expect(blocked.retryAfterSeconds).toBe(BREADTH_WINDOW_MS / 1000);
  });

  it('throttles submissions from one IP across many links', async () => {
    for (let i = 0; i < DEFAULT_POST_LIMIT; i += 1) {
      expect((await submit(validToken())).allowed).toBe(true);
    }

    const blocked = await submit(validToken());
    expect(blocked.allowed).toBe(false);
    expect(blocked.tripped).toBe('post');
  });

  it('frees exactly one slot as the oldest attempt ages out of the window', async () => {
    // This is what makes it a sliding window rather than a fixed one, and it
    // is the reason the limiter can stop recording once blocked without
    // handing a blocked host a fresh budget every ten minutes.
    const start = Date.now();
    const token = validToken();

    // One admitted attempt per second, at start+0s … start+39s.
    for (let i = 0; i < DEFAULT_GET_LIMIT; i += 1) {
      await openPage(token);
      vi.advanceTimersByTime(1_000);
    }
    expect((await openPage(token)).allowed).toBe(false);

    // Land where the window boundary sits strictly between the first attempt
    // and the second: start+0s has aged out, start+1s has not. Exactly one
    // slot is free.
    vi.setSystemTime(start + BURST_WINDOW_MS + 500);

    expect((await openPage(token)).allowed).toBe(true);
    expect((await openPage(token)).allowed).toBe(false);
  });

  it('stops recording attempts once blocked, so a blocked host cannot inflate the table', async () => {
    const token = validToken();
    for (let i = 0; i < DEFAULT_GET_LIMIT; i += 1) await openPage(token);
    const recordedWhenBlocked = store.filter((r) => r.operation === OP_PAGE_VIEW).length;

    for (let i = 0; i < 50; i += 1) await openPage(token);

    expect(store.filter((r) => r.operation === OP_PAGE_VIEW)).toHaveLength(recordedWhenBlocked);
  });
});

describe('an IP guessing tokens', () => {
  it('is cut off after the invalid-token budget, well short of the page-load budget', async () => {
    for (let i = 0; i < DEFAULT_INVALID_LIMIT; i += 1) {
      const verdict = await openPage(`${'0'.repeat(32)}.AAAAAAAAAAAAAAAA.badsignaturebadsignatu`);
      expect(verdict.allowed).toBe(true);
    }

    const blocked = await openPage(`${'0'.repeat(32)}.AAAAAAAAAAAAAAAA.badsignaturebadsignatu`);
    expect(blocked.allowed).toBe(false);
    expect(blocked.tripped).toBe('invalid');
    expect(DEFAULT_INVALID_LIMIT).toBeLessThan(DEFAULT_GET_LIMIT);
  });

  it('records bad signatures under their own operation, never as a page view', async () => {
    await openPage('not-even-shaped-like-a-token');

    expect(store.map((r) => r.operation)).toEqual([OP_INVALID_TOKEN]);
    expect(store[0].tokenId).toBeNull();
  });

  it('loses access to a real link it happens to hold', async () => {
    for (let i = 0; i < DEFAULT_INVALID_LIMIT; i += 1) {
      await openPage('garbage.token.value');
    }

    const withRealLink = await openPage(validToken());
    expect(withRealLink.allowed).toBe(false);
    expect(withRealLink.tripped).toBe('invalid');
  });

  it('does not spend another IP\'s budget', async () => {
    for (let i = 0; i < DEFAULT_INVALID_LIMIT + 5; i += 1) {
      await openPage('garbage.token.value', '198.51.100.9');
    }

    expect((await openPage(validToken(), IP)).allowed).toBe(true);
  });
});

// ─── Not an oracle ───────────────────────────────────────────────────────────

describe('what a throttled caller can learn', () => {
  it('returns an identical verdict for a real link and a guess', async () => {
    for (let i = 0; i < DEFAULT_INVALID_LIMIT; i += 1) {
      await openPage('garbage.token.value');
    }

    const withReal = await openPage(validToken());
    const withGuess = await openPage('another.garbage.value');

    expect(withReal).toEqual(withGuess);
    expect(withReal.allowed).toBe(false);
  });

  it('returns an identical submit verdict for a real link and a guess', async () => {
    for (let i = 0; i < DEFAULT_POST_LIMIT; i += 1) await submit(validToken());

    const withReal = await submit(validToken());
    const withGuess = await submit(validToken());

    expect(withReal).toEqual(withGuess);
    expect(withReal.tripped).toBe('post');
  });

  it('carries nothing about the order or the token in a block verdict', async () => {
    for (let i = 0; i < DEFAULT_GET_LIMIT; i += 1) await openPage(validToken().replace(/^/, ''));
    const token = validToken();
    const blocked = await openPage(token);

    expect(Object.keys(blocked).sort()).toEqual(
      ['allowed', 'outcome', 'retryAfterSeconds', 'tripped'],
    );
    expect(JSON.stringify(blocked)).not.toContain(token);
  });
});

// ─── Failure modes ───────────────────────────────────────────────────────────

describe('when the counter store is unreachable', () => {
  it('serves the page anyway', async () => {
    executeShouldThrow = true;

    const verdict = await openPage(validToken());

    expect(verdict.allowed).toBe(true);
    expect(verdict.outcome).toBe('store_unavailable');
    expect(verdict.tripped).toBeNull();
  });

  it('serves the submission anyway', async () => {
    executeShouldThrow = true;
    expect((await submit(validToken())).allowed).toBe(true);
  });

  it('logs loudly, naming the fact that it failed open', async () => {
    executeShouldThrow = true;
    await openPage(validToken());

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [message, detail] = consoleErrorSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toContain('FAILING OPEN');
    expect(message).toContain('party-wizard-abuse');
    expect(detail.error).toBe('connection terminated unexpectedly');
    expect(detail.kind).toBe('page_view');
  });

  it('does not fail open merely because the settings table is unreadable', async () => {
    // Settings are tunables, not the counter. Losing them means falling back to
    // the compiled-in numbers, and the limit keeps working.
    const limits = await loadAbuseLimits();
    expect(limits).toEqual(LIMITS);
  });

  it('still serves the page when the counter WRITE fails, and says so', async () => {
    insertShouldThrow = true;

    const verdict = await openPage(validToken());

    expect(verdict.allowed).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toContain('uncounted');
  });
});

describe('when no client IP can be determined', () => {
  it('serves the request rather than blocking everyone', async () => {
    const verdict = await guardPartyWizardRequest({
      kind: 'page_view', token: validToken(), headers: headersWith(null),
    });

    expect(verdict.allowed).toBe(true);
    expect(verdict.outcome).toBe('no_client_ip');
  });

  it('logs that the request went unlimited', async () => {
    await guardPartyWizardRequest({
      kind: 'page_view', token: validToken(), headers: headersWith(null),
    });

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toContain('not rate limited');
  });
});

// ─── Tunables ────────────────────────────────────────────────────────────────

describe('settings-driven limits', () => {
  it('uses a configured limit in place of the default', async () => {
    settingOverrides = { party_wizard_get_limit_per_ip: '3' };
    const token = validToken();

    for (let i = 0; i < 3; i += 1) expect((await openPage(token)).allowed).toBe(true);
    expect((await openPage(token)).allowed).toBe(false);
  });

  it('ignores a zero rather than blacking the page out', async () => {
    settingOverrides = { party_wizard_get_limit_per_ip: '0' };
    expect((await loadAbuseLimits()).get).toBe(DEFAULT_GET_LIMIT);
    expect((await openPage(validToken())).allowed).toBe(true);
  });

  it('ignores a non-numeric value', async () => {
    settingOverrides = { party_wizard_invalid_limit_per_ip: 'off' };
    expect((await loadAbuseLimits()).invalid).toBe(DEFAULT_INVALID_LIMIT);
  });

  it('truncates a fractional value instead of comparing against it', async () => {
    settingOverrides = { party_wizard_post_limit_per_ip: '2.9' };
    expect((await loadAbuseLimits()).post).toBe(2);
  });
});

// ─── What gets written ───────────────────────────────────────────────────────

describe('the row the limiter writes', () => {
  it('lands where the Operations page already looks, tagged as public traffic', async () => {
    const token = validToken();
    await openPage(token);

    expect(store).toHaveLength(1);
    expect(store[0].operation).toBe(OP_PAGE_VIEW);
    expect(store[0].success).toBe(true);
    expect(store[0].httpStatus).toBeNull();
  });

  it('marks a throttle as a failed request with a 429, so the Error filter finds it', async () => {
    const token = validToken();
    for (let i = 0; i < DEFAULT_GET_LIMIT; i += 1) await openPage(token);
    await openPage(token);

    const blocks = store.filter((r) => r.operation === OP_THROTTLED);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].success).toBe(false);
    expect(blocks[0].httpStatus).toBe(429);
    expect(blocks[0].errorCategory).toBe('rate_limited');
    expect(blocks[0].requestMeta.tripped).toBe('get');
  });

  it('writes one throttle row a minute, not one a request', async () => {
    const token = validToken();
    for (let i = 0; i < DEFAULT_GET_LIMIT; i += 1) await openPage(token);

    for (let i = 0; i < 20; i += 1) await openPage(token);
    expect(store.filter((r) => r.operation === OP_THROTTLED)).toHaveLength(1);

    vi.advanceTimersByTime(61_000);
    await openPage(token);
    expect(store.filter((r) => r.operation === OP_THROTTLED)).toHaveLength(2);
  });

  it('stores a hashed identity, never the address itself', async () => {
    await openPage(validToken());

    const meta = JSON.stringify(store[0].requestMeta);
    expect(meta).not.toContain(IP);
    expect(store[0].ipHash).toBe(hashIp(IP));
    expect(store[0].ipHash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('stores the public token id but no part of the token secret', async () => {
    const minted = mintPartyWizardToken();
    await openPage(minted.token);

    expect(store[0].tokenId).toBe(minted.tokenId);
    expect(JSON.stringify(store[0].requestMeta)).not.toContain(minted.token.split('.')[1]);
  });

  it('is filed under a vendor the ops filter can select', () => {
    expect(PARTY_WIZARD_VENDOR).toBe('party_wizard');
  });
});

describe('hashing the caller', () => {
  it('is stable for one address and different for another', () => {
    expect(hashIp('203.0.113.1')).toBe(hashIp('203.0.113.1'));
    expect(hashIp('203.0.113.1')).not.toBe(hashIp('203.0.113.2'));
  });

  it('is salted, so the same address hashes differently under another secret', () => {
    const before = hashIp('203.0.113.1');
    process.env.PARTY_WIZARD_TOKEN_SECRET = 'a-different-secret';
    expect(hashIp('203.0.113.1')).not.toBe(before);
  });
});

describe('finding the caller address', () => {
  it('prefers the platform header over a client-settable one', () => {
    expect(clientIpFromHeaders({
      get: (n) => ({
        'x-vercel-forwarded-for': '203.0.113.7',
        'x-forwarded-for': '10.0.0.1',
        'x-real-ip': '10.0.0.2',
      }[n] ?? null),
    })).toBe('203.0.113.7');
  });

  it('takes the first hop of a forwarded chain', () => {
    expect(clientIpFromHeaders({
      get: (n) => (n === 'x-forwarded-for' ? '203.0.113.7, 70.41.3.18, 150.172.238.178' : null),
    })).toBe('203.0.113.7');
  });

  it('reports no address rather than inventing one', () => {
    expect(clientIpFromHeaders({ get: () => null })).toBeNull();
    expect(clientIpFromHeaders({ get: () => '   ' })).toBeNull();
  });
});
