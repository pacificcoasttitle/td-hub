import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocumentsPanel, type DocumentsPanelProps } from './documents-panel';

// ─── Assert what a HUMAN SEES, by rendering ─────────────────────────────────
//
// These render the component and read its visible text. The earlier version
// grepped the source for UI strings, which failed silently four times in this
// project — a phrase that also lived in a comment, a slice that ran backwards
// and returned '' so that "does not contain" passed while asserting nothing.

function visible(el: React.ReactElement): string {
  const text = renderToStaticMarkup(el)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
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

const panelProps = (over: Partial<DocumentsPanelProps> = {}): DocumentsPanelProps => ({
  documents: allDocs(),
  onGenerate: () => {},
  ...over,
});

const panel = (over: Partial<DocumentsPanelProps> = {}) => visible(<DocumentsPanel {...panelProps(over)} />);

// ─── The property profile does not belong to an order ───────────────────────

describe('the property profile is not on this panel', () => {
  it('is never mentioned, in any state', () => {
    const text = panel();
    expect(text.toLowerCase()).not.toContain('property profile');
    // And nothing here may cost money. The order pane is a fast funnel; the
    // billable action lives at /hub/property-profile.
    expect(text.toLowerCase()).not.toContain('credit');
  });
});

// ─── Documents to view ──────────────────────────────────────────────────────

describe('documents that arrive with the open-order email are view-only', () => {
  it('an absent one reads "not received", never "none on file"', () => {
    const text = panel();
    for (const label of ['Legal & vesting', 'Grant deed', 'Taxes']) {
      expect(text, label).toContain(`${label} — not received`);
    }
    // "None on file" invites the reader to conclude the document does not
    // exist. It exists; it was not transmitted.
    expect(text.toLowerCase()).not.toContain('none on file');
  });

  it('offers no way to create one — we do not make these', () => {
    const text = panel();
    expect(text).not.toContain('Create Legal & vesting');
    expect(text).not.toContain('Create Grant deed');
    expect(text).not.toContain('Create Taxes');
  });

  it('a present one with no id says "on file" rather than offering a dead link', () => {
    const text = panel({ documents: allDocs({ legalVesting: flag(true) }) });
    expect(text).toContain('Legal & vesting — on file');
    expect(text).not.toContain('Legal & vesting — view');
  });

  it('a present one WITH an id becomes a view link', () => {
    const text = panel({ documents: allDocs({ grantDeed: doc({ exists: true, latestId: 5, count: 1 }) }) });
    expect(text).toContain('Grant deed — view');
  });
});

describe('the prelim', () => {
  it('absent, it offers Find — you look for one, you do not make one', () => {
    const text = panel();
    expect(text).toContain('Preliminary report Not received');
    expect(text).toContain('Find');
    expect(text).not.toContain('Create Preliminary');
  });

  it('issued, it offers View and Download and drops Find', () => {
    const text = panel({
      documents: allDocs({ prelim: doc({ exists: true, latestId: 99, latestCreatedAt: '2026-08-20T10:00:00Z', count: 1 }) }),
    });
    expect(text).toContain('View');
    expect(text).toContain('Download');
    expect(text).not.toContain('Find');
  });
});

// ─── Documents to create ────────────────────────────────────────────────────

describe('CPL and proposed insured are ACTIONS, not absence reports', () => {
  it('both offer a create button', () => {
    const text = panel();
    expect(text).toContain('Create CPL');
    expect(text).toContain('Create Proposed insured');
  });

  it('never reports their absence — the button is the whole message', () => {
    const text = panel();
    expect(text).not.toContain('CPL — not generated');
    expect(text).not.toContain('Proposed insured — not generated');
    expect(text).not.toContain('CPL — not received');
  });

  it('an existing one is offered for reading, and create stays available', () => {
    const text = panel({ documents: allDocs({ cpl: doc({ exists: true, latestId: 12, count: 1 }) }) });
    expect(text).toContain('view existing');
    // A second CPL is a legitimate thing to want; the modal warns about it.
    expect(text).toContain('Create CPL');
  });

  it('several on file are counted', () => {
    const text = panel({ documents: allDocs({ cpl: doc({ exists: true, latestId: 12, count: 3 }) }) });
    expect(text).toContain('view 3 on file');
  });
});

describe('the create buttons are wired to the right action', () => {
  const fired: string[] = [];
  const html = renderToStaticMarkup(
    <DocumentsPanel {...panelProps({ onGenerate: (k) => fired.push(k) })} />,
  );

  it('renders both buttons as real buttons, not spans', () => {
    // The bug this prevents: these were <span> chips with no onClick, so the
    // panel reported absence and clicking did nothing — while the keyboard
    // shortcuts c and i fired the same action successfully.
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(3); // Find + 2 create
    expect(html).toContain('Create CPL');
    expect(html).toContain('Create Proposed insured');
  });
});
