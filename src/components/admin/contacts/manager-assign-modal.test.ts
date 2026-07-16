import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, 'manager-assign-modal.tsx'), 'utf8');

describe('ManagerAssignModal error handling (M9)', () => {
  it('surfaces API error and does not close on failed save', () => {
    expect(src).toContain("const [error, setError] = useState('')");
    expect(src).toContain("throw new Error(body?.error ?? 'Save failed')");
    expect(src).toContain("setError(err instanceof Error ? err.message : 'Save failed')");
    expect(src).toContain('{error &&');
    // Close only after success — never in the catch path
    expect(src).toMatch(/if \(!res\.ok\)[\s\S]*?throw new Error[\s\S]*?onSuccess\(\);\s*onClose\(\);/);
    expect(src).toMatch(/catch \(err\) \{\s*setError\(/);
    expect(src).not.toMatch(/catch[\s\S]{0,80}onClose\(\)/);
  });
});
