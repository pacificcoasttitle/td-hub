interface Property {
  address: string | null;
  city: string | null;
  state: string | null;
  county: string | null;
  fullAddress: string | null;
}

export function PropertyTab({ property }: { property: Property | null }) {
  if (!property) {
    return (
      <div className="p-6 text-center py-12">
        <p className="text-[#6B7280] text-sm">No property information available.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h3 className="text-base font-semibold text-[#1A1A2E] mb-4">Property Details</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-5 gap-x-8">
        <Field label="Address" value={property.address} />
        <Field label="City" value={property.city} />
        <Field label="State" value={property.state} />
        <Field label="County" value={property.county} />
        {property.fullAddress && (
          <div className="sm:col-span-2">
            <Field label="Full Address" value={property.fullAddress} />
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs font-medium text-[#6B7280] mb-0.5">{label}</p>
      <p className="text-sm text-[#1A1A2E]">{value || '—'}</p>
    </div>
  );
}
