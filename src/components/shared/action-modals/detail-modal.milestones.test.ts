import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('detail-modal milestone caption', () => {
  it('does not leak the developer read-model subtitle', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/components/shared/action-modals/detail-modal.tsx'),
      'utf8',
    );
    expect(src).not.toContain('Canonical order milestones from the shared read model.');
    expect(src).toContain('Order progress');
  });
});
