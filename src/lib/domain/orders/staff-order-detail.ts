import type { OrderReadModel } from './read-model';

/**
 * Flat staff order detail shape consumed by:
 * - Admin full page (`/orders/[id]`)
 * - CplModal (lenderContact / cplData / underwriter extras attached by the route)
 *
 * Derived exclusively from getOrderReadModel + applyVisibility('staff').
 * Does not invent nulls for fields the UI already shows (P3-2).
 */
export function mapStaffOrderDetailResponse(model: OrderReadModel) {
  const county = model.property.county === '—' ? null : model.property.county;

  return {
    id: model.id,
    fileNumber: model.fileNumber,
    operationalStatus: model.status.value,
    softproStatus: model.softproStatus,
    softproLastSyncedAt: model.softproLastSyncedAt,
    transactionType: model.transactionType,
    productType: model.productType,
    orderType: model.orderType,
    source: model.source,
    marketingSource: model.marketingSource,
    openedAt: model.dates.openedAtIso,
    completedAt: model.dates.completedAtIso,
    closedAt: model.dates.closedAtIso,
    salesPrice: model.financials.salesPrice,
    loanAmount: model.financials.loanAmount,
    isImported: model.isImported,
    createdAt: model.dates.createdAtIso,
    updatedAt: model.dates.updatedAtIso,
    branchId: model.branchId,
    lenderId: model.lenderId,
    underwriterId: model.underwriterId,
    createdByName: model.assignments.createdBy?.name ?? null,
    property: model.property.line1 || model.property.city || model.property.addressFormatted !== '—'
      ? {
          address: model.property.line1,
          city: model.property.city,
          state: model.property.state,
          zip: model.property.zip,
          county,
          apn: model.property.apn,
          legalDescription: model.property.legalDescription,
          propertyType: model.property.propertyType,
          fullAddress: model.property.addressFormatted === '—'
            ? null
            : model.property.addressFormatted,
          primaryOwner: model.property.primaryOwner,
          secondaryOwner: model.property.secondaryOwner,
        }
      : null,
    parties: model.parties.map((party) => ({
      role: party.role,
      isPrimary: party.isPrimary,
      externalName: party.name,
      externalCompany: party.company,
      externalEmail: party.email,
      externalPhone: party.phone,
    })),
    statusHistory: model.statusHistory,
    documents: {
      prelim: { exists: model.documents.prelimAvailable },
    },
  };
}

export type StaffOrderDetailResponse = ReturnType<typeof mapStaffOrderDetailResponse>;
