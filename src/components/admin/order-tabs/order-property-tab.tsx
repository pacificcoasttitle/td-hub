'use client';

import { SectionHeading, FieldRow } from './order-overview-tab';

interface OrderProperty {
  address: string | null;
  city: string | null;
  state: string | null;
  county: string | null;
  fullAddress: string | null;
  apn: string | null;
  legalDescription: string | null;
  propertyType: string | null;
  zip: string | null;
}

export function OrderPropertyTab({ property }: { property: OrderProperty | null }) {
  if (!property) {
    return (
      <div className="p-12 text-center">
        <p className="text-sm text-[#6B7280]">No property data available for this order.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <SectionHeading>Property Information</SectionHeading>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-5">
        <FieldRow label="Address" value={property.address} />
        <FieldRow label="City" value={property.city} />
        <FieldRow label="State" value={property.state} />
        <FieldRow label="ZIP" value={property.zip} />
        <FieldRow label="County" value={property.county} />
        <FieldRow label="APN" value={property.apn} />
        <FieldRow label="Property Type" value={property.propertyType} />
        <FieldRow label="Full Address" value={property.fullAddress} />
      </div>
      {property.legalDescription && (
        <div className="pt-2">
          <SectionHeading>Legal Description</SectionHeading>
          <p className="text-sm text-[#1A1A2E] mt-2 leading-relaxed whitespace-pre-wrap">
            {property.legalDescription}
          </p>
        </div>
      )}
    </div>
  );
}
