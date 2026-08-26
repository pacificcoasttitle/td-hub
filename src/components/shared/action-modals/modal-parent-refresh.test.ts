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

  // The table hub moved out of app/(hub)/hub/page.tsx into its own component
  // when /hub gained the split-view mode. The path changed; the invariant did
  // not, so the assertion follows the code rather than being relaxed.
  it('hub table view bumps refreshSignal via onSuccess on the three modals', () => {
    const src = readFileSync(join(dir, '../../hub/hub-table-view.tsx'), 'utf8');
    expect(src).toContain('refreshSignal={tableRefreshSignal}');
    expect(src).toContain('<CplModal');
    expect(src).toContain('<DeliverPrelimModal');
    expect(src).toContain('<ProposedInsuredModal');
    expect(src.match(/onSuccess=\{refreshTable\}/g)?.length).toBeGreaterThanOrEqual(3);
  });

  // The split view renders the two modals that can change what the list shows.
  // Deliver-prelim belongs to the Documents panel, which is phase 3, so it is
  // deliberately absent here rather than wired to nothing.
  it('hub split view reloads the list after CPL and Proposed Insured succeed', () => {
    const src = readFileSync(join(dir, '../../hub/split/orders-split-view.tsx'), 'utf8');
    expect(src).toContain('<CplModal');
    expect(src).toContain('<ProposedInsuredModal');
    expect(src.match(/onSuccess=\{\(\) => setReloadToken/g)?.length).toBeGreaterThanOrEqual(2);
    expect(src).not.toContain('<DeliverPrelimModal');
  });
});
