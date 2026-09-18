import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RETRY_HELD_PRELIM_CEILING,
  WATCHED_TEN_FILE_NUMBERS,
} from './retry-held-prelim-watched-ten';

describe('the watched-ten retry goes through maybeAutoDeliverPrelim', () => {
  const src = readFileSync(join(__dirname, 'retry-held-prelim-watched-ten.ts'), 'utf8');
  const jobsRun = readFileSync(join(process.cwd(), 'src/app/api/jobs/run/route.ts'), 'utf8');
  const vercel = JSON.parse(
    readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'),
  ) as { crons: Array<{ path: string; schedule: string }> };
  const adminRoute = readFileSync(
    join(process.cwd(), 'src/app/api/admin/orders/[id]/deliver-prelim/route.ts'),
    'utf8',
  );

  it('is exactly ten hardcoded files and cannot exceed the ceiling', () => {
    expect(WATCHED_TEN_FILE_NUMBERS).toHaveLength(10);
    expect(WATCHED_TEN_FILE_NUMBERS.length).toBeLessThanOrEqual(RETRY_HELD_PRELIM_CEILING);
    expect(RETRY_HELD_PRELIM_CEILING).toBe(10);
    expect(src).toMatch(/WATCHED_TEN_FILE_NUMBERS\.length > RETRY_HELD_PRELIM_CEILING/);
    expect(src).not.toMatch(/payload\.files/);
    expect(src).not.toMatch(/input\.files/);
  });

  it('calls maybeAutoDeliverPrelim and does not import the admin send route', () => {
    expect(src).toMatch(/maybeAutoDeliverPrelim\(/);
    expect(src).toMatch(/triggeredBy: 'fetch_prelims'/);
    expect(src).not.toContain('sendPrelimDeliveryEmail');
    expect(src).not.toContain('deliver-prelim');
    expect(adminRoute).toContain('sendPrelimDeliveryEmail');
  });

  it('is wired to the job runner and is not a cron', () => {
    expect(jobsRun).toContain('handleRetryHeldPrelimWatchedTen');
    expect(jobsRun).toContain('prelim.retry_held_watched_ten');
    expect(vercel.crons.some((c) => c.path.includes('watched_ten'))).toBe(false);
  });
});
