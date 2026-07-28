import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('notifications.process_outbox cadence', () => {
  it('runs every minute in vercel.json (*/1)', () => {
    const vercel = JSON.parse(
      readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'),
    ) as { crons: Array<{ path: string; schedule: string }> };

    const outbox = vercel.crons.find((c) =>
      c.path.includes('notifications.process_outbox'),
    );
    expect(outbox).toBeDefined();
    expect(outbox!.schedule).toBe('*/1 * * * *');
  });
});
