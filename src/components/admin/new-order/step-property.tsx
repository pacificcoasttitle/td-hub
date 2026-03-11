import { AddressAutocomplete } from '@/components/ui/address-autocomplete';
import type { ParsedAddress } from '@/components/ui/address-autocomplete';
import type { PropertyData } from './types';
import { INPUT_CLASS } from './constants';
import { FieldLabel, StepHeader, StepNav } from './shared';

export function Step2Property({
  data, onChange, onNext, onPrev,
}: {
  data: PropertyData; onChange: (d: PropertyData) => void; onNext: () => void; onPrev: () => void;
}) {
  function handleAddressSelect(parsed: ParsedAddress) {
    const updated = { ...data, street: parsed.street, city: parsed.city, state: parsed.state, zip: parsed.zip, placeId: parsed.placeId };
    onChange(updated);
    triggerSiteXLookup(parsed, onChange, updated);
  }

  return (
    <div className="p-6">
      <StepHeader title="Property" sub="Enter the property address — we'll look up details automatically." />

      <div className="space-y-4">
        <div>
          <FieldLabel>Address</FieldLabel>
          <AddressAutocomplete
            value={data.street}
            onChange={(v) => onChange({ ...data, street: v })}
            onSelect={handleAddressSelect}
            placeholder="Start typing an address…"
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <FieldLabel>City</FieldLabel>
            <input className={INPUT_CLASS} value={data.city} onChange={(e) => onChange({ ...data, city: e.target.value })} placeholder="City" />
          </div>
          <div>
            <FieldLabel>State</FieldLabel>
            <input className={INPUT_CLASS} value={data.state} onChange={(e) => onChange({ ...data, state: e.target.value })} placeholder="CA" />
          </div>
          <div>
            <FieldLabel>ZIP</FieldLabel>
            <input className={INPUT_CLASS} value={data.zip} onChange={(e) => onChange({ ...data, zip: e.target.value })} placeholder="ZIP" />
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4 mt-4">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Property Details</p>
            {data.siteXLoading && (
              <span className="inline-flex items-center gap-1 text-xs text-[#C5A55A]">
                <svg className="h-3 w-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Looking up property…
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>County</FieldLabel>
              <input className={INPUT_CLASS} value={data.county} onChange={(e) => onChange({ ...data, county: e.target.value })} placeholder="Auto-filled from lookup" />
            </div>
            <div>
              <FieldLabel>APN</FieldLabel>
              <input className={INPUT_CLASS} value={data.apn} onChange={(e) => onChange({ ...data, apn: e.target.value })} placeholder="Auto-filled from lookup" />
            </div>
          </div>
          <div className="mt-4">
            <FieldLabel>Legal Description</FieldLabel>
            <textarea
              value={data.legalDescription}
              onChange={(e) => onChange({ ...data, legalDescription: e.target.value })}
              placeholder="Auto-filled from lookup"
              rows={3}
              className={`${INPUT_CLASS} resize-none`}
            />
          </div>
        </div>
      </div>

      <StepNav onPrev={onPrev} onNext={onNext} nextDisabled={!data.street} />
    </div>
  );
}

function triggerSiteXLookup(parsed: ParsedAddress, onChange: (d: PropertyData) => void, current: PropertyData) {
  onChange({ ...current, siteXLoading: true });
  fetch('/api/orders/sitex-lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed),
  })
    .then((r) => r.ok ? r.json() : null)
    .then((result) => {
      if (result) {
        onChange({
          ...current,
          apn: result.apn ?? current.apn,
          county: result.county ?? current.county,
          legalDescription: result.legalDescription ?? current.legalDescription,
          siteXLoading: false,
        });
      } else {
        onChange({ ...current, siteXLoading: false });
      }
    })
    .catch(() => onChange({ ...current, siteXLoading: false }));
}
