import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../../..');

describe('Tier-3 Batch B — display + a11y', () => {
  it('M11: CPL existing-doc list prefers API filename', () => {
    const src = readFileSync(join(__dirname, 'cpl-modal.tsx'), 'utf8');
    expect(src).toContain('Existing Documents');
    expect(src).toContain("d.filename ?? d.fileName ?? 'CPL.pdf'");
    expect(src).toMatch(/interface ExistingCpl \{[\s\S]*filename\?:/);
  });

  it('M14: InviteModal auto-closes on successful invite', () => {
    const src = readFileSync(join(root, 'components/admin/users/invite-modal.tsx'), 'utf8');
    expect(src).toMatch(/onSuccess\(\);\s*onClose\(\);/);
    expect(src).not.toMatch(/setResult\(\{ ok: true/);
  });

  it('M14: NotesModal shows an initial loading spinner', () => {
    const src = readFileSync(join(__dirname, 'notes-modal.tsx'), 'utf8');
    expect(src).toContain("const [loading, setLoading] = useState(false)");
    expect(src).toContain('setLoading(true)');
    expect(src).toContain('Loading notes…');
    expect(src).toContain('animate-spin');
  });

  it('M14: ModalShell closes on Escape', () => {
    const src = readFileSync(join(__dirname, 'modal-shell.tsx'), 'utf8');
    expect(src).toContain("e.key === 'Escape'");
    expect(src).toContain("document.addEventListener('keydown', onKey)");
    expect(src).toContain('onClose()');
  });

  it('M14: ConfirmationsModal binds attachments per history row', () => {
    const modal = readFileSync(join(root, 'components/admin/ConfirmationsModal.tsx'), 'utf8');
    const api = readFileSync(join(root, 'app/api/admin/orders/[id]/confirmations/route.ts'), 'utf8');
    expect(modal).toContain('entry.attachedDocuments');
    expect(modal).toContain('No attachments for this send');
    expect(api).toContain('createdAt: documents.createdAt');
    expect(api).toMatch(/d\.createdAt\.getTime\(\) <= eventTime\.getTime\(\)/);
  });
});
