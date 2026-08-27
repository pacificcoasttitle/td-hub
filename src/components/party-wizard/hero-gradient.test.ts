import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ─── The scroll-up-and-compare check ─────────────────────────────────────────
//
// The wizard page and the invite email have to look like the same company. The
// check a suspicious recipient runs is to scroll back to the email and compare
// the two headers, so the surfaces are not "similar" — they are the same
// recipe, and this reads both sources to prove it rather than trusting a
// screenshot or a comment.
//
// It reads files instead of importing them because the point is that the values
// are literally the same characters in two places that cannot import from each
// other: email-layout builds an HTML string for mail clients, and the page is
// React with Tailwind.

const read = (p: string) => readFileSync(p, 'utf8');

const EMAIL = read('src/lib/domain/notifications/email-layout.ts');
const LIT_CARD = read('src/components/brand/lit-card.tsx');
const HEADER = read('src/components/party-wizard/legitimacy-header.tsx');

/** The two layers of the email hero at email-layout.ts:188. */
const emailHero = EMAIL.match(
  /background-image:(radial-gradient\([^;]*?\)),(linear-gradient\([^;]*?\));/,
);

describe('the page hero is the email hero', () => {
  it('finds both gradient layers in the email source', () => {
    expect(emailHero).not.toBeNull();
    expect(emailHero![2]).toBe('linear-gradient(180deg,#2C3564 0%,#15193A 100%)');
    expect(emailHero![1]).toBe('radial-gradient(circle at 80% 34%,rgba(242,107,43,.34),transparent 34%)');
  });

  it('uses the same base surface gradient, character for character', () => {
    // Tailwind arbitrary values carry underscores where CSS has spaces.
    const card = LIT_CARD.match(/bg-\[(linear-gradient\([^\]]*)\]/)?.[1]?.replace(/_/g, ' ');
    expect(card).toBe(emailHero![2]);
  });

  it('uses the same warm glow, character for character', () => {
    const glow = HEADER.match(/EMAIL_HERO_GLOW = '([^']+)'/)?.[1];
    expect(glow).toBe(emailHero![1]);
  });

  it('uses the same orange for the hairline and the eyebrow', () => {
    expect(HEADER.match(/PCT_ORANGE = '(#[0-9A-F]{6})'/i)?.[1])
      .toBe(EMAIL.match(/PCT_ORANGE = '(#[0-9A-F]{6})'/i)?.[1]);
    expect(HEADER.match(/ORANGE_SOFT = '(#[0-9A-F]{6})'/i)?.[1])
      .toBe(EMAIL.match(/ORANGE_SOFT = '(#[0-9A-F]{6})'/i)?.[1]);
  });

  it('repeats the email chip: same #283052 panel and same #9EA7C2 label', () => {
    expect(EMAIL).toContain('background:#283052');
    expect(HEADER).toContain('bg-[#283052]');
    expect(EMAIL).toMatch(/color:#9EA7C2;font-size:9px;font-weight:bold;letter-spacing:1\.25px/);
    expect(HEADER).toMatch(/text-\[9px\] font-bold uppercase tracking-\[1\.25px\] text-\[#9EA7C2\]/);
  });

  it('repeats the email header row and eyebrow at the same sizes', () => {
    expect(EMAIL).toMatch(/font-size:13px;font-weight:bold;letter-spacing:\.1px/);
    expect(HEADER).toMatch(/text-\[13px\] font-bold leading-tight tracking-\[0\.1px\]/);
    expect(EMAIL).toMatch(/font-size:10px;line-height:1\.2;font-weight:bold;letter-spacing:1\.8px/);
    expect(HEADER).toMatch(/text-\[10px\] font-bold uppercase leading-\[1\.2\] tracking-\[1\.8px\]/);
  });
});
