import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HUB_RESOLVE_BLOCK_REASON,
  NO_ESCROW_PARTY_ACTION,
  RETRY_HELD_NO_RECIPIENT_CEILING,
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

  it('logs the no-escrow-party gap once and does not treat it as a retry', () => {
    expect(NO_ESCROW_PARTY_ACTION).toBe('prelim_held_no_escrow_party');
    expect(src).toContain('NO_ESCROW_PARTY_ACTION');
    expect(src).toMatch(/alreadyLoggedNoEscrowParty/);
    expect(src).toMatch(/kind: 'no_escrow_party'/);
  });

  it('refuses to run without an explicit integer limit', () => {
    expect(() => parseRetryHeldNoRecipientLimit({})).toThrow(/requires payload.limit/);
    expect(() => parseRetryHeldNoRecipientLimit({ limit: 0 })).toThrow(/integer from 1/);
    expect(() => parseRetryHeldNoRecipientLimit({ limit: 51 })).toThrow(/integer from 1/);
    expect(() => parseRetryHeldNoRecipientLimit({ limit: '5' })).toThrow(/integer from 1/);
    expect(parseRetryHeldNoRecipientLimit({ limit: 5 })).toBe(5);
    expect(src).toMatch(/parseRetryHeldNoRecipientLimit\(payload\)/);
    expect(src).toMatch(/retried >= limit/);
  });

  it('is sequential with a ceiling and is not a cron', () => {
    expect(RETRY_HELD_NO_RECIPIENT_CEILING).toBe(50);
    expect(src).toMatch(/for \(const heldRow of held\)/);
    expect(src).not.toMatch(/Promise\.all/);
    expect(jobsRun).toContain('handleRetryHeldPrelimNoRecipient');
    expect(jobsRun).toContain('prelim.retry_held_no_recipient');
    expect(jobsRun).toMatch(/handleRetryHeldPrelimNoRecipient\(payload\)/);
    expect(vercel.crons.some((c) => c.path.includes('retry_held_no_recipient'))).toBe(false);
  });

  it('does not change the SoftPro-has-none rule', () => {
    expect(decideSrc).toMatch(/status: 'softpro_has_none'/);
    expect(decideSrc).toMatch(/do not substitute ours/);
    expect(src).not.toContain('decideRecipient');
  });
});
