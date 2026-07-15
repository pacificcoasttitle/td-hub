import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  DeliverPrelimFooter,
  addAdHocCcRecipient,
  buildDeliverPrelimPayload,
  getDeliverPrelimSendDisabledReason,
  removeCcRecipient,
  toEditableRecipients,
  type PrelimRecipientResolution,
} from './deliver-prelim-modal';

const blockedResolution: PrelimRecipientResolution = {
  to: null,
  cc: [],
  warnings: [],
  blocked: true,
  blockReason: 'No valid escrow-officer recipient resolved',
};

const validResolution: PrelimRecipientResolution = {
  to: { email: 'eo@example.com', name: 'Escrow Officer', role: 'escrow_officer' },
  cc: [
    { email: 'title@example.com', name: 'Title Rep', role: 'title_rep', source: 'title_officer' },
  ],
  warnings: [],
  blocked: false,
};

function renderFooterFor(resolution: PrelimRecipientResolution) {
  const sendDisabledReason = getDeliverPrelimSendDisabledReason({
    loading: false,
    error: '',
    resolution,
  });

  return renderToStaticMarkup(
    <DeliverPrelimFooter
      sendDisabledReason={sendDisabledReason}
      sending={false}
      onClose={vi.fn()}
      onSend={vi.fn()}
    />,
  );
}

describe('DeliverPrelimModal review state', () => {
  it('renders Send disabled with block reason when resolver blocks, and enabled for a valid TO', () => {
    const blockedMarkup = renderFooterFor(blockedResolution);
    expect(blockedMarkup).toContain('No valid escrow-officer recipient resolved');
    expect(blockedMarkup).toContain('disabled=""');

    const validMarkup = renderFooterFor(validResolution);
    expect(validMarkup).toContain('Send');
    expect(validMarkup).not.toContain('disabled=""');
  });

  it('adds and removes an ad-hoc CC from the payload submitted by the modal', () => {
    const initialCc = toEditableRecipients(validResolution.cc);
    const added = addAdHocCcRecipient({
      current: initialCc,
      draft: { email: 'Assistant@Example.com ', name: ' Escrow Assistant ', role: 'assistant' },
      to: validResolution.to,
      keySuffix: 'test',
    });

    expect(added.error).toBe('');
    expect(buildDeliverPrelimPayload(validResolution.to!, added.recipients).cc).toEqual([
      { email: 'title@example.com', name: 'Title Rep', role: 'title_rep', source: 'title_officer' },
      { email: 'assistant@example.com', name: 'Escrow Assistant', role: 'assistant', source: 'ad_hoc' },
    ]);

    const removed = removeCcRecipient(added.recipients, 'ad_hoc:assistant@example.com:test');
    expect(buildDeliverPrelimPayload(validResolution.to!, removed).cc).toEqual([
      { email: 'title@example.com', name: 'Title Rep', role: 'title_rep', source: 'title_officer' },
    ]);
  });
});
