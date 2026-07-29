import { describe, expect, it } from 'vitest';
import { mapCsvToImportRows, parseCsv, previewImportRows } from './csv-parse';

describe('parseCsv', () => {
  it('parses simple rows with CRLF and LF endings', () => {
    const { headers, rows } = parseCsv('name,email\r\nJane,jane@kw.com\nMarcus,m@c.com\n');
    expect(headers).toEqual(['name', 'email']);
    expect(rows).toEqual([['Jane', 'jane@kw.com'], ['Marcus', 'm@c.com']]);
  });

  it('handles quoted fields with commas and escaped quotes', () => {
    const { rows } = parseCsv('name,company\n"Smith, Jane","Keller ""KW"" Williams"\n');
    expect(rows).toEqual([['Smith, Jane', 'Keller "KW" Williams']]);
  });

  it('drops fully empty trailing lines', () => {
    const { rows } = parseCsv('name\nJane\n\n\n');
    expect(rows).toEqual([['Jane']]);
  });
});

describe('mapCsvToImportRows', () => {
  it('maps case-insensitive headers and ignores extra columns', () => {
    const parsed = parseCsv('Name,EMAIL,Favorite Color,Phone\nJane,j@kw.com,teal,555\n');
    const { rows, missingNameHeader } = mapCsvToImportRows(parsed);
    expect(missingNameHeader).toBe(false);
    expect(rows).toEqual([{ name: 'Jane', company: null, email: 'j@kw.com', phone: '555' }]);
  });

  it('flags a missing name header', () => {
    const { missingNameHeader } = mapCsvToImportRows(parseCsv('email\nj@kw.com\n'));
    expect(missingNameHeader).toBe(true);
  });
});

describe('previewImportRows', () => {
  it('mirrors server triage: dedupe vs existing list and within file, case-insensitive', () => {
    const rows = [
      { name: 'Jane', company: null, email: 'JANE@kw.com', phone: null },   // dup of existing
      { name: 'Marcus', company: null, email: 'm@c.com', phone: null },     // added
      { name: 'Marcus 2', company: null, email: 'M@C.com', phone: null },   // dup within file
      { name: null, company: null, email: 'x@y.com', phone: null },         // missing name
      { name: 'Bad', company: null, email: 'not-an-email', phone: null },   // invalid email
      { name: 'No Email', company: null, email: null, phone: null },        // added (email optional)
    ];
    const out = previewImportRows(rows, new Set(['jane@kw.com']));
    expect(out.map(r => r.status)).toEqual([
      'skipped_duplicate', 'added', 'skipped_duplicate', 'error', 'error', 'added',
    ]);
    expect(out[3].message).toBe('Missing name');
    expect(out[4].message).toBe('Invalid email');
    expect(out[0].row).toBe(1);
  });
});
