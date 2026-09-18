import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CONCIERGE_GENERATE_ROLES } from '@/lib/domain/concierge/access';
import { CONTACT_BOOK_READ_ROLES } from '@/lib/security/contact-book-access';
import {
  ConciergeStep, RepPicker, TypeCard,
  draftProblem, fullAddress, typeOptions,
  type ConciergeDraft,
} from './new-report-modal';

// Rendered and read as text. Grepping source for UI strings has failed silently
// in this project before.
function visible(el: React.ReactElement): string {
  return renderToStaticMarkup(el)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&middot;|&#xB7;/g, '·')
    .replace(/\s+/g, ' ')
    .trim();
}

const ON = { canGenerate: true, featureOn: true };
const draft = (over: Partial<ConciergeDraft> = {}): ConciergeDraft => ({
  street: '1358 5th St', city: 'La Verne', state: 'CA', zip: '91750',
  repContactId: 412, repName: 'Justin Nouri', ...over,
});

describe('the type picker', () => {
  it('offers Concierge Profile and says what it costs', () => {
    const concierge = typeOptions(ON)[0]!;
    expect(concierge.label).toBe('Concierge Profile');
    expect(concierge.available).toBe(true);
    expect(visible(<TypeCard option={concierge} selected={false} onSelect={() => {}} />)).toContain('1 credit');
  });

  it('shows the three farming types but does not let them be clicked', () => {
    // A stub that accepts a click and produces no report is worse than a card
    // that says when.
    const farming = typeOptions(ON).filter((o) => o.type !== 'concierge_profile');
    expect(farming.map((o) => o.label)).toEqual(['Sales Activity', 'Carrier Route Analysis', 'County Sales']);
    for (const o of farming) {
      expect(o.available).toBe(false);
      const html = renderToStaticMarkup(<TypeCard option={o} selected={false} onSelect={() => {}} />);
      expect(html).toContain('disabled');
      expect(visible(<TypeCard option={o} selected={false} onSelect={() => {}} />)).toContain('Not yet available');
    }
  });

  it('never puts a credit pill on a type that cannot be generated', () => {
    for (const o of typeOptions({ canGenerate: true, featureOn: false })) {
      expect(visible(<TypeCard option={o} selected={false} onSelect={() => {}} />)).not.toContain('1 credit');
    }
  });

  it('says the feature is off rather than offering a button that fails', () => {
    const off = typeOptions({ canGenerate: true, featureOn: false })[0]!;
    expect(off.available).toBe(false);
    expect(visible(<TypeCard option={off} selected={false} onSelect={() => {}} />))
      .toContain('Property profiles are not enabled.');
  });

  it('says the role is wrong when that is the reason', () => {
    const denied = typeOptions({ canGenerate: false, featureOn: true })[0]!;
    expect(denied.available).toBe(false);
    expect(denied.unavailableNote).toContain('permission');
  });

  it('offers nothing while the server has not answered yet', () => {
    // Optimism here would be a click that reaches a disabled feature.
    expect(typeOptions(null)[0]!.available).toBe(false);
  });
});

describe('what has to be filled in before a credit can be spent', () => {
  it('accepts a complete property with a rep on it', () => {
    expect(draftProblem(draft())).toBeNull();
  });

  it('asks for the pieces of the address it is missing', () => {
    expect(draftProblem(draft({ street: '  ' }))).toContain('street');
    expect(draftProblem(draft({ city: '' }))).toContain('city');
    expect(draftProblem(draft({ zip: '917' }))).toContain('ZIP');
  });

  it('requires a presenting representative — there is no order to take one from', () => {
    // resolvePresentingRep(null, undefined) fails with 'no_order'. Blocking here
    // means the operator is told before the click, not after the 400.
    const problem = draftProblem(draft({ repContactId: null, repName: '' }));
    expect(problem).toContain('representative');
  });

  it('builds the address the gate shows from the fields as typed', () => {
    expect(fullAddress(draft({ state: 'ca' }))).toBe('1358 5th St, La Verne, CA 91750');
  });
});

describe('the property step', () => {
  const step = (over: Partial<ConciergeDraft> = {}, problem: string | null = null) => visible(
    <ConciergeStep draft={draft(over)} problem={problem} onField={() => {}} repPicker={<span>picker</span>} />,
  );

  it('states the comparable criteria the profile will be built with', () => {
    expect(step()).toContain('1 mi · 12 mo · ±30% size');
  });

  it('says adjusting them afterwards is free, because it is', () => {
    expect(step()).toContain('free');
  });

  it('says whose name the profile goes out under', () => {
    expect(step()).toContain('goes out under their name');
  });

  it('shows the reason it is blocked rather than only greying the button', () => {
    expect(step({}, 'Enter the city.')).toContain('Enter the city.');
  });
});

describe('the representative picker', () => {
  const picker = (over: Partial<Parameters<typeof RepPicker>[0]> = {}) => visible(
    <RepPicker
      chosenName="" results={[]} query="" searching={false}
      onQuery={() => {}} onChoose={() => {}} onClear={() => {}}
      {...over}
    />,
  );

  it('shows the chosen rep with a way to change it', () => {
    const text = picker({ chosenName: 'Justin Nouri' });
    expect(text).toContain('Justin Nouri');
    expect(text).toContain('Change');
  });

  it('says plainly when a search found nobody', () => {
    expect(picker({ query: 'zzz', results: [] })).toContain('No sales representative by that name.');
  });

  it('does not call an in-flight search an empty result', () => {
    expect(picker({ query: 'lo', searching: true })).toContain('Searching…');
  });

  it('lists a match by name and company', () => {
    const text = picker({ query: 'nou', results: [{ id: 412, fullName: 'Justin Nouri', email: null, companyName: 'PCT' }] });
    expect(text).toContain('Justin Nouri');
    expect(text).toContain('PCT');
  });
});

describe('the modal as wired', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const strip = (f: string) => readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const src = () => strip(join(HERE, 'new-report-modal.tsx'));

  it('spends through the one route that spends, and no other', () => {
    const s = src();
    expect(s.match(/method: 'POST'/g)!.length).toBe(1);
    expect(s).toContain("'/api/concierge/profiles'");
  });

  it('mounts the cost gate only while it is open, so an acknowledgement cannot survive a cancel', () => {
    expect(src()).toContain('gateOpen ? (');
  });

  it('sends no order id — the double-charge guard is the property, not the order', () => {
    expect(src()).not.toContain('orderId');
  });

  it('sends which contact the rep is, never their name, email or phone', () => {
    // A client-facing document must not print details a browser supplied.
    const s = src();
    expect(s).toContain('presentingRepContactId');
    expect(s).not.toMatch(/presentingRepName:|presentingRepEmail|presentingRepPhone/);
  });

  it('is mounted by the page only while open, so a cancelled form cannot come back half-filled', () => {
    const page = strip(join(HERE, '../../../app/(admin)/reports/page.tsx'));
    expect(page).toContain('modalOpen ? (');
    expect(page).toContain('<NewReportModal');
  });

  it('is reached by roles that can also read the contact book, or the rep picker cannot work', () => {
    for (const role of CONCIERGE_GENERATE_ROLES) {
      expect(CONTACT_BOOK_READ_ROLES).toContain(role);
    }
  });
});
