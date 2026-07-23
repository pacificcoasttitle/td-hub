import { describe, expect, it } from 'vitest';
import {
  OPEN_ORDERS_CONFIRMATION_CC,
  buildConfirmationRecipients,
} from './confirmation-recipients';

describe('buildConfirmationRecipients', () => {
  it('always CCs openorders@pct.com', () => {
    const result = buildConfirmationRecipients({
      clientEmail: 'client@example.com',
      escrowOfficerEmail: 'escrow@example.com',
    });

    expect(result.to).toContain('client@example.com');
    expect(result.cc).toContain(OPEN_ORDERS_CONFIRMATION_CC);
    expect(result.clientRecipientPresent).toBe(true);
  });

  it('promotes openorders to TO when no other recipients exist', () => {
    const result = buildConfirmationRecipients({ clientEmail: null });

    expect(result.to).toEqual([OPEN_ORDERS_CONFIRMATION_CC]);
    expect(result.cc).not.toContain(OPEN_ORDERS_CONFIRMATION_CC);
    expect(result.clientRecipientPresent).toBe(false);
  });

  it('flags missing client even when other TO recipients exist', () => {
    const result = buildConfirmationRecipients({
      clientEmail: null,
      listingAgentEmail: 'agent@example.com',
      salesRepEmail: 'sr@pct.com',
    });

    expect(result.to).toContain('agent@example.com');
    expect(result.cc).toContain(OPEN_ORDERS_CONFIRMATION_CC);
    expect(result.clientRecipientPresent).toBe(false);
  });

  it('dedupes openorders when it would otherwise appear in both TO and CC', () => {
    const result = buildConfirmationRecipients({
      clientEmail: OPEN_ORDERS_CONFIRMATION_CC,
    });

    expect(result.to).toEqual([OPEN_ORDERS_CONFIRMATION_CC]);
    expect(result.cc).not.toContain(OPEN_ORDERS_CONFIRMATION_CC);
    expect(result.clientRecipientPresent).toBe(true);
  });
});
