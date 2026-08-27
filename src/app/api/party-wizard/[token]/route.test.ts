import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── The submission endpoint under throttling ────────────────────────────────
//
// The page cannot set a response status in the App Router, so this route is the
// only place in the party wizard that can return a real 429. These tests hold
// that, and hold the two things that make the 429 safe: it is reached before
// any work is done, and it is worded identically to the ordinary per-link cap
// so it adds no new observable.

const { guardMock, submitMock } = vi.hoisted(() => ({
  guardMock: vi.fn(),
  submitMock: vi.fn(),
}));

vi.mock('@/lib/domain/parties/party-wizard-abuse', () => ({
  guardPartyWizardRequest: guardMock,
}));

vi.mock('@/lib/domain/parties/party-wizard-service', () => ({
  submitPartyWizard: submitMock,
}));

const { POST } = await import('./route');

const ALLOWED = { allowed: true, outcome: 'allowed', tripped: null, retryAfterSeconds: 0 };

function req(body: unknown = { agentName: 'Jane Smith' }) {
  return {
    headers: { get: () => '203.0.113.5' },
    json: async () => body,
  } as never;
}

function params(token = 'tok') {
  return { params: Promise.resolve({ token }) };
}

beforeEach(() => {
  guardMock.mockReset();
  submitMock.mockReset();
  guardMock.mockResolvedValue(ALLOWED);
  submitMock.mockResolvedValue({ ok: true, submissionId: 1, noteStatus: 'sent' });
});

describe('when the per-IP limit has been tripped', () => {
  beforeEach(() => {
    guardMock.mockResolvedValue({
      allowed: false, outcome: 'throttled', tripped: 'post', retryAfterSeconds: 600,
    });
  });

  it('answers 429 with the window in Retry-After', async () => {
    const res = await POST(req(), params());

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('600');
  });

  it('does not attempt the submission', async () => {
    await POST(req(), params());
    expect(submitMock).not.toHaveBeenCalled();
  });

  it('does not read the request body, so a blocked caller cannot make us parse it', async () => {
    const json = vi.fn();
    await POST({ headers: { get: () => '203.0.113.5' }, json } as never, params());
    expect(json).not.toHaveBeenCalled();
  });

  it('says nothing about whether the token was real', async () => {
    const res = await POST(req(), params('garbage'));
    const body = await res.json();

    expect(body.error).toBe('Too many submissions. Please wait a few minutes and try again.');
    expect(JSON.stringify(body)).not.toMatch(/invalid|expired|not found|unknown|signature/i);
    expect(body.fieldErrors).toBeUndefined();
  });

  it('is worded exactly like the ordinary per-link cap, so the two cannot be told apart', async () => {
    const perIp = await (await POST(req(), params())).json();

    guardMock.mockResolvedValue(ALLOWED);
    submitMock.mockResolvedValue({ ok: false, reason: 'rate_limited' });
    const perLink = await POST(req(), params());

    expect(perLink.status).toBe(429);
    expect((await perLink.json()).error).toBe(perIp.error);
  });
});

describe('when the limit has not been tripped', () => {
  it('checks the limit before doing any work, and for the submit budget', async () => {
    await POST(req(), params('abc'));

    expect(guardMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'submit',
      token: 'abc',
    }));
  });

  it('passes the submission through', async () => {
    const res = await POST(req(), params());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(submitMock).toHaveBeenCalledTimes(1);
  });

  it('still serves the submission when the limiter failed open on an outage', async () => {
    guardMock.mockResolvedValue({
      allowed: true, outcome: 'store_unavailable', tripped: null, retryAfterSeconds: 0,
    });

    const res = await POST(req(), params());

    expect(res.status).toBe(200);
    expect(submitMock).toHaveBeenCalledTimes(1);
  });
});
