import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HUB_RESOLVE_BLOCK_REASON,
  NO_ESCROW_PARTY_ACTION,
  RETRY_HELD_NO_RECIPIENT_CEILING,
  RETRY_HELD_NO_RECIPIENT_RUN_ACTION,
  parseRetryHeldNoRecipientLimit,
} from './retry-held-prelim-no-recipient';

describe('the no-recipient retry re-examines hub-resolve holds through maybeAutoDeliverPrelim', () => {
  const src = readFileSync(join(__dirname, 'retry-held-prelim-no-recipient.ts'), 'utf8');
  const jobsRun = readFileSync(join(process.cwd(), 'src/app/api/jobs/run/route.ts'), 'utf8');
  const vercel = JSON.parse(
    readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'),
  ) as { crons: Array<{ path: string; schedule: string }> };
  const adminRoute = readFileSync(
    join(process.cwd(), 'src/app/api/admin/orders/[id]/deliver-prelim/route.ts'),
    'utf8',
  );
  const decideSrc = readFileSync(
    join(process.cwd(), 'src/lib/domain/notifications/pre-send-refresh.ts'),
    'utf8',
  );

  it('calls maybeAutoDeliverPrelim and does not import the admin send route', () => {
    expect(src).toMatch(/maybeAutoDeliverPrelim\(/);
    expect(src).toMatch(/triggeredBy: 'retry_held_no_recipient'/);
    expect(src).not.toContain('sendPrelimDeliveryEmail');
    expect(src).not.toContain('deliver-prelim');
    expect(adminRoute).toContain('sendPrelimDeliveryEmail');
  });

  it('only retries the hub-resolve stop, not SoftPro-empty', () => {
    expect(src).toContain(`reason = \${HUB_RESOLVE_BLOCK_REASON}`);
    expect(HUB_RESOLVE_BLOCK_REASON).toBe('No valid primary prelim recipient resolved');
    expect(src).not.toMatch(/SoftPro holds no/);
    expect(src).toMatch(/opened_at desc/);
  });

  it('filters age and a live recipient in the picker, not after the walk', () => {
    expect(src).toMatch(/prelimAutoDeliveryWindowStart\(/);
    expect(src).toMatch(/opened_at at time zone 'UTC'/);
    expect(src).toMatch(/occurred_at::timestamptz/);
    expect(src).toMatch(/windowStartIso}::timestamptz/);
    expect(src).toMatch(/\[:space:\]/);
    expect(src).toMatch(/escrow_officer_id is not null/);
    expect(src).toMatch(/role = 'escrow_company'/);
    expect(src).toMatch(/loadDeliverableHeld\(limit, windowStart\)/);
    expect(src).toMatch(/pickerError/);
  });

  it('logs the no-escrow-party gap once and does not treat it as a retry', () => {
    expect(NO_ESCROW_PARTY_ACTION).toBe('prelim_held_no_escrow_party');
    expect(src).toContain('NO_ESCROW_PARTY_ACTION');
    expect(src).toMatch(/alreadyLoggedNoEscrowParty/);
    expect(src).toMatch(/kind: 'no_escrow_party'/);
  });

  it('defaults a missing limit only on a cron GET; a manual body still refuses', () => {
    expect(parseRetryHeldNoRecipientLimit({ __invokedBy: 'cron' })).toBe(RETRY_HELD_NO_RECIPIENT_CEILING);
    expect(() => parseRetryHeldNoRecipientLimit({})).toThrow(/requires payload.limit/);
    expect(() => parseRetryHeldNoRecipientLimit({ __invokedBy: 'manual' })).toThrow(/requires payload.limit/);
    expect(() => parseRetryHeldNoRecipientLimit({ limit: 0 })).toThrow(/integer from 1/);
    expect(() => parseRetryHeldNoRecipientLimit({ limit: 51 })).toThrow(/integer from 1/);
    expect(() => parseRetryHeldNoRecipientLimit({ limit: '5' })).toThrow(/integer from 1/);
    expect(parseRetryHeldNoRecipientLimit({ limit: 5 })).toBe(5);
    expect(src).toMatch(/parseRetryHeldNoRecipientLimit\(payload\)/);
    expect(src).toMatch(/attempted >= limit/);
    expect(jobsRun).toMatch(/__invokedBy = req.method === 'GET' \? 'cron' : 'manual'/);
  });

  it('logs attempted, delivered, and held-and-why on every run', () => {
    expect(RETRY_HELD_NO_RECIPIENT_RUN_ACTION).toBe('prelim_retry_held_no_recipient');
    expect(src).toMatch(/action: RETRY_HELD_NO_RECIPIENT_RUN_ACTION/);
    expect(src).toMatch(/attempted: input.result.attempted/);
    expect(src).toMatch(/delivered: input.result.delivered/);
    expect(src).toMatch(/held: input.result.held/);
    expect(src).toMatch(/await logRun\(/);
  });

  it('is sequential with a ceiling and is an hourly cron', () => {
    expect(RETRY_HELD_NO_RECIPIENT_CEILING).toBe(50);
    expect(src).toMatch(/for \(const heldRow of held\)/);
    expect(src).not.toMatch(/Promise\.all/);
    expect(jobsRun).toContain('handleRetryHeldPrelimNoRecipient');
    expect(jobsRun).toContain('prelim.retry_held_no_recipient');
    expect(jobsRun).toMatch(/handleRetryHeldPrelimNoRecipient\(payload\)/);
    const cron = vercel.crons.find((c) => c.path.includes('retry_held_no_recipient'));
    expect(cron?.schedule).toBe('20 * * * *');
  });

  it('does not change the SoftPro-has-none rule', () => {
    expect(decideSrc).toMatch(/status: 'softpro_has_none'/);
    expect(decideSrc).toMatch(/do not substitute ours/);
    expect(src).not.toContain('decideRecipient');
  });
});
