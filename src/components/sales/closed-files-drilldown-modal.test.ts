import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/domain/orders/date-format', () => ({
  formatOrderDate: (v: string) => v,
}));

import {
  ClosingsDrilldownModal,
} from './closings-drilldown-modal';
import {
  RevenueDrilldownModal,
} from './revenue-drilldown-modal';
import { ClosedFilesDrilldownModal } from './closed-files-drilldown-modal';

const tessaDir = join(__dirname, '../tessa');

describe('Tier-3 Batch C — orphan + dedupe', () => {
  it('M13a: TessaPrelimModal is deleted (actions use TessaPrelimResultsModal)', () => {
    expect(existsSync(join(tessaDir, 'TessaPrelimModal.tsx'))).toBe(false);
    expect(existsSync(join(tessaDir, 'TessaPrelimUploader.tsx'))).toBe(false);

    const index = readFileSync(join(tessaDir, 'index.ts'), 'utf8');
    expect(index).not.toContain('TessaPrelimModal');
    expect(index).toContain('TessaPrelimResultsModal');

    const actions = readFileSync(join(__dirname, 'use-sales-order-actions.tsx'), 'utf8');
    expect(actions).toContain('TessaPrelimResultsModal');
    expect(actions).toMatch(/case 'prelim_summary':/);
    expect(actions).toMatch(/case 'regenerate_summary':/);
    expect(actions).toContain('setTessaOrder(order)');
    expect(actions).not.toContain('TessaPrelimModal');
  });

  it('M13b: Closings and Revenue drilldowns are the same shared component', () => {
    expect(ClosingsDrilldownModal).toBe(ClosedFilesDrilldownModal);
    expect(RevenueDrilldownModal).toBe(ClosedFilesDrilldownModal);
    expect(ClosingsDrilldownModal).toBe(RevenueDrilldownModal);

    const shared = readFileSync(join(__dirname, 'closed-files-drilldown-modal.tsx'), 'utf8');
    expect(shared).toContain('/api/sales/closings');
    expect(shared).toContain('Closed Files —');
    expect(shared).toContain('No closings found for this period');
  });

  it('M13b: call sites still import the original named wrappers', () => {
    const dashboard = readFileSync(join(__dirname, 'dashboard-content.tsx'), 'utf8');
    const history = readFileSync(join(__dirname, '../../app/(sales)/sales/production-history/page.tsx'), 'utf8');
    expect(dashboard).toContain("from './closings-drilldown-modal'");
    expect(dashboard).toContain('<ClosingsDrilldownModal');
    expect(history).toContain("from '@/components/sales/revenue-drilldown-modal'");
    expect(history).toContain('<RevenueDrilldownModal');
  });
});
