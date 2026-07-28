import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('TitlePoint OC-2: poll queue + drain claimer', () => {
  it('initiateSearch enqueues titlepoint.poll for drain (no full inline PDF wait)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/lib/domain/titlepoint/service.ts'),
      'utf8',
    );
    expect(src).toMatch(/enqueueTitlePointPollJob/);
    expect(src).not.toMatch(/Execute full pipeline inline/);
  });

  it('linkSessionToOrder short-syncs then enqueues unfinished work', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/lib/domain/titlepoint/pre-initiate.ts'),
      'utf8',
    );
    expect(src).toMatch(/enqueueTitlePointPollJob/);
    expect(src).toMatch(/TITLEPOINT_SHORT_SYNC_MS/);
  });

  it('titlepoint.drain claimer uses FOR UPDATE SKIP LOCKED', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/lib/jobs/handlers/titlepoint-drain-claim.ts'),
      'utf8',
    );
    expect(src).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(src).toMatch(/findActiveTitlePointDrain/);
  });

  it('pre-initiate input path still runs executePipeline (OC-1 park); enqueue only in linkSessionToOrder', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/lib/domain/titlepoint/pre-initiate.ts'),
      'utf8',
    );
    expect(src).toMatch(/executePipeline/);
    const linkIdx = src.indexOf('export async function linkSessionToOrder');
    const preInitFn = src.slice(
      src.indexOf('export async function preInitiateSearches'),
      linkIdx,
    );
    // Call site only — import may appear at module top for linkSessionToOrder.
    expect(preInitFn).not.toMatch(/await enqueueTitlePointPollJob/);
    expect(src.slice(linkIdx)).toMatch(/enqueueTitlePointPollJob/);
  });
});
