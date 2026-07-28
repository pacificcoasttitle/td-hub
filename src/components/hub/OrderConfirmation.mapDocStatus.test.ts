import { describe, expect, it } from 'vitest';
import { hasProcessingDocs, hasRealS3Url, mapDocStatus, type ConfirmationData } from './OrderConfirmation';

describe('mapDocStatus — Ready only with a real S3 URL', () => {
  it('is NOT Ready when status is completed but s3Url is null', () => {
    const doc = mapDocStatus({ status: 'completed', s3Url: null }, 'Tax Report');
    expect(doc.status).toBe('processing');
    expect(doc.url).toBeNull();
    expect(doc.status).not.toBe('ready');
  });

  it('is NOT Ready when s3Url is empty or "#"', () => {
    expect(mapDocStatus({ status: 'completed', s3Url: '' }, 'LV').status).toBe('processing');
    expect(mapDocStatus({ status: 'completed', s3Url: '#' }, 'LV').status).toBe('processing');
    expect(hasRealS3Url(null)).toBe(false);
    expect(hasRealS3Url('#')).toBe(false);
  });

  it('IS Ready when status is completed and s3Url is a real URL', () => {
    const url = 'https://s3.amazonaws.com/bucket/tax.pdf?X-Amz-Signature=abc';
    const doc = mapDocStatus({ status: 'completed', s3Url: url }, 'Tax Report');
    expect(doc.status).toBe('ready');
    expect(doc.url).toBe(url);
  });

  it('keeps pending/processing as processing and failed as not_available', () => {
    expect(mapDocStatus({ status: 'pending', s3Url: null }, 'LV').status).toBe('processing');
    expect(mapDocStatus({ status: 'processing', s3Url: null }, 'LV').status).toBe('processing');
    expect(mapDocStatus({ status: 'failed', s3Url: null }, 'LV').status).toBe('not_available');
    expect(mapDocStatus(undefined, 'LV').status).toBe('not_available');
  });

  it('hasProcessingDocs stays true when completed without S3 (keeps polling)', () => {
    const data: ConfirmationData = {
      order: { fileNumber: '20016430-GLT', createdAt: '2026-07-28T00:00:00.000Z' },
      titlePoint: {
        documents: {
          lv: { status: 'completed', s3Url: null },
          tax: { status: 'completed', s3Url: 'https://s3.example/tax.pdf' },
          grantDeed: { status: 'not_started', s3Url: null },
        },
      },
    };
    expect(hasProcessingDocs(data)).toBe(true);
    expect(mapDocStatus(data.titlePoint!.documents!.lv, 'LV').status).toBe('processing');
    expect(mapDocStatus(data.titlePoint!.documents!.tax, 'Tax').status).toBe('ready');
  });
});
