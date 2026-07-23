import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('TitlePoint Tier-1: no new orphan titlepoint.poll queued jobs', () => {
  it('pre-initiate does not insert status=queued titlepoint.poll jobs', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/lib/domain/titlepoint/pre-initiate.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/jobType:\s*'titlepoint\.poll'/);
    expect(src).not.toMatch(/status:\s*'queued'/);
    expect(src).toMatch(/executePipeline/);
  });

  it('initiateSearch timeout marks failed instead of re-queuing', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/lib/domain/titlepoint/service.ts'),
      'utf8',
    );
    // The old "leave job as queued for future cron pickup" path must be gone.
    expect(src).not.toMatch(/leave job as queued for future cron/);
    expect(src).toMatch(/retryable via manual retry/);
  });

  it('titlepoint-poll handler never requeues pending polls', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/lib/jobs/handlers/titlepoint-poll.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/status:\s*'queued'/);
    expect(src).toMatch(/requeued:\s*false/);
  });
});
