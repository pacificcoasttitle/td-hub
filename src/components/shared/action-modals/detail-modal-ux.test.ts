import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = __dirname;

describe('DetailModal UX batch', () => {
  const shell = readFileSync(join(dir, 'modal-shell.tsx'), 'utf8');
  const detail = readFileSync(join(dir, 'detail-modal.tsx'), 'utf8');
  const actions = readFileSync(join(dir, '../../sales/order-actions.tsx'), 'utf8');
  const cpl = readFileSync(join(dir, 'cpl-modal.tsx'), 'utf8');
  const deliver = readFileSync(join(dir, 'deliver-prelim-modal.tsx'), 'utf8');
  const proposed = readFileSync(join(dir, 'proposed-insured-modal.tsx'), 'utf8');

  it('adds an explicit xl size used only by DetailModal (max-w-6xl / max-h-[90vh])', () => {
    expect(shell).toContain("xl: 'w-full max-w-6xl max-h-[90vh]'");
    expect(shell).toContain("wide: 'w-full max-w-4xl max-h-[80vh]'");
    expect(detail).toContain('size="xl"');
    expect(detail).toMatch(/<ModalShell[^>]*size="xl"/);
    expect(detail).not.toMatch(/<ModalShell[^>]*\bwide\b/);
  });

  it('leaves other wide modals on the wide prop / max-w-4xl path', () => {
    expect(cpl).toMatch(/ModalShell[\s\S]*\bwide\b/);
    expect(deliver).toMatch(/ModalShell[\s\S]*\bwide\b/);
    expect(proposed).toMatch(/ModalShell[\s\S]*\bwide\b/);
    expect(cpl).not.toContain('size="xl"');
    expect(deliver).not.toContain('size="xl"');
    expect(proposed).not.toContain('size="xl"');
  });

  it('renders propertyType on the Property tab', () => {
    expect(detail).toContain('propertyType');
    expect(detail).toContain('Property Type');
    expect(detail).toContain('order.propertyType');
  });

  it('groups documents by category with a prelim badge (not Other)', () => {
    expect(detail).toContain("prelim:           ['Prelim'");
    expect(detail).toContain("{ label: 'Prelim', cats: ['prelim'] }");
    expect(detail).toContain("{ label: 'Vesting', cats: ['legal_vesting'] }");
    expect(detail).toContain("{ label: 'Tax', cats: ['tax'] }");
    expect(detail).toContain("{ label: 'Grant Deed', cats: ['grant_deed'] }");
    expect(detail).toContain("{ label: 'CPL', cats: ['cpl'] }");
    expect(detail).toContain("{ label: 'Proposed Insured', cats: ['proposed_insured'] }");
    expect(detail).toContain("grouped.push({ label: 'Other', items: other })");
    expect(detail).not.toContain("Open Order Documents");
  });

  it('removes Open Full Page from the detail modal', () => {
    expect(detail).not.toContain('Open Full Page');
    expect(detail).not.toContain('detailHref');
    expect(detail).not.toMatch(/from 'next\/link'/);
  });

  it('removes the disabled View Invoice stub from sales order actions', () => {
    expect(actions).not.toContain('View Invoice');
    expect(actions).not.toContain('Coming soon');
  });
});
