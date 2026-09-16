import { describe, expect, it } from 'vitest';
import { buildPolicyDeliveryEmail, buildPolicyUnresolvedEmail } from './policy-delivery-send';

describe('policy delivery email', () => {
  it('matches confirmation quality: branded shell, real filename, file number', () => {
    const { subject, html, text } = buildPolicyDeliveryEmail({
      kind: 'lender_policy',
      fileNumber: '20018881-OCT',
      propertyAddress: '123 Main St, Los Angeles, CA',
      apn: '1234-567-890',
      titleOfficerName: 'Dana Reyes',
      filename: 'Lender Policy.pdf',
      sizeBytes: 240_000,
      downloadUrl: 'https://example.com/policy.pdf',
    });

    expect(subject).toContain("Lender's policy");
    expect(subject).toContain('20018881-OCT');
    expect(html).toContain('Lender Policy.pdf');
    expect(html).toContain('https://example.com/policy.pdf');
    expect(html).toContain('123 Main St');
    expect(html).toContain("Lender's policy is ready.");
    expect(text).toContain('Lender Policy.pdf');
  });

  it('fail-closed copy names the missing recipient and refuses to guess', () => {
    const { subject, html } = buildPolicyUnresolvedEmail({
      kind: 'owner_policy',
      fileNumber: '20018881-OCT',
      propertyAddress: '123 Main St, Los Angeles, CA',
      missing: ['owner'],
    });
    expect(subject).toContain('Cannot deliver');
    expect(html).toContain('owner');
    expect(html).toContain('Do not guess');
    expect(html).toContain('party wizard');
  });
});
