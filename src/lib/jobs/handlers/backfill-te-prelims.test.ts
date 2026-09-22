import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Source-sliced deliberately: this is an INTERFACE claim. A rendered test
// could not show that no deliver parameter exists, or that maybeAutoDeliver
// is unreachable from this file. Same shape as deliverableEmailsForSend.

describe('the T&E prelim backfill cannot reach maybeAutoDeliverPrelim', () => {
  const src = readFileSync(join(__dirname, 'backfill-te-prelims.ts'), 'utf8');
  const ingestSrc = readFileSync(
    join(__dirname, '../../domain/documents/ingest-prelim-from-softpro.ts'),
    'utf8',
  );
  const liveSrc = readFileSync(join(__dirname, 'fetch-prelims.ts'), 'utf8');
  const autoSrc = readFileSync(
    join(__dirname, '../../domain/notifications/prelim-auto-delivery.ts'),
    'utf8',
  );
  const jobsRun = readFileSync(
    join(process.cwd(), 'src/app/api/jobs/run/route.ts'),
    'utf8',
  );
  const vercel = JSON.parse(
    readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'),
  ) as { crons: Array<{ path: string; schedule: string }> };

  it('the function takes a limit and nothing that could flip delivery', () => {
    const sig = src.match(
      /export async function backfillTePrelimsWithoutDelivery\(\s*([^)]*)\s*\)/,
    );
    expect(sig, 'backfillTePrelimsWithoutDelivery not found').not.toBeNull();
    expect(sig![1].replace(/\s+/g, ' ').trim().replace(/,$/, '')).toBe('input: BackfillTePrelimsInput');

    const input = src.match(/export interface BackfillTePrelimsInput \{([^}]*)\}/);
    expect(input, 'BackfillTePrelimsInput not found').not.toBeNull();
    expect(input![1].replace(/\s+/g, ' ').trim()).toBe('limit: number;');
  });

  it('hardcodes deliver: false — there is no deliver: true and no input.deliver', () => {
    expect(src).toMatch(/deliver:\s*false/);
    expect(src).not.toMatch(/deliver:\s*true/);
    expect(src).not.toMatch(/deliver:\s*input/);
    expect(src).not.toContain('maybeAutoDeliverPrelim');
  });

  it('ingest only calls maybeAutoDeliverPrelim when deliver is true', () => {
    expect(ingestSrc).toMatch(/if \(input\.deliver\) \{\s*delivery = await maybeAutoDeliverPrelim/);
  });

  it('does not call TESSA and is not handleFetchPrelims', () => {
    expect(src).not.toMatch(/analyzePrelim\(/);
    expect(src).not.toContain('isTessaAutoAnalysisEnabled');
    expect(src).not.toMatch(/handleFetchPrelims\(/);
    expect(src).not.toMatch(/fetchPrelimsForOrder\(/);
  });

  it('uses GetAttachedDocumentsPrelim, not the live GetAttachedDocuments call', () => {
    expect(src).toMatch(/getAttachedDocumentsPrelim\(/);
    expect(src).not.toMatch(/getAttachedDocuments\(/);
  });

  it('is not wired to the cron or the job runner', () => {
    expect(jobsRun).not.toContain('backfillTePrelimsWithoutDelivery');
    expect(jobsRun).not.toContain('backfill-te-prelims');
    expect(vercel.crons.some((c) => c.path.includes('backfill_te') || c.path.includes('backfill-te'))).toBe(false);
  });

  it('the live fetch_prelims path hardcodes deliver: true — age is the belt, not a second deliver: false', () => {
    expect(liveSrc).toMatch(/deliver:\s*true/);
    expect(liveSrc).not.toMatch(/deliver:\s*false/);
    expect(liveSrc).not.toMatch(/deliver:\s*input/);
    expect(liveSrc).toContain('handleFetchPrelims');
    expect(liveSrc).toMatch(/getAttachedDocuments\(/);
    expect(liveSrc).toMatch(/getAttachedDocumentsPrelim\(/);
    expect(liveSrc).toContain("expectsPctEscrowOfficer(orderType) ? 'prelim' : 'general'");
  });

  it('the age rule is three Pacific days on SoftPro date else opened_at, never hub created_at', () => {
    expect(autoSrc).toMatch(/PRELIM_AUTO_DELIVERY_MAX_AGE_DAYS = 3/);
    expect(autoSrc).toContain('skipped_older_than_window');
    expect(autoSrc).toMatch(/issued\.at < windowStart/);
    expect(autoSrc).not.toMatch(/if \(input\.documentCreatedAt < windowStart\)/);
  });
});
