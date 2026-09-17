import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ProfileSummary } from '@/lib/domain/concierge/profiles';
import { DEFAULT_CRITERIA } from '@/lib/domain/concierge/comp-filter';
import { ConciergeProfileCard } from './concierge-profile-panel';

// Renders the card and reads what an operator would see, the way the documents
// panel is tested: grepping source for UI strings has failed silently here
// before.
function visible(el: React.ReactElement): string {
  const text = renderToStaticMarkup(el)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&middot;|&#xB7;/g, '·')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length === 0) throw new Error('component rendered no visible text');
  return text;
}

const noop = () => {};
const card = (over: Partial<Parameters<typeof ConciergeProfileCard>[0]> = {}) => (
  <ConciergeProfileCard
    profile={null} loading={false} busy={false} error={null} addressMissing={false}
    onGenerate={noop} onAdjust={noop} onRerender={noop}
    {...over}
  />
);

const profile = (over: Partial<ProfileSummary> = {}): ProfileSummary => ({
  id: 7, orderId: 42, status: 'generated', requestedAddress: '1358 5th St, La Verne, CA 91750',
  subjectAddressLine: '1358 5TH ST, LA VERNE, CA 91750', createdAt: '2026-09-17T18:00:00Z',
  createdBy: 'ops@pct.com', errorMessage: null, hasPdf: true, pdfBytes: 900_000, pdfPageCount: 8,
  compsReturned: 30, compsQualified: 12, compsShown: 6, criteria: DEFAULT_CRITERIA,
  creditsCharged: 1, sitexSearchId: 900123, canRenderFree: true,
  ...over,
} as ProfileSummary);

describe('the property profile card — before anything is spent', () => {
  it('says plainly that generating costs a credit', () => {
    expect(visible(card())).toContain('Generating one costs a credit');
  });

  it('refuses without an address, and says which fields are missing', () => {
    const html = renderToStaticMarkup(card({ addressMissing: true }));
    expect(visible(card({ addressMissing: true }))).toContain('Needs a street, city and ZIP');
    expect(html).toContain('disabled=""');
  });

  it('cannot be clicked twice while a generation is in flight', () => {
    expect(renderToStaticMarkup(card({ busy: true }))).toContain('disabled=""');
  });
});

describe('once a profile exists', () => {
  it('never offers Generate again — the second click is what spends twice', () => {
    expect(visible(card({ profile: profile() }))).not.toContain('Generate property profile');
  });

  it('shows what was produced, what it cost, and the criteria behind it', () => {
    const text = visible(card({ profile: profile() }));
    expect(text).toContain('1358 5TH ST, LA VERNE, CA 91750');
    expect(text).toContain('6 of 12 comparables shown');
    expect(text).toContain('1 credit spent');
  });

  it('marks both follow-up actions free, so neither reads as another charge', () => {
    const text = visible(card({ profile: profile({ hasPdf: false }) }));
    expect(text).toContain('Adjust comparables — free');
    expect(text).toContain('Re-render — free');
  });

  it('a failed generation shows its reason and does not offer the PDF', () => {
    const text = visible(card({ profile: profile({ status: 'failed', hasPdf: false, errorMessage: 'SiteX returned 3 locations' }) }));
    expect(text).toContain('Generation failed');
    expect(text).toContain('SiteX returned 3 locations');
    expect(text).not.toContain('Open PDF');
  });
});

describe('where it is mounted', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const read = (f: string) => readFileSync(join(HERE, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

  it('sits on the order pane, not inside the Documents panel', () => {
    // A paid action in a row of free ones is how somebody clicks it expecting
    // a download.
    expect(read('order-detail.tsx')).toContain('<ConciergeProfilePanel order={order} />');
    expect(read('documents-panel.tsx')).not.toContain('Concierge');
  });

  it('asks the server what may be shown rather than reading a flag in the browser', () => {
    const src = read('concierge-profile-panel.tsx');
    expect(src).toContain("fetch('/api/concierge/access')");
    expect(src).not.toContain('NEXT_PUBLIC_CONCIERGE');
    expect(src).toContain('if (!access.featureOn || !access.canGenerate) return null;');
  });

  it('sends the order id with every generation, so the server can refuse a second one', () => {
    expect(read('concierge-profile-panel.tsx')).toMatch(/generate\(\{\s*orderId: order\.id,/);
  });
});
