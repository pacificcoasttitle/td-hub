'use client';

import { AddressAutocomplete } from '@/components/ui/address-autocomplete';
import type { ParsedAddress } from '@/components/ui/address-autocomplete';
import { IN } from './types';
import { SH, FL, Nav } from './shared';

export function StepProperty({ data, onChange, onNext, onPrev }: {
  data: { street: string; city: string; state: string; zip: string; placeId: string; apn: string; county: string; legalDescription: string; siteXLoading: boolean };
  onChange: (d: typeof data) => void; onNext: () => void; onPrev: () => void;
}) {
  function handleSelect(parsed: ParsedAddress) {
    const updated = { ...data, street: parsed.street, city: parsed.city, state: parsed.state, zip: parsed.zip, placeId: parsed.placeId, siteXLoading: true };
    onChange(updated);
    fetch('/api/orders/sitex-lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) })
      .then((r) => r.ok ? r.json() : null)
      .then((res) => onChange({ ...updated, apn: res?.apn ?? updated.apn, county: res?.county ?? updated.county, legalDescription: res?.legalDescription ?? updated.legalDescription, siteXLoading: false }))
      .catch(() => onChange({ ...updated, siteXLoading: false }));
  }
  return (
    <div className="p-5 sm:p-6">
      <SH title="Property" sub="Enter the property address." />
      <div className="space-y-4">
        <div><FL>Address</FL><AddressAutocomplete value={data.street} onChange={(v: string) => onChange({ ...data, street: v })} onSelect={handleSelect} placeholder="Start typing…" /></div>
        <div className="grid grid-cols-3 gap-3">
          <div><FL>City</FL><input className={IN} value={data.city} onChange={(e) => onChange({ ...data, city: e.target.value })} /></div>
          <div><FL>State</FL><input className={IN} value={data.state} onChange={(e) => onChange({ ...data, state: e.target.value })} /></div>
          <div><FL>ZIP</FL><input className={IN} value={data.zip} onChange={(e) => onChange({ ...data, zip: e.target.value })} /></div>
        </div>
        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Details</p>
            {data.siteXLoading && <span className="text-xs text-[#1B2A4A] animate-pulse">Looking up…</span>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><FL>County</FL><input className={IN} value={data.county} onChange={(e) => onChange({ ...data, county: e.target.value })} placeholder="Auto-filled" /></div>
            <div><FL>APN</FL><input className={IN} value={data.apn} onChange={(e) => onChange({ ...data, apn: e.target.value })} placeholder="Auto-filled" /></div>
          </div>
          <div className="mt-3"><FL>Legal Description</FL><textarea value={data.legalDescription} onChange={(e) => onChange({ ...data, legalDescription: e.target.value })} rows={2} className={`${IN} resize-none`} placeholder="Auto-filled" /></div>
        </div>
      </div>
      <Nav onPrev={onPrev} onNext={onNext} nextDisabled={!data.street} />
    </div>
  );
}
