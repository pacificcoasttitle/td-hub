import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// On 2026-09-22 the production build failed because it could not download a
// Google font, and production silently kept serving the previous commit. The
// fonts now come from src/app/fonts. This keeps them there: next/font/google
// fetches at BUILD time, so any use of it is a network dependency of every
// deploy.

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.(tsx?|css)$/.test(n)) out.push(f);
  }
  return out;
}

describe('the build fetches nothing it does not need', () => {
  it('uses no Google-hosted font', () => {
    const offenders = walk(join(process.cwd(), 'src'))
      .filter((f) => !f.endsWith('no-build-time-fetch.test.ts'))
      .filter((f) => /next\/font\/google|fonts\.googleapis\.com/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
