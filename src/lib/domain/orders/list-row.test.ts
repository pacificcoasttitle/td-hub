import { describe, expect, it } from 'vitest';
import { contactName, orderTypeLabel, projectListRow, type ListRowSource } from './list-row';

const repWithParts = {
  fullName: null,
  officerName: null,
  firstName: 'Riley',
  lastName: 'Rep',
  companyName: 'Rep Co',
  email: 'riley@example.com',
};

const client = {
  fullName: null,
  officerName: null,
  firstName: 'Casey',
  lastName: 'Client',
  companyName: 'Client Co',
  email: 'casey@example.com',
};

function source(overrides: Partial<ListRowSource> = {}): ListRowSource {
  return {
    id: 42,
    fileNumber: '20019922-GLT',
    operationalStatus: 'in_process',
    transactionType: null,
    orderType: 'Title & Escrow',
    productType: 'Residential',
    openedAt: '2026-07-15T18:00:00.000Z',
    closedAt: null,
    property: {
      address: '123 Main St',
      city: 'Glendale',
      state: 'CA',
      zip: '91203',
      fullAddress: null,
    },
    salesRep: repWithParts,
    clientContact: client,
    clientContactId: 99,
    ...overrides,
  };
}

describe('canonical list row projection', () => {
  it('uses the shared contact-name fallback', () => {
    expect(contactName(repWithParts)).toBe('Riley Rep');
    expect(contactName({ ...repWithParts, officerName: 'Officer Name' })).toBe('Officer Name');
    expect(contactName({ ...repWithParts, fullName: 'Full Name' })).toBe('Full Name');
    expect(contactName({ fullName: null, officerName: null, firstName: null, lastName: null, companyName: 'Company Only' })).toBe('Company Only');
  });

  it('uses the canonical transaction type fallback', () => {
    expect(orderTypeLabel({ transactionType: 'Purchase', orderType: 'Escrow', productType: 'Residential' })).toBe('Purchase');
    expect(orderTypeLabel({ transactionType: null, orderType: 'Escrow', productType: 'Residential' })).toBe('Escrow');
    expect(orderTypeLabel({ transactionType: null, orderType: null, productType: 'Residential' })).toBe('Residential');
    expect(orderTypeLabel({ transactionType: null, orderType: null, productType: null })).toBe('—');
  });

  it('formats status, address, and dates through shared P1 formatters', () => {
    const row = projectListRow(source());

    expect(row.status).toEqual({
      value: 'in_process',
      label: 'In Process',
      color: 'bg-amber-50 text-amber-700 border-amber-200',
    });
    expect(row.property?.fullAddress).toBe('123 Main St, Glendale, CA 91203');
    expect(row.address).toBe('123 Main St');
    expect(row.openedAt).toBe('Jul 15, 2026');
    expect(row.closedAt).toBe('—');
  });

  it('derives identical shown fields for admin, sales, and client loader sources', () => {
    const admin = projectListRow(source({ source: 'softpro_sync' }));
    const sales = projectListRow(source());
    const clientRow = projectListRow(source());

    for (const row of [sales, clientRow]) {
      expect(row.salesRepName).toBe(admin.salesRepName);
      expect(row.clientName).toBe(admin.clientName);
      expect(row.clientCompany).toBe(admin.clientCompany);
      expect(row.type).toBe(admin.type);
    }
  });
});
