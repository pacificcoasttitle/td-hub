import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = __dirname;

describe('action modal parent refresh (M12)', () => {
  it.each([
    'cpl-modal.tsx',
    'deliver-prelim-modal.tsx',
    'proposed-insured-modal.tsx',
  ] as const)('%s accepts onSuccess and invokes it after success', (file) => {
    const src = readFileSync(join(dir, file), 'utf8');
    expect(src).toContain('onSuccess?:');
    expect(src).toContain('onSuccess?.()');
  });

  it('OrdersHubTable wires fetchOrders into the three modals', () => {
    const src = readFileSync(join(dir, '../orders-hub-table.tsx'), 'utf8');
    expect(src).toContain('<CplModal');
    expect(src).toContain('<DeliverPrelimModal');
    expect(src).toContain('<ProposedInsuredModal');
    expect(src.match(/onSuccess=\{fetchOrders\}/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('hub page bumps refreshSignal via onSuccess on the three modals', () => {
    const src = readFileSync(join(dir, '../../../app/(hub)/hub/page.tsx'), 'utf8');
    expect(src).toContain('refreshSignal={tableRefreshSignal}');
    expect(src).toContain('<CplModal');
    expect(src).toContain('<DeliverPrelimModal');
    expect(src).toContain('<ProposedInsuredModal');
    expect(src.match(/onSuccess=\{refreshTable\}/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
