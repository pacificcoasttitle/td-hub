import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SoftPro create timeout is create-specific', () => {
  it('create waits 120s; 60s was clipping the observed tail', () => {
    const src = readFileSync(join(__dirname, 'client.ts'), 'utf8');
    expect(src).toMatch(/export const CREATE_ORDER_TIMEOUT_MS = 120_000/);
    expect(src).toMatch(/AbortSignal\.timeout\(CREATE_ORDER_TIMEOUT_MS\)/);
    expect(src).toMatch(/p50 21s \/ p95 39s \/ max 57s/);
    // The shared makeRequest default stays 60s so enrich / get_attached do not move.
    expect(src).toMatch(/options\?\.timeoutMs \?\? 60_000/);
  });
});

