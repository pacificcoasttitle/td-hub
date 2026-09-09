/**
 * What the confirmation email carried, recorded rather than inferred.
 *
 * 961 confirmations were sent with `notification_logs.metadata` null on every
 * one. The only available question was "was the document row created before
 * sent_at", which answers whether the row existed and cannot answer whether it
 * attached. Those differ exactly when an S3 download fails at send time, and
 * that failure is silent.
 *
 * So the record keeps three things apart: what existed, what went, and what
 * existed and did not go. Same discipline as write-accepted versus
 * listing-confirmed on the SoftPro side — do not collapse two states into one
 * word you cannot take apart afterwards.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAttachmentRecord } from './order-confirmation';

describe('buildAttachmentRecord', () => {
  it('records a complete send', () => {
    const r = buildAttachmentRecord({
      presentCategories: ['legal_vesting', 'tax', 'grant_deed'],
      attachedCategories: ['legal_vesting', 'tax', 'grant_deed'],
      filenames: ['lv.pdf', 'tax.pdf', 'gd.pdf'],
      outstanding: false,
    });
    expect(r.attached).toEqual(['legal_vesting', 'tax', 'grant_deed']);
    expect(r.dropped).toEqual([]);
    expect(r.outstanding).toBe(false);
  });

  it('distinguishes "never existed" from "existed and did not attach"', () => {
    // THE CASE THE OLD RECORD COULD NOT EXPRESS. Two orders, both missing the
    // grant deed from the email, different causes, previously identical in the
    // data — and only one of them is a bug in the send.
    const raced = buildAttachmentRecord({
      presentCategories: ['legal_vesting', 'tax'],
      attachedCategories: ['legal_vesting', 'tax'],
      filenames: ['lv.pdf', 'tax.pdf'],
      outstanding: false,
    });
    const lost = buildAttachmentRecord({
      presentCategories: ['legal_vesting', 'tax', 'grant_deed'],
      attachedCategories: ['legal_vesting', 'tax'],
      filenames: ['lv.pdf', 'tax.pdf'],
      outstanding: false,
    });

    expect(raced.eligible).not.toContain('grant_deed');
    expect(raced.dropped).toEqual([]);

    expect(lost.eligible).toContain('grant_deed');
    expect(lost.dropped).toEqual(['grant_deed']);

    expect(raced.attached).toEqual(lost.attached);
  });

  it('records the timeout race — nothing generated yet', () => {
    const r = buildAttachmentRecord({
      presentCategories: [],
      attachedCategories: [],
      filenames: [],
      outstanding: true,
    });
    expect(r.eligible).toEqual([]);
    expect(r.attached).toEqual([]);
    expect(r.dropped).toEqual([]);
    expect(r.outstanding).toBe(true);
  });

  it('ignores categories the confirmation never carries', () => {
    // A cpl or prelim row on the order is not a confirmation attachment and
    // must not show up as eligible, or every send looks like it dropped one.
    const r = buildAttachmentRecord({
      presentCategories: ['legal_vesting', 'cpl', 'prelim', 'proposed_insured'],
      attachedCategories: ['legal_vesting'],
      filenames: ['lv.pdf'],
      outstanding: true,
    });
    expect(r.eligible).toEqual(['legal_vesting']);
    expect(r.dropped).toEqual([]);
  });

  it('reports eligible in the order the email lists them, not arrival order', () => {
    const r = buildAttachmentRecord({
      presentCategories: ['grant_deed', 'tax', 'legal_vesting'],
      attachedCategories: [],
      filenames: [],
      outstanding: true,
    });
    expect(r.eligible).toEqual(['legal_vesting', 'tax', 'grant_deed']);
  });

  it('does not mutate or alias its inputs', () => {
    const attached = ['legal_vesting'];
    const r = buildAttachmentRecord({
      presentCategories: ['legal_vesting'],
      attachedCategories: attached,
      filenames: ['lv.pdf'],
      outstanding: true,
    });
    attached.push('tax');
    expect(r.attached).toEqual(['legal_vesting']);
  });
});

describe('the record actually reaches the log', () => {
  const src = readFileSync(join(__dirname, 'order-confirmation.ts'), 'utf8');

  it('writes metadata on every notification_logs insert', () => {
    // A metadata column populated on some rows of a send and null on others is
    // worse to query than one that is always there, so this asserts count
    // rather than presence.
    const inserts = src.match(/insert\(notificationLogs\)/g) ?? [];
    const metadataWrites = src.match(/metadata: sendRecord/g) ?? [];
    expect(inserts.length).toBeGreaterThan(0);
    expect(metadataWrites.length).toBe(inserts.length);
  });

  it('records who the confirmation went to, not just what it carried', () => {
    // The outstanding-documents alert has to name a customer to send to.
    // Deriving it later from the order answers "who is the client now", which
    // is a different question — parties get corrected after a send.
    expect(src).toMatch(/clientName: opener\?\.name \?\? null/);
    expect(src).toMatch(/clientEmail: opener\?\.email \?\? null/);
  });
});
