import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectsPctEscrowOfficer } from '@/lib/domain/orders/escrow-officer-expectation';

function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('live fetch asks the prelim endpoint on in-house files', () => {
  const src = withoutComments(readFileSync(join(__dirname, 'fetch-prelims.ts'), 'utf8'));

  it('the branch is the same population as the officer field — T&E and Escrow-only', () => {
    expect(src).toContain("expectsPctEscrowOfficer(orderType) ? 'prelim' : 'general'");
    expect(expectsPctEscrowOfficer('Title only')).toBe(false);
    expect(expectsPctEscrowOfficer(null)).toBe(false);
    expect(expectsPctEscrowOfficer('Title & Escrow')).toBe(true);
    expect(expectsPctEscrowOfficer('Escrow only')).toBe(true);
  });

  it('fetchPrelimsForOrder branches on that choice, not a hardcoded general call', () => {
    const start = src.indexOf('export async function fetchPrelimsForOrder');
    const end = src.indexOf('function extractUrls');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toContain("attachedDocumentsCallFor(orderType) === 'prelim'");
    expect(body).toContain('getAttachedDocumentsPrelim(fileNumber)');
    expect(body).toContain('getAttachedDocuments(fileNumber)');
  });

  it('the cron and the fetch routes pass orderType so the branch can fire', () => {
    expect(src).toContain('fetchPrelimsForOrder(order.id, order.fileNumber, order.orderType)');
    const routes = [
      join(process.cwd(), 'src/app/api/orders/[id]/fetch-prelim/route.ts'),
      join(process.cwd(), 'src/app/api/orders/batch/fetch-prelims/route.ts'),
      join(process.cwd(), 'src/app/api/admin/backfill/prelims/route.ts'),
      join(process.cwd(), 'src/app/api/client/orders/[id]/prelim/route.ts'),
    ].map((path) => withoutComments(readFileSync(path, 'utf8'))).join('\n');
    expect(routes.match(/fetchPrelimsForOrder\([^;]+\)/g)).toEqual([
      'fetchPrelimsForOrder(orderId, order.fileNumber, order.orderType)',
      'fetchPrelimsForOrder(orderId, order.fileNumber, order.orderType)',
      'fetchPrelimsForOrder(order.id, order.fileNumber, order.orderType)',
      'fetchPrelimsForOrder(orderId, order.fileNumber, order.orderType)',
    ]);
  });
});
