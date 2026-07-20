import { describe, expect, it } from 'vitest';
import { buildSoftProFetchUrl, verifySoftProFetchToken } from './softpro-fetch-token';
import { softProDocumentName } from './softpro-document-name';

describe('softProDocumentName', () => {
  it('keeps SoftPro DocumentName short', () => {
    expect(softProDocumentName({
      documentId: 3346,
      category: 'grant_deed',
      filename: 'tp_20018618-GLT_grant_deed_1780952663434.pdf',
    })).toBe('gd-3346.pdf');
  });
});

describe('softPro fetch token', () => {
  it('signs and verifies short SoftPro fetch URLs under MAX_PATH pressure', () => {
    process.env.SOFTPRO_DOC_FETCH_SECRET = 'test-secret';
    process.env.NEXT_PUBLIC_APP_URL = 'https://hub.pctitle.com';

    const url = buildSoftProFetchUrl(3346);
    expect(url.length).toBeLessThan(200);
    const parts = url.split('/');
    const sig = parts.pop()!;
    const exp = Number(parts.pop());
    const documentId = Number(parts.pop());
    expect(verifySoftProFetchToken(documentId, exp, sig)).toEqual({ ok: true });
    expect(verifySoftProFetchToken(documentId, exp, 'bad-signature-value!!!!').ok).toBe(false);
  });
});
