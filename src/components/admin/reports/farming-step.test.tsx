import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  EXPECTED_COLUMNS, FarmingStep, emptyFarmingDraft, farmingFormData, farmingProblem, lastCompleteMonth,
  type FarmingDraft, type FarmingType,
} from './farming-step';

const NOW = new Date('2026-09-21T12:00:00Z');
const csv = new File(['a,b\n1,2'], 'santa-monica.csv', { type: 'text/csv' });
const ready = (over: Partial<FarmingDraft> = {}): FarmingDraft => ({
  ...emptyFarmingDraft(NOW), file: csv, areaName: 'Santa Monica', county: 'Orange',
  repContactId: 22140, repName: 'Mark Neveu', ...over,
});

function visible(el: React.ReactElement): string {
  return renderToStaticMarkup(el).replace(/<[^>]*>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

describe('the default month', () => {
  it('is the last COMPLETE month — a report run on 21 September covers August', () => {
    expect(lastCompleteMonth(NOW)).toBe('2026-08');
  });

  it('crosses a year end', () => {
    expect(lastCompleteMonth(new Date('2026-01-05T12:00:00Z'))).toBe('2025-12');
  });
});

describe('what is still missing', () => {
  it('accepts a complete form for each type', () => {
    for (const t of ['sales_activity', 'carrier_route', 'county_sales'] as FarmingType[]) {
      expect(farmingProblem(t, ready())).toBeNull();
    }
  });

  it('asks for the file first', () => {
    expect(farmingProblem('county_sales', ready({ file: null }))).toContain('CSV file');
  });

  it('refuses a spreadsheet that was not saved as CSV, before the upload', () => {
    const xlsx = new File(['x'], 'sales.xlsx');
    expect(farmingProblem('sales_activity', ready({ file: xlsx }))).toContain('Save the spreadsheet as CSV');
  });

  it('asks for an area on the two reports that print one, not on County Sales', () => {
    expect(farmingProblem('sales_activity', ready({ areaName: ' ' }))).toBe('Enter the area name.');
    expect(farmingProblem('carrier_route', ready({ areaName: '' }))).toBe('Enter the area name.');
    expect(farmingProblem('county_sales', ready({ areaName: '' }))).toBeNull();
  });

  it('asks for a county from the six', () => {
    expect(farmingProblem('county_sales', ready({ county: '' }))).toBe('Choose the county.');
    expect(farmingProblem('county_sales', ready({ county: 'Kern' }))).toBe('Choose the county.');
  });

  it('requires the rep whose name goes on it', () => {
    expect(farmingProblem('carrier_route', ready({ repContactId: null }))).toContain('sales representative');
  });
});

describe('exactly what is posted', () => {
  const fields = (t: FarmingType) => Object.fromEntries(
    [...farmingFormData(t, ready()).entries()].filter(([k]) => k !== 'file'),
  );

  it('sends the file', () => {
    expect(farmingFormData('county_sales', ready()).get('file')).toBeInstanceOf(File);
  });

  it('sends only the fields each type uses', () => {
    expect(fields('sales_activity')).toEqual({
      type: 'sales_activity', brandedToContactId: '22140', areaName: 'Santa Monica', windowMonths: '6', windowEnd: '2026-08',
    });
    expect(fields('carrier_route')).toEqual({
      type: 'carrier_route', brandedToContactId: '22140', areaName: 'Santa Monica', rankBy: 'turnover',
    });
    expect(fields('county_sales')).toEqual({
      type: 'county_sales', brandedToContactId: '22140', county: 'Orange', month: '2026-08',
    });
  });

  it('sends the contact id, never the rep\'s name, email or phone', () => {
    const f = fields('sales_activity');
    expect(f.brandedToContactId).toBe('22140');
    expect(Object.keys(f).some((k) => /name|email|phone/i.test(k) && k !== 'areaName')).toBe(false);
  });

  it('omits the property type when none was stated, rather than sending a blank caption', () => {
    expect('propertyType' in fields('sales_activity')).toBe(false);
    const stated = Object.fromEntries([...farmingFormData('sales_activity', ready({ propertyType: 'Condominium' })).entries()]);
    expect(stated.propertyType).toBe('Condominium');
  });
});

describe('the form', () => {
  const form = (type: FarmingType, problem: string | null = null) => visible(
    <FarmingStep type={type} draft={ready()} problem={problem} onField={() => {}} onFile={() => {}} repPicker={<span>picker</span>} />,
  );

  it('says which columns the file needs, before the upload', () => {
    expect(form('county_sales')).toContain(EXPECTED_COLUMNS.county_sales);
  });

  it('offers SiteX Farms only as a disabled source, saying why', () => {
    const html = renderToStaticMarkup(
      <FarmingStep type="county_sales" draft={ready()} problem={null} onField={() => {}} onFile={() => {}} repPicker={null} />,
    );
    expect(html).toMatch(/disabled[^>]*name="source"|name="source"[^>]*disabled/);
    expect(form('county_sales')).toContain('not connected yet');
  });

  it('asks only for what each report uses', () => {
    expect(form('county_sales')).toContain('County');
    expect(form('county_sales')).not.toContain('Area name');
    expect(form('carrier_route')).toContain('Rank routes by');
    expect(form('sales_activity')).toContain('Window');
  });

  it('shows the reason it is blocked, not only a greyed button', () => {
    expect(form('carrier_route', 'Enter the area name.')).toContain('Enter the area name.');
  });
});
