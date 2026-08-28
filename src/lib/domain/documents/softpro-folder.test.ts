import { describe, expect, it } from 'vitest';
import {
  attachedNamesFromGetAttached,
  cleanSoftProFileUrl,
  countSentAmongAttached,
  softProFolderForCategory,
} from './softpro-folder';

describe('softProFolderForCategory', () => {
  it('matches legacy FolderName strings exactly', () => {
    expect(softProFolderForCategory('legal_vesting')).toBe('legal-vesting');
    expect(softProFolderForCategory('grant_deed')).toBe('grant-deed');
    expect(softProFolderForCategory('tax')).toBe('tax');
    expect(softProFolderForCategory('cpl')).toBe('CPL');
  });

  it('does not send Title Docs or underscored category names for title docs', () => {
    expect(softProFolderForCategory('legal_vesting')).not.toBe('Title Docs');
    expect(softProFolderForCategory('legal_vesting')).not.toBe('legal_vesting');
  });
});

describe('cleanSoftProFileUrl', () => {
  it('strips query strings that Path.GetFileName would treat as the filename', () => {
    const dirty =
      'https://hub.pctitle.com/api/softpro/fetch-doc/42/999/sig/vest-42.pdf?token=abc&X-Amz-Signature=no';
    expect(cleanSoftProFileUrl(dirty)).toBe(
      'https://hub.pctitle.com/api/softpro/fetch-doc/42/999/sig/vest-42.pdf',
    );
  });

  it('rejects a URL whose last segment is not a legal Windows filename', () => {
    expect(() =>
      cleanSoftProFileUrl('https://hub.pctitle.com/legal-vesting/..'),
    ).toThrow(/legal Windows name/);
  });
});

describe('GetAttachedDocuments name matching', () => {
  it('counts sent names that landed, ignoring extras already on the order', () => {
    const sent = ['vest-10.pdf', 'gd-11.pdf', 'tax-12.pdf'];
    const attached = attachedNamesFromGetAttached([
      { FileName: 'prelim.pdf', FolderName: 'Title' },
      { FileName: 'vest-10.pdf', FolderName: 'legal-vesting' },
      { DocumentName: 'gd-11.pdf' },
      { FileName: 'tax-12.pdf', FolderName: 'tax' },
    ]);
    expect(countSentAmongAttached(sent, attached)).toBe(3);
  });

  it('fails the count when SoftPro returns 200 and attaches nothing', () => {
    const sent = ['vest-10.pdf', 'gd-11.pdf'];
    expect(countSentAmongAttached(sent, attachedNamesFromGetAttached([]))).toBe(0);
  });
});
