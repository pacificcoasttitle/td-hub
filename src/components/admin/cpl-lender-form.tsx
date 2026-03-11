'use client';

import { FormField } from './step-select-order';
import { AddressAutocomplete } from '@/components/ui/address-autocomplete';
import type { ParsedAddress } from '@/components/ui/address-autocomplete';

export interface LenderInfo {
  companyName: string;
  contactName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  assignmentClause: string;
}

export function CplLenderForm({
  lender, setLender, onProceed,
}: {
  lender: LenderInfo; setLender: (l: LenderInfo) => void; onProceed: () => void;
}) {
  function update(field: keyof LenderInfo, value: string) {
    setLender({ ...lender, [field]: value });
  }

  function handleAddressSelect(parsed: ParsedAddress) {
    setLender({
      ...lender,
      address: parsed.street,
      city: parsed.city,
      state: parsed.state,
      zip: parsed.zip,
    });
  }

  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-[#1A1A2E] mb-1">Lender Information</h3>
      <p className="text-sm text-[#6B7280] mb-4">Override lender details if needed. Leave blank to use data from the order.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Company Name" value={lender.companyName} onChange={(v) => update('companyName', v)} placeholder="Auto from order" />
        <FormField label="Contact Name" value={lender.contactName} onChange={(v) => update('contactName', v)} placeholder="Auto from order" />
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-[#6B7280] mb-1">Address</label>
          <AddressAutocomplete
            value={lender.address}
            onChange={(v) => update('address', v)}
            onSelect={handleAddressSelect}
            placeholder="Start typing to search, or enter manually"
          />
        </div>
        <FormField label="City" value={lender.city} onChange={(v) => update('city', v)} placeholder="Auto from order" />
        <div className="grid grid-cols-2 gap-4">
          <FormField label="State" value={lender.state} onChange={(v) => update('state', v)} placeholder="CA" />
          <FormField label="ZIP" value={lender.zip} onChange={(v) => update('zip', v)} placeholder="Auto from order" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-[#6B7280] mb-1">Assignment Clause</label>
          <textarea
            value={lender.assignmentClause}
            onChange={(e) => update('assignmentClause', e.target.value)}
            placeholder="Optional — auto from order if available"
            rows={2}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] placeholder:text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A] bg-white resize-none"
          />
        </div>
      </div>
      <div className="mt-6 flex justify-end">
        <button onClick={onProceed} className="px-5 py-2.5 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] transition-colors">
          Continue to Generate
        </button>
      </div>
    </div>
  );
}
