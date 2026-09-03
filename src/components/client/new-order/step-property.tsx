'use client';

import { useState } from 'react';
import { AddressAutocomplete } from '@/components/ui/address-autocomplete';
import type { ParsedAddress } from '@/components/ui/address-autocomplete';
import { PropertyConfirmModal, type SiteXPropertyResult } from '@/components/shared/property-confirm-modal';
import type { PropertyData } from './types';
import { IN } from './types';
import { SH, FL, Nav } from './shared';

interface StepPropertyProps {
  data: PropertyData;
  onChange: (d: PropertyData) => void;
  /** Fired after a SiteX single match is applied — parent runs shared pre-init. */
  onSiteXResult?: (result: SiteXPropertyResult, propertyAfter: PropertyData) => void;
  /** No usable SiteX match — parent clears pre-init gate (no-match grace). */
  onNoSiteXMatch?: () => void;
  onNext: () => void;
  onPrev: () => void;
}

export function StepProperty({ data, onChange, onSiteXResult, onNoSiteXMatch, onNext, onPrev }: StepPropertyProps) {
  const [showModal, setShowModal] = useState(false);
  const [pendingAddress, setPendingAddress] = useState<ParsedAddress | null>(null);
  const [noMatchMessage, setNoMatchMessage] = useState('');
  const [apnSearching, setApnSearching] = useState(false);

  function handleAddressSelect(parsed: ParsedAddress) {
    setPendingAddress(parsed);
    onChange({ ...data, street: parsed.street, city: parsed.city, state: parsed.state, zip: parsed.zip, placeId: parsed.placeId });
    setShowModal(true);
    setNoMatchMessage('');
  }

  function handleConfirm(property: SiteXPropertyResult) {
    setShowModal(false);
    const updated: PropertyData = {
      ...data,
      apn: property.apn ?? data.apn,
      county: property.county ?? data.county,
      legalDescription: property.legalDescription ?? data.legalDescription,
      propertyType: property.propertyType ?? data.propertyType,
      unitNumber: property.unitNumber ?? data.unitNumber,
      siteXFilled: true,
    };
    if (property.fullAddress) updated.street = property.fullAddress;
    if (property.city) updated.city = property.city;
    if (property.state) updated.state = property.state;
    if (property.zip) updated.zip = property.zip;
    onChange(updated);
    onSiteXResult?.(property, updated);
  }

  function handleNoMatch() {
    setShowModal(false);
    setNoMatchMessage('Property not found in county records — you can enter details manually.');
    onNoSiteXMatch?.();
  }

  function handleReject() {
    setShowModal(false);
    onChange({ ...data, street: '', city: '', state: '', zip: '', placeId: '' });
  }

  async function handleApnSearch() {
    if (!data.apn || !data.county) return;
    setApnSearching(true);
    setNoMatchMessage('');
    try {
      const res = await fetch('/api/property/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'apn', apn: data.apn, county: data.county }),
      });
      const result = await res.json();
      if (result.match === 'single' && result.property) {
        const p = result.property as SiteXPropertyResult;
        const updated: PropertyData = {
          ...data,
          street: p.fullAddress ?? data.street,
          city: p.city ?? data.city,
          state: p.state ?? data.state,
          zip: p.zip ?? data.zip,
          county: p.county ?? data.county,
          legalDescription: p.legalDescription ?? data.legalDescription,
          propertyType: p.propertyType ?? data.propertyType,
          unitNumber: p.unitNumber ?? data.unitNumber,
          siteXFilled: true,
        };
        onChange(updated);
        onSiteXResult?.(p, updated);
      } else if (result.match === 'error') {
        // Not "no property" — we never got an answer. See the API route.
        setNoMatchMessage('The property search could not be completed. Please try again, or enter the address manually.');
        onNoSiteXMatch?.();
      } else {
        setNoMatchMessage('No property found for this APN.');
        onNoSiteXMatch?.();
      }
    } catch {
      setNoMatchMessage('The property search could not be completed. Please try again, or enter the address manually.');
      onNoSiteXMatch?.();
    } finally {
      setApnSearching(false);
    }
  }

  function handleSearchClick() {
    if (data.street && data.city && data.state && data.zip) {
      setPendingAddress({ street: data.street, city: data.city, state: data.state, zip: data.zip, placeId: data.placeId });
      setShowModal(true);
      setNoMatchMessage('');
    }
  }

  return (
    <div className="p-5 sm:p-6">
      <SH title="Find Your Property" sub="Search by address or APN to auto-fill property details." />

      <div className="flex gap-2 mb-5">
        <button
          onClick={() => onChange({ ...data, searchMode: 'address' })}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors min-h-[40px] ${
            data.searchMode === 'address'
              ? 'bg-[#1B2A4A] text-white'
              : 'bg-[#F3F4F6] text-[#4B5563] hover:bg-[#E5E7EB]'
          }`}
        >
          Search by Address
        </button>
        <button
          onClick={() => onChange({ ...data, searchMode: 'apn' })}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors min-h-[40px] ${
            data.searchMode === 'apn'
              ? 'bg-[#1B2A4A] text-white'
              : 'bg-[#F3F4F6] text-[#4B5563] hover:bg-[#E5E7EB]'
          }`}
        >
          Search by APN
        </button>
      </div>

      <div className="space-y-4">
        {data.searchMode === 'address' ? (
          <>
            <div>
              <FL>Address</FL>
              <div className="flex gap-2">
                <div className="flex-1">
                  <AddressAutocomplete
                    value={data.street}
                    onChange={(v: string) => onChange({ ...data, street: v })}
                    onSelect={handleAddressSelect}
                    placeholder="Start typing an address…"
                  />
                </div>
                <button
                  onClick={handleSearchClick}
                  disabled={!data.street || !data.city}
                  className="px-4 py-2 text-sm font-medium bg-[#F26B2B] text-white rounded-lg hover:bg-[#E05A1A] disabled:opacity-50 transition-colors h-12 flex-shrink-0"
                >
                  Search
                </button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><FL>City</FL><input className={IN} value={data.city} onChange={(e) => onChange({ ...data, city: e.target.value })} /></div>
              <div><FL>State</FL><input className={IN} value={data.state} onChange={(e) => onChange({ ...data, state: e.target.value })} /></div>
              <div><FL>ZIP</FL><input className={IN} value={data.zip} onChange={(e) => onChange({ ...data, zip: e.target.value })} /></div>
            </div>
          </>
        ) : (
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <FL>APN</FL>
              <input className={IN} value={data.apn} onChange={(e) => onChange({ ...data, apn: e.target.value })} placeholder="e.g. 1234-567-890" />
            </div>
            <div className="flex-1">
              <FL>County</FL>
              <input className={IN} value={data.county} onChange={(e) => onChange({ ...data, county: e.target.value })} placeholder="e.g. Los Angeles" />
            </div>
            <button
              onClick={handleApnSearch}
              disabled={!data.apn || !data.county || apnSearching}
              className="px-4 py-2 text-sm font-medium bg-[#F26B2B] text-white rounded-lg hover:bg-[#E05A1A] disabled:opacity-50 transition-colors h-12 flex-shrink-0"
            >
              {apnSearching ? 'Searching…' : 'Search'}
            </button>
          </div>
        )}

        {noMatchMessage && (
          <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
            <svg className="h-4 w-4 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-amber-700">{noMatchMessage}</p>
          </div>
        )}

        {(data.apn || data.county || data.legalDescription || data.propertyType) && (
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Property Details</p>
              {data.siteXFilled && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-xs font-medium text-green-700">
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  Auto-filled from county records
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><FL>County</FL><input className={IN} value={data.county} onChange={(e) => onChange({ ...data, county: e.target.value })} placeholder="County" /></div>
              <div><FL>APN</FL><input className={IN} value={data.apn} onChange={(e) => onChange({ ...data, apn: e.target.value })} placeholder="APN" /></div>
              <div><FL>Property Type</FL><input className={IN} value={data.propertyType} onChange={(e) => onChange({ ...data, propertyType: e.target.value })} placeholder="Property type" /></div>
              <div />
            </div>
            <div className="mt-3">
              <FL>Legal Description</FL>
              <textarea
                value={data.legalDescription}
                onChange={(e) => onChange({ ...data, legalDescription: e.target.value })}
                rows={2}
                className={`${IN} resize-none`}
                placeholder="Legal description"
              />
            </div>
          </div>
        )}
      </div>

      <Nav onPrev={onPrev} onNext={onNext} nextDisabled={!data.street && !data.apn} />

      <PropertyConfirmModal
        open={showModal}
        address={pendingAddress ?? { street: '', city: '', state: '', zip: '' }}
        onConfirm={handleConfirm}
        onNoMatch={handleNoMatch}
        onReject={handleReject}
      />
    </div>
  );
}
