import { describe, expect, it } from 'vitest';
import {
  buildOrderConfirmationSubject,
  orderConfirmationTemplate,
} from './confirmation-template';

describe('buildOrderConfirmationSubject', () => {
  it('uses file · street, city · Confirmation when address is present', () => {
    const subject = buildOrderConfirmationSubject('20021348-OCT', {
      address: '419 Calle Delicada',
      city: 'San Clemente',
      zip: '92672',
    });
    expect(subject).toBe('20021348-OCT · 419 Calle Delicada, San Clemente · Confirmation');
    expect(subject).not.toContain('92672');
    expect(subject).not.toContain(', CA');
  });

  it('falls back to the legacy subject when address is absent', () => {
    expect(buildOrderConfirmationSubject('20021348-OCT', null)).toBe(
      'Open Order Confirmation - 20021348-OCT',
    );
    expect(buildOrderConfirmationSubject('20021348-OCT', { address: null, city: null })).toBe(
      'Open Order Confirmation - 20021348-OCT',
    );
    expect(buildOrderConfirmationSubject('20021348-OCT', { address: '  ', city: '' })).toBe(
      'Open Order Confirmation - 20021348-OCT',
    );
    expect(buildOrderConfirmationSubject('20021348-OCT', { address: null, city: null })).not.toContain('·');
  });

  it('truncates the address with an ellipsis when the subject would exceed ~70 chars', () => {
    const subject = buildOrderConfirmationSubject('20021348-OCT', {
      address: '12345 Extremely Long Named Residential Boulevard West Wing',
      city: 'Rancho Santa Margarita',
    });
    expect(subject.startsWith('20021348-OCT · ')).toBe(true);
    expect(subject.endsWith(' · Confirmation')).toBe(true);
    expect(subject).toContain('…');
    expect(subject.length).toBeLessThanOrEqual(70);
    // File number must never be truncated.
    expect(subject.indexOf('20021348-OCT')).toBe(0);
  });
});

describe('orderConfirmationTemplate subject wiring', () => {
  it('renders the address subject through the template when property is present', () => {
    const { subject } = orderConfirmationTemplate({
      fileNumber: '20019999-TEST',
      hasDocuments: false,
      isTitlePointActive: true,
      property: { address: '123 Main St', city: 'Glendale', zip: '91203' },
    });
    expect(subject).toBe('20019999-TEST · 123 Main St, Glendale · Confirmation');
  });
});
