import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoftProOrderContactsData } from '@/lib/integrations/softpro/types';

const getOrderContactsMock = vi.fn();
const selectLimitMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const insertValuesMock = vi.fn();
const resolveClientContactIdMock = vi.fn();

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  isNull: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

vi.mock('@/lib/db/schema', () => ({
  orders: {
    id: 'orders.id',
    fileNumber: 'orders.file_number',
    orderType: 'orders.order_type',
    updatedAt: 'orders.updated_at',
    contactsEmptyConfirmed: 'orders.contacts_empty_confirmed',
    lenderId: 'orders.lender_id',
    listingAgentId: 'orders.listing_agent_id',
    titleCompanyId: 'orders.title_company_id',
    underwriterId: 'orders.underwriter_id',
    clientContactId: 'orders.client_contact_id',
    lastContactsFetchAt: 'orders.last_contacts_fetch_at',
  },
  orderParties: {
    id: 'order_parties.id',
    orderId: 'order_parties.order_id',
    role: { enumValues: ['buyer', 'seller', 'lender', 'listing_agent', 'escrow_company', 'lender_contact', 'other'] },
    isPrimary: 'order_parties.is_primary',
  },
  contacts: {
    id: 'contacts.id',
    lookupCode: 'contacts.lookup_code',
    softproLookupCode: 'contacts.softpro_lookup_code',
    sourceId: 'contacts.source_id',
    fullName: 'contacts.full_name',
    email: 'contacts.email',
    phone: 'contacts.phone',
    companyName: 'contacts.company_name',
    flookupCode: 'contacts.flookup_code',
    isRealEstateAgent: 'contacts.is_real_estate_agent',
  },
  companies: {
    id: 'companies.id',
    lookupCode: 'companies.lookup_code',
    sourceId: 'companies.source_id',
    name: 'companies.name',
    email: 'companies.email',
    phone: 'companies.phone',
    isRealEstateCompany: 'companies.is_real_estate_company',
  },
  vendorApiLogs: {},
}));

vi.mock('@/lib/integrations/softpro', async () => {
  const mapper = await vi.importActual<typeof import('../../integrations/softpro/mapper')>(
    '../../integrations/softpro/mapper',
  );

  return {
    mapOrderContacts: mapper.mapOrderContacts,
    getOrderContacts: getOrderContactsMock,
  };
});

vi.mock('@/lib/domain/orders/client-resolver', () => ({
  resolveClientContactId: resolveClientContactIdMock,
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: selectLimitMock,
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: updateSetMock,
    })),
    insert: vi.fn(() => ({
      values: insertValuesMock,
    })),
  },
}));

const softProEmptyContactsPayload: SoftProOrderContactsData = {
  buyer: {
    Person: {
      LookupCode: null,
      Name: null,
      Email: null,
      Phone: null,
      PrimaryBorrower: null,
      SecondaryBorrower: null,
    },
    Company: null,
    PrimaryBorrower: null,
    SecondaryBorrower: null,
    PreimaryBorrower: null,
  },
  Sellers: {
    PrimarySeller: null,
    SecondarySeller: null,
    PreimarySeller: null,
  },
  EscrowCompanies: {
    Company: null,
    Person: null,
    CompanyLookUpCode: null,
    PersonLookupCode: null,
  },
  Lenders: {
    Company: null,
    Person: null,
    CompanyLookUpCode: null,
    PersonLookupCode: null,
  },
  ListingAgentBrokers: {
    Company: null,
    Person: null,
    CompanyLookUpCode: null,
    PersonLookupCode: null,
  },
  MortgageBrokers: {
    Company: null,
    Person: null,
    CompanyLookUpCode: null,
    PersonLookupCode: null,
  },
  PayoffLenders: {
    Company: null,
    Person: null,
    CompanyLookUpCode: null,
    PersonLookupCode: null,
  },
  TitleCompanies: {
    Company: null,
    Person: null,
    CompanyLookUpCode: null,
    PersonLookupCode: null,
  },
  Underwriters: {
    Company: null,
    Person: null,
    CompanyLookUpCode: null,
    PersonLookupCode: null,
  },
};

describe('enrichSingleOrder empty contact confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectLimitMock.mockResolvedValue([
      { id: 123, fileNumber: 'EMPTY-REAL-SOFTPRO', orderType: 'Sale' },
    ]);
    updateSetMock.mockReturnValue({ where: updateWhereMock });
    updateWhereMock.mockResolvedValue(undefined);
    insertValuesMock.mockResolvedValue(undefined);
    resolveClientContactIdMock.mockResolvedValue(null);
    getOrderContactsMock.mockResolvedValue({
      success: true,
      data: softProEmptyContactsPayload,
    });
  });

  it('marks an order empty_confirmed when SoftPro returns section labels with null values', async () => {
    const { enrichSingleOrder } = await import('./enrich-orders');

    const result = await enrichSingleOrder(123);

    expect(result).toMatchObject({
      success: true,
      orderId: 123,
      fileNumber: 'EMPTY-REAL-SOFTPRO',
      outcome: 'empty_confirmed',
      contactsEmptyConfirmed: true,
      partiesWritten: 0,
    });
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ contactsEmptyConfirmed: true }),
    );
  });
});
