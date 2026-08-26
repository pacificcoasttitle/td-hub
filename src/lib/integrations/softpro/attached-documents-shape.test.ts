import { describe, expect, it } from 'vitest';
import { describeAttachedDocuments } from './client';

/**
 * Title & Escrow orders have a prelim on 8 of 418 files while Title only has
 * 2,937 of 3,517. The logs could not say why, because a response we can't read
 * and a response with nothing in it both ended as a bare `skipped`.
 */
describe('GetAttachedDocuments response shape', () => {
  it('reads the shape the prelim parser accepts', () => {
    const shape = describeAttachedDocuments([
      'https://softpro.example.com/files/Preliminary%20Title%20Report_114624.pdf',
      'https://softpro.example.com/files/Junior%20Loan%20Policy_210050.pdf',
    ]);

    expect(shape.itemCount).toBe(2);
    expect(shape.urlCount).toBe(2);
    expect(shape.itemTypes).toEqual(['string']);
    expect(shape.keys).toEqual([]);
  });

  it('exposes FolderName on the documented object shape the parser drops', () => {
    const shape = describeAttachedDocuments([
      { DocumentName: 'Preliminary Title Report', FileName: 'prelim.pdf', FolderName: '3 - Production Documents' },
    ]);

    expect(shape.itemCount).toBe(1);
    // extractUrls keeps only strings, so this order stores nothing and reports skipped.
    expect(shape.urlCount).toBe(0);
    expect(shape.keys).toEqual(['DocumentName', 'FileName', 'FolderName']);
  });

  it('separates an empty list from an unreadable one', () => {
    expect(describeAttachedDocuments([])).toMatchObject({ itemCount: 0, urlCount: 0 });
    expect(describeAttachedDocuments(null)).toMatchObject({ dataType: 'null', itemCount: 0 });
  });
});
