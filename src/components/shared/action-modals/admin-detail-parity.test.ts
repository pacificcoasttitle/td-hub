import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sharedDir = __dirname;
const adminDir = join(__dirname, '../../admin');

describe('Admin detail modal parity (UNIFY)', () => {
  const detail = readFileSync(join(sharedDir, 'detail-modal.tsx'), 'utf8');
  const orderTable = readFileSync(join(adminDir, 'order-table.tsx'), 'utf8');
  const clientRoute = readFileSync(
    join(__dirname, '../../../app/api/client/orders/[id]/route.ts'),
    'utf8',
  );
  const applyVisibility = readFileSync(
    join(__dirname, '../../../lib/domain/orders/read-model.ts'),
    'utf8',
  );

  it('admin orders table mounts the shared DetailModal with row address', () => {
    expect(orderTable).toMatch(/from '@\/components\/shared\/action-modals'/);
    expect(orderTable).toContain('DetailModal');
    expect(orderTable).toContain('address={formatAddress(modal.order.property)}');
    expect(orderTable).not.toContain('OrderDetailsModal');
  });

  it('retires OrderDetailsModal and orphaned order-detail-sections', () => {
    expect(existsSync(join(adminDir, 'OrderDetailsModal.tsx'))).toBe(false);
    expect(existsSync(join(adminDir, 'order-detail-sections.tsx'))).toBe(false);
  });

  it('ports Assignments + Source into Overview for staff only', () => {
    expect(detail).toContain('AssignmentsBlock');
    expect(detail).toContain('formatSource');
    expect(detail).toContain('Sales Rep');
    expect(detail).toContain('Title Officer');
    expect(detail).toContain('Created By');
    expect(detail).toMatch(/!isClient && <F l="Source"/);
    expect(detail).toMatch(/!isClient && order\.assignments/);
    expect(detail).toContain('source: null');
    expect(detail).toContain('assignments: null');
  });

  it('gates staff fields at applyVisibility(client) and client route shape', () => {
    expect(applyVisibility).toContain('source: null');
    expect(applyVisibility).toContain('marketingSource: null');
    expect(applyVisibility).toMatch(/assignments:\s*\{[\s\S]*salesRep:\s*null/);
    expect(clientRoute).toContain("applyVisibility(model, 'client')");
    expect(clientRoute).not.toMatch(/\bsource\b/);
    expect(clientRoute).not.toContain('assignments');
  });

  it('preserves county formatting and legal expand/collapse polish', () => {
    expect(detail).toContain('formatCounty');
    expect(detail).toContain('LegalDescriptionField');
    expect(detail).toContain('line-clamp-3');
    expect(detail).toContain('Show more');
  });
});
