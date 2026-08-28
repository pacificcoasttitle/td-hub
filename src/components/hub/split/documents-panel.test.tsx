import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocumentsPanel, type DocumentsPanelProps } from './documents-panel';
import { ConciergeCostGate, type CostGateProps } from './concierge-cost-gate';
import { ConciergeCriteriaPanel } from './concierge-criteria-panel';
import type { ProfileSummary } from '@/lib/domain/concierge/profiles';

// ─── These assert what a HUMAN SEES, by rendering ───────────────────────────
//
// The previous version grepped the source for UI strings. That technique is
// fragile by construction and it failed silently four times in this project:
// the phrase being searched for also lived in a comment above the code, a slice
// ran backwards, and the resulting empty string "contained" nothing — so the
// test passed while asserting nothing at all.
//
// Rendering removes the whole class. A comment cannot appear in the output, and
// a component that renders nothing produces empty text that fails loudly.
//
// Source-slicing is kept for the one thing it is genuinely good at — proving a
// module does not IMPORT something it must never touch (see render.test.ts).

/** Visible text, the way a person reads it: tags gone, whitespace collapsed. */
function visible(el: React.ReactElement): string {
  const html = renderToStaticMarkup(el);
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  // A render that produced nothing must never satisfy a "does not contain" test.
  if (text.length === 0) throw new Error('component rendered no visible text');
  return text;
}

/** A category the API returns in full — id, count, date. Openable. */
const doc = (over: Partial<{ exists: boolean; latestId: number | null; latestCreatedAt: string | null; count: number }> = {}) => ({
  exists: false, latestId: null, latestCreatedAt: null, count: 0, ...over,
});

/** A category the API returns as a bare boolean. NOT openable — no id exists. */
const flag = (exists = false) => ({ exists });

const allDocs = (over: Partial<DocumentsPanelProps['documents']> = {}) => ({
  cpl: doc(), prelim: doc(), proposedInsured: doc(),
  legalVesting: flag(), tax: flag(), grantDeed: flag(),
  ...over,
});

const profile = (over: Partial<ProfileSummary> = {}): ProfileSummary => ({
  id: 7, orderId: 42, status: 'generated',
  requestedAddress: '10523 Stonybrook Ave',
  subjectAddressLine: '10523 Stonybrook Ave, South Gate, CA 90280',
  createdAt: '2026-08-26T18:00:00.000Z', createdBy: 'op@pct.com',
  errorMessage: null, hasPdf: true, pdfBytes: 210_000, pdfPageCount: 8,
  compsReturned: 25, compsQualified: 5, compsShown: 5,
  criteria: { sameUseCode: true, livingAreaPct: 30, bedDelta: 1, bathDelta: 1, radiusMiles: 1, months: 12, maxComps: 12 },
  creditsCharged: 1, sitexSearchId: 1382139045, canRenderFree: true,
  ...over,
});

const panelProps = (over: Partial<DocumentsPanelProps> = {}): DocumentsPanelProps => ({
  documents: allDocs(),
  profile: null, profileLoading: false, canGenerateProfile: true,
  profileFeatureOn: true, busyProfile: false,
  onGenerateProfile: () => {}, onAdjustProfile: () => {}, onRetryProfileRender: () => {},
  onGenerate: () => {},
  ...over,
});

// ─── Absence is not the same sentence for every document ───────────────────
//
// The rule is WHO MAKES IT. "Not received" for anything SoftPro produces at
// order-open; "Not generated" only for what we produce ourselves.
//
// "None on file" is gone. It was true and misleading: legal & vesting, grant
// deed and taxes ARE produced at order-open and simply never transmitted, so
// "none on file" invited the reader to conclude they do not exist.

describe('absent documents say who failed to produce them', () => {
  it('the prelim reads "Not received" — never "Not generated"', () => {
    const text = visible(<DocumentsPanel {...panelProps({ profile: profile() })} />);
    // Anchored to the tile, not the whole panel: the CPL and proposed-insured
    // chips legitimately say "not generated", so a panel-wide check would
    // assert nothing about the prelim at all.
    expect(text).toContain('Preliminary report Not received');
    expect(text).not.toContain('Preliminary report Not generated');
  });

  it('the property profile reads "Not generated" — we are its only maker', () => {
    const text = visible(<DocumentsPanel {...panelProps()} />);
    expect(text).toContain('Not generated');
  });

  it('the phrase "None on file" appears nowhere at all any more', () => {
    const text = visible(<DocumentsPanel {...panelProps()} />);
    expect(text.toLowerCase()).not.toContain('none on file');
  });
});

describe('the five chips word absence by who produces the document', () => {
  const text = () => visible(<DocumentsPanel {...panelProps({ profile: profile() })} />);

  it('SoftPro-produced documents are "not received"', () => {
    const t = text();
    for (const label of ['Legal & vesting', 'Grant deed', 'Taxes']) {
      expect(t, label).toContain(`${label} — not received`);
    }
  });

  it('documents WE produce are "not generated"', () => {
    const t = text();
    expect(t).toContain('CPL — not generated');
    expect(t).toContain('Proposed insured — not generated');
  });

  it('never mixes the two up', () => {
    const t = text();
    expect(t).not.toContain('Legal & vesting — not generated');
    expect(t).not.toContain('CPL — not received');
  });
});

describe('a chip becomes a link the day a document arrives', () => {
  it('an openable category offers a view', () => {
    const text = visible(<DocumentsPanel {...panelProps({
      documents: allDocs({ cpl: doc({ exists: true, latestId: 12, count: 1 }) }),
      profile: profile(),
    })} />);
    expect(text).toContain('CPL — view');
    expect(text).not.toContain('CPL — not generated');
  });

  it('a category with two on file says so', () => {
    const text = visible(<DocumentsPanel {...panelProps({
      documents: allDocs({ cpl: doc({ exists: true, latestId: 12, count: 3 }) }),
      profile: profile(),
    })} />);
    expect(text).toContain('CPL — 3 on file');
  });

  it('a category the API gives no id for says "on file", not "view"', () => {
    // legalVesting arrives as a bare boolean. Offering a link would produce a
    // dead one, so the chip reports existence and stops there.
    const text = visible(<DocumentsPanel {...panelProps({
      documents: allDocs({ legalVesting: flag(true) }),
      profile: profile(),
    })} />);
    expect(text).toContain('Legal & vesting — on file');
    expect(text).not.toContain('Legal & vesting — view');
  });
});

describe('an issued tile never offers Generate', () => {
  it('an issued prelim offers View and Download, not Find', () => {
    const text = visible(<DocumentsPanel {...panelProps({
      documents: allDocs({ prelim: doc({ exists: true, latestId: 99, latestCreatedAt: '2026-08-20T10:00:00Z', count: 1 }) }),
      profile: profile(),
    })} />);
    expect(text).toContain('View');
    expect(text).toContain('Download');
    expect(text).toContain('Issued');
    expect(text).not.toContain('Find');
  });

  it('an issued profile offers a FREE adjustment, never a paid regeneration', () => {
    const text = visible(<DocumentsPanel {...panelProps({ profile: profile() })} />);
    expect(text).toContain('Adjust comparables — free');
    expect(text).toContain('5 comps');
    expect(text).not.toContain('Generate — 1 credit');
  });
});

describe('the two failure modes are priced differently, in words', () => {
  it('a failed RENDER on retrieved data offers a free retry', () => {
    const text = visible(<DocumentsPanel {...panelProps({
      profile: profile({ status: 'failed', hasPdf: false, canRenderFree: true }),
    })} />);
    expect(text).toContain('Retry — free');
    expect(text).not.toContain('credit');
  });

  it('a failed CALL says what a retry costs, and does not hide it', () => {
    const text = visible(<DocumentsPanel {...panelProps({
      profile: profile({ status: 'failed', hasPdf: false, canRenderFree: false, errorMessage: 'Outside coverage' }),
    })} />);
    expect(text).toContain('Try again — 1 credit');
    expect(text).not.toContain('Retry — free');
  });
});

describe('what the tile offers when it may not generate', () => {
  it('an operator without the role is offered nothing', () => {
    const text = visible(<DocumentsPanel {...panelProps({ canGenerateProfile: false })} />);
    expect(text).toContain('Not generated');
    expect(text).not.toContain('Generate — 1 credit');
  });

  it('the feature being off is stated, not silently blank', () => {
    const text = visible(<DocumentsPanel {...panelProps({ profileFeatureOn: false })} />);
    expect(text).toContain('Not enabled');
    expect(text).not.toContain('Generate — 1 credit');
  });
});

// ─── The cost gate, as the operator reads it ───────────────────────────────

const gateProps = (over: Partial<CostGateProps> = {}): CostGateProps => ({
  address: '10523 Stonybrook Ave, South Gate CA 90280',
  preparedForName: 'Jerry Hernandez', preparedForCompany: 'Pacific Coast Title',
  presentingRepName: 'Angeline Wu', presentingRepProblem: null,
  criteriaSummary: 'same property type · ±30% area · 1 mile · 12 months · max 12',
  spend: { thisMonth: 3, allTime: 11 },
  submitting: false, error: null,
  onPreparedForName: () => {}, onPreparedForCompany: () => {},
  onCancel: () => {}, onConfirm: () => {},
  ...over,
});

describe('the cost gate states the cost before the click', () => {
  it('names the price, the property and the rep', () => {
    const text = visible(<ConciergeCostGate {...gateProps()} />);
    expect(text).toContain('This will spend 1 SiteX credit');
    expect(text).toContain('10523 Stonybrook Ave, South Gate CA 90280');
    expect(text).toContain('Angeline Wu');
    expect(text).toContain('I understand this charges one credit.');
  });

  it('shows OUR counts and says why they are ours', () => {
    const text = visible(<ConciergeCostGate {...gateProps()} />);
    expect(text).toContain('This month 3');
    expect(text).toContain('all time 11');
    expect(text).toContain('SiteX does not report a usable balance');
  });

  it('says the adjustment afterwards is free', () => {
    expect(visible(<ConciergeCostGate {...gateProps()} />))
      .toContain('Adjusting the comparables afterwards is free');
  });

  it('surfaces a missing rep as the reason, not a blank', () => {
    const text = visible(<ConciergeCostGate {...gateProps({
      presentingRepName: '',
      presentingRepProblem: 'This order has no sales representative on it.',
    })} />);
    expect(text).toContain('This order has no sales representative on it.');
  });
});

// ─── Nothing on the free path may look like it costs ───────────────────────

describe('the criteria panel never reads like a charge', () => {
  const text = () => visible(
    <ConciergeCriteriaPanel profile={profile()} busy={false} error={null} onClose={() => {}} onApply={() => {}} />,
  );

  it('says free, and says the button re-renders rather than generates', () => {
    expect(text()).toContain('Free — the comparables are already stored.');
    expect(text()).toContain('Re-render — free');
    expect(text()).not.toContain('Generate');
  });

  it('mentions no credit anywhere', () => {
    expect(text().toLowerCase()).not.toContain('credit');
  });

  it('shows what the current filter did, so a change can be judged', () => {
    expect(text()).toContain('25');
    expect(text()).toContain('qualified');
    expect(text()).toContain('shown');
  });

  it('says the maximum is a ceiling, not a quota', () => {
    expect(text()).toContain('never pads');
  });
});

// ─── Source-slicing, kept ONLY for imports ─────────────────────────────────

describe('the free-path components cannot reach the vendor', () => {
  it('neither dialog imports anything from the SiteX integration', () => {
    for (const f of ['concierge-criteria-panel.tsx', 'concierge-cost-gate.tsx']) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      expect(src, f).not.toMatch(/from\s+['"].*integrations\/sitex/);
    }
  });
});
