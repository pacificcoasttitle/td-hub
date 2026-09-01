import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { claimCreateInFlight, releaseCreateInFlight } from './claim-create-in-flight';

describe('claimCreateInFlight', () => {
  it('lets the first click through and ignores the second before release', () => {
    const inFlight = { current: false };
    expect(claimCreateInFlight(inFlight)).toBe(true);
    expect(claimCreateInFlight(inFlight)).toBe(false);
    expect(inFlight.current).toBe(true);
    releaseCreateInFlight(inFlight);
    expect(claimCreateInFlight(inFlight)).toBe(true);
  });

  it('hub and client submit claim before fetch; submitLocked stays the post-result lock', () => {
    const hub = readFileSync(join(__dirname, '../../components/admin/quick-entry/use-quick-entry.ts'), 'utf8');
    const client = readFileSync(join(__dirname, '../../app/client/orders/new/page.tsx'), 'utf8');
    for (const src of [hub, client]) {
      expect(src).toMatch(/claimCreateInFlight/);
      expect(src).toMatch(/releaseCreateInFlight/);
      expect(src).toMatch(/submitLocked/);
    }
    expect(hub).toMatch(/if \(result\?\.submitLocked\) return/);
    expect(client).toMatch(/result\?\.submitLocked/);
  });
});
