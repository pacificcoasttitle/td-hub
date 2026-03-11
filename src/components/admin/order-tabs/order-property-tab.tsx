'use client';

import { useState } from 'react';
import { SectionHeading, FieldRow } from './order-overview-tab';
import { AddressAutocomplete } from '@/components/ui/address-autocomplete';
import type { ParsedAddress } from '@/components/ui/address-autocomplete';

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

export function OrderPropertyTab({
  property,
  orderId,
}: {
  property: OrderProperty | null;
  orderId: number;
}) {
  const [lookupOpen, setLookupOpen] = useState(false);

  if (!property) {
    return (
      <div className="p-12 text-center">
        <p className="text-sm text-[#6B7280]">No property data available for this order.</p>
        <button
          onClick={() => setLookupOpen(true)}
          className="mt-3 px-4 py-2 text-sm font-medium border border-gray-200 text-[#1B2A4A] rounded-lg hover:bg-gray-50 transition-colors"
        >
          Look up property
        </button>
        {lookupOpen && (
          <PropertyLookupModal
            orderId={orderId}
            onClose={() => setLookupOpen(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <SectionHeading>Property Information</SectionHeading>
        <button
          onClick={() => setLookupOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 text-[#1B2A4A] rounded-lg hover:bg-gray-50 transition-colors"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Look up property
        </button>
      </div>
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
      {lookupOpen && (
        <PropertyLookupModal
          orderId={orderId}
          onClose={() => setLookupOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Property Lookup Modal ──────────────────────────────────────────────────

function PropertyLookupModal({
  orderId,
  onClose,
}: {
  orderId: number;
  onClose: () => void;
}) {
  const [inputValue, setInputValue] = useState('');
  const [selected, setSelected] = useState<ParsedAddress | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  function handleSelect(parsed: ParsedAddress) {
    setSelected(parsed);
    setInputValue(parsed.street);
    setResult(null);
  }

  async function handleConfirm() {
    if (!selected) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/property-lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selected),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Lookup failed (${res.status})`);
      }
      setResult({ type: 'success', message: 'Property data updated. Refresh to see changes.' });
    } catch (err) {
      setResult({ type: 'error', message: err instanceof Error ? err.message : 'Property lookup failed' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-[#1A1A2E]">Look Up Property Address</h3>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#1A1A2E] transition-colors">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5">
          <p className="text-sm text-[#6B7280] mb-3">
            Search for a US address. Selecting one will initiate a property data lookup.
          </p>

          <AddressAutocomplete
            value={inputValue}
            onChange={setInputValue}
            onSelect={handleSelect}
            placeholder="Start typing an address…"
            autoFocus
          />

          {selected && (
            <div className="mt-4 bg-gray-50 rounded-lg border border-gray-200 p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-[#6B7280] mb-2">Selected Address</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-[#6B7280]">Street</p>
                  <p className="font-medium text-[#1A1A2E]">{selected.street || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-[#6B7280]">City</p>
                  <p className="font-medium text-[#1A1A2E]">{selected.city || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-[#6B7280]">State</p>
                  <p className="font-medium text-[#1A1A2E]">{selected.state || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-[#6B7280]">ZIP</p>
                  <p className="font-medium text-[#1A1A2E]">{selected.zip || '—'}</p>
                </div>
              </div>
            </div>
          )}

          {result && (
            <div className={`mt-4 px-4 py-3 rounded-lg text-sm ${
              result.type === 'success'
                ? 'bg-green-50 border border-green-200 text-green-700'
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}>
              {result.message}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium border border-gray-200 text-[#6B7280] rounded-lg hover:bg-gray-50 transition-colors"
          >
            {result?.type === 'success' ? 'Close' : 'Cancel'}
          </button>
          {(!result || result.type === 'error') && (
            <button
              onClick={handleConfirm}
              disabled={!selected || submitting}
              className="px-4 py-2 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Looking up…' : 'Confirm & Look Up'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
