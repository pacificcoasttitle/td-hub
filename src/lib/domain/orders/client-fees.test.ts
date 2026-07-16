import { describe, expect, it } from 'vitest';
import { normalizeClientFeesResponse } from './client-fees';

describe('normalizeClientFeesResponse', () => {
  it('maps client fees API invoices from body.data into renderable invoice items', () => {
    const result = normalizeClientFeesResponse({
      success: true,
      data: {
        invoices: [
          {
            invoiceNumber: 'INV-100',
            fees: [
              { description: 'Title Fee', amount: 250 },
              { description: 'Escrow Fee', amount: 350 },
            ],
            total: 600,
          },
        ],
        grandTotal: 600,
      },
    });

    expect(result).toEqual({
      invoices: [
        {
          id: 'INV-100',
          label: 'Invoice INV-100',
          items: [
            { description: 'Title Fee', amount: 250 },
            { description: 'Escrow Fee', amount: 350 },
          ],
          total: 600,
        },
      ],
      grandTotal: 600,
      fileNumber: undefined,
    });
  });

  it('throws when the API returns a successful HTTP response with success false', () => {
    expect(() => normalizeClientFeesResponse({
      success: false,
      error: 'Fee information is not available at this time',
    })).toThrow('Fee information is not available at this time');
  });
});
