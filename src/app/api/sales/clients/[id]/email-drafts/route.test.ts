import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSessionMock, getEmailDraftContextMock, checkRateLimitMock,
  recordCallMock, messagesCreateMock, getClientMock, calls,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getEmailDraftContextMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  recordCallMock: vi.fn(async () => undefined),
  messagesCreateMock: vi.fn(),
  getClientMock: vi.fn(),
  calls: { order: [] as string[] },
}));

class FakeCrmAccessError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

vi.mock('@/lib/security/auth', () => ({ getSession: getSessionMock }));

vi.mock('@/lib/domain/crm/clients', () => ({
  CrmAccessError: FakeCrmAccessError,
  getEmailDraftContext: (...a: unknown[]) => {
    calls.order.push('auth');
    return getEmailDraftContextMock(...a);
  },
}));

vi.mock('@/lib/integrations/anthropic/rate-limit', () => ({
  checkDraftRateLimit: (...a: unknown[]) => {
    calls.order.push('rateLimit');
    return checkRateLimitMock(...a);
  },
  recordDraftCall: recordCallMock,
}));

vi.mock('@/lib/integrations/anthropic/client', () => {
  class AnthropicNotConfiguredError extends Error {}
  return {
    AnthropicNotConfiguredError,
    DRAFT_MODEL: 'claude-opus-5',
    getAnthropicClient: () => {
      calls.order.push('anthropic');
      return getClientMock();
    },
  };
});

const { POST } = await import('./route');

const OWNER_CONTEXT = {
  client: { id: 7, name: 'Paul Rivera', company: 'Escrow Forum', type: 'escrow', email: 'p@x.com' },
  metrics: {
    unlinked: false,
    counts: { thisMonth: 0, last90: 2, prior90: 3, same90LastYear: 0, open: 0, total: 40 },
    recency: { lastOrderAt: new Date(), daysSinceLastOrder: 41, firstOrderAt: new Date() },
    rate: { avgMonthlyOrders: 6, monthsObserved: 12 },
    trend: { direction: 'down', changePct: -0.33, basis: 'b', confidence: 'high' },
  },
  signal: { kind: 'quiet', tone: 'warning', label: 'Quiet 41 days', detail: 'usually ~6/mo' },
  notes: [],
  repName: 'Angeline Ahn',
};

function req() { return {} as never; }
function params(id = '7') { return { params: Promise.resolve({ id }) }; }

beforeEach(() => {
  calls.order.length = 0;
  getSessionMock.mockReset();
  getEmailDraftContextMock.mockReset();
  checkRateLimitMock.mockReset();
  recordCallMock.mockClear();
  messagesCreateMock.mockReset();
  getClientMock.mockReset();

  getSessionMock.mockResolvedValue({ id: 'rep-1', role: 'sales_rep', displayName: 'Angeline Ahn' });
  getEmailDraftContextMock.mockResolvedValue(OWNER_CONTEXT);
  checkRateLimitMock.mockResolvedValue({ allowed: true, used: 0, limit: 20, retryAfterSeconds: 3600 });
  getClientMock.mockReturnValue({ messages: { create: messagesCreateMock } });
  messagesCreateMock.mockResolvedValue({
    stop_reason: 'end_turn',
    content: [{
      type: 'text',
      text: JSON.stringify({
        drafts: [{ intent: 're_engage', subject: 'Checking in', body: 'Hi Paul,\n\nAngeline' }],
      }),
    }],
    usage: { input_tokens: 900, output_tokens: 220 },
  });
});

// ─── Auth gate ─────────────────────────────────────────────────────────────

describe('auth gate — owner only', () => {
  it('401s an unauthenticated caller without spending anything', async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await POST(req(), params());
    expect(res.status).toBe(401);
    expect(calls.order).not.toContain('anthropic');
    expect(recordCallMock).not.toHaveBeenCalled();
  });

  it('404s when the client is not visible to this rep', async () => {
    getEmailDraftContextMock.mockRejectedValue(new FakeCrmAccessError('Not found', 404));
    const res = await POST(req(), params());
    expect(res.status).toBe(404);
    expect(calls.order).not.toContain('anthropic');
  });

  it('403s a manager who can SEE the client but does not own it', async () => {
    getEmailDraftContextMock.mockRejectedValue(
      new FakeCrmAccessError('Read-only access — only the list owner can make changes', 403),
    );
    const res = await POST(req(), params());
    expect(res.status).toBe(403);
    // The decisive property: a non-owner never reaches the paid call.
    expect(calls.order).not.toContain('anthropic');
    expect(recordCallMock).not.toHaveBeenCalled();
  });

  it('404s a malformed id before touching the database', async () => {
    const res = await POST(req(), params('not-a-number'));
    expect(res.status).toBe(404);
    expect(calls.order).toEqual([]);
  });

  it('checks ownership BEFORE the rate limit or the API call', async () => {
    await POST(req(), params());
    expect(calls.order[0]).toBe('auth');
    expect(calls.order.indexOf('rateLimit')).toBeLessThan(calls.order.indexOf('anthropic'));
  });
});

// ─── Rate limit ────────────────────────────────────────────────────────────

describe('rate limit — the credit-burn door', () => {
  it('429s once the rep is over budget and never calls Anthropic', async () => {
    checkRateLimitMock.mockResolvedValue({
      allowed: false, used: 20, limit: 20, retryAfterSeconds: 3600,
    });
    const res = await POST(req(), params());
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('3600');
    expect(calls.order).not.toContain('anthropic');
    await expect(res.json()).resolves.toMatchObject({ rateLimited: true });
  });

  it('is keyed to the calling rep, not the client', async () => {
    await POST(req(), params());
    expect(checkRateLimitMock).toHaveBeenCalledWith('rep-1');
  });

  it('records every attempt, so the counter reflects real spend', async () => {
    await POST(req(), params());
    expect(recordCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: 'rep-1', clientId: 7, success: true }),
    );
  });
});

// ─── Generation ────────────────────────────────────────────────────────────

describe('generation', () => {
  it('returns parsed drafts and never auto-sends', async () => {
    const res = await POST(req(), params());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.drafts[0]).toMatchObject({ subject: 'Checking in', label: 'Re-engage' });
    // Nothing in the response resembles a send confirmation.
    expect(JSON.stringify(body)).not.toMatch(/\bsent\b/i);
  });

  it('sends the grounding system prompt and a JSON schema', async () => {
    await POST(req(), params());
    const arg = messagesCreateMock.mock.calls[0]![0];
    expect(arg.system).toContain('Use ONLY the facts given to you');
    expect(arg.output_config.format.type).toBe('json_schema');
    expect(arg.model).toBe('claude-opus-5');
    // Sampling params are rejected on this model — they must not be sent.
    expect(arg).not.toHaveProperty('temperature');
    expect(arg).not.toHaveProperty('top_p');
  });
});

// ─── Graceful failure ──────────────────────────────────────────────────────

describe('graceful failure — the plain email path must survive', () => {
  it('returns 200 with empty drafts when the API errors', async () => {
    messagesCreateMock.mockRejectedValue(new Error('upstream 500'));
    const res = await POST(req(), params());
    // 200, not 5xx: the modal still opens and still offers Outlook.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.drafts).toEqual([]);
    expect(body.error).toBeTruthy();
  });

  it('returns 200 with empty drafts when the key is missing', async () => {
    const { AnthropicNotConfiguredError } = await import('@/lib/integrations/anthropic/client');
    getClientMock.mockImplementation(() => { throw new AnthropicNotConfiguredError(); });
    const res = await POST(req(), params());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ drafts: [] });
  });

  it('logs a failed attempt so a failing loop still burns budget', async () => {
    messagesCreateMock.mockRejectedValue(new Error('boom'));
    await POST(req(), params());
    expect(recordCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, errorCategory: 'api_error' }),
    );
  });

  it('handles a refusal without throwing', async () => {
    messagesCreateMock.mockResolvedValue({
      stop_reason: 'refusal', content: [], usage: {},
    });
    const res = await POST(req(), params());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ drafts: [] });
    expect(recordCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, errorCategory: 'refusal' }),
    );
  });

  it('survives unparseable model output', async () => {
    messagesCreateMock.mockResolvedValue({
      stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }], usage: {},
    });
    const res = await POST(req(), params());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ drafts: [] });
  });
});
