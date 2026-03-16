'use client';

import { useState } from 'react';

export interface SiteXPropertyResult {
  apn: string | null;
  county: string | null;
  legalDescription: string | null;
  propertyType: string | null;
  primaryOwner: string | null;
  secondaryOwner: string | null;
  fullAddress: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  unitNumber: string | null;
}

interface SiteXLocation {
  address: string;
  city: string;
  state: string;
  zip: string;
  apn: string;
}

interface PropertyConfirmModalProps {
  open: boolean;
  address: { street: string; city: string; state: string; zip: string };
  onConfirm: (property: SiteXPropertyResult) => void;
  onNoMatch: () => void;
  onReject: () => void;
  accentColor?: string;
}

type ModalState = 'confirm' | 'loading' | 'multi' | 'not-found';

export function PropertyConfirmModal({
  open,
  address,
  onConfirm,
  onNoMatch,
  onReject,
  accentColor = '#F26B2B',
}: PropertyConfirmModalProps) {
  const [state, setState] = useState<ModalState>('confirm');
  const [locations, setLocations] = useState<SiteXLocation[]>([]);
  const [pickingIndex, setPickingIndex] = useState<number | null>(null);

  if (!open) return null;

  const formatted = [address.street, address.city, address.state, address.zip]
    .filter(Boolean)
    .join(', ');

  const isOrange = accentColor === '#F26B2B';
  const hoverColor = isOrange ? '#E05A1A' : '#B8953D';

  async function handleConfirm() {
    setState('loading');
    try {
      const res = await fetch('/api/property/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'address', ...address }),
      });
      const data = await res.json();

      if (data.match === 'single' && data.property) {
        onConfirm(data.property);
        resetState();
      } else if (data.match === 'multi' && data.locations?.length > 0) {
        setLocations(data.locations);
        setState('multi');
      } else {
        setState('not-found');
      }
    } catch {
      setState('not-found');
    }
  }

  async function handlePickLocation(loc: SiteXLocation, index: number) {
    setPickingIndex(index);
    try {
      const payload = loc.apn
        ? { mode: 'apn' as const, apn: loc.apn, county: '', state: loc.state || 'CA' }
        : { mode: 'address' as const, street: loc.address, city: loc.city, state: loc.state || 'CA', zip: loc.zip };

      const res = await fetch('/api/property/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.match === 'single' && data.property) {
        onConfirm(data.property);
        resetState();
      } else {
        onConfirm({
          apn: loc.apn || null,
          county: null,
          legalDescription: null,
          propertyType: null,
          primaryOwner: null,
          secondaryOwner: null,
          fullAddress: loc.address,
          city: loc.city,
          state: loc.state,
          zip: loc.zip,
          unitNumber: null,
        });
        resetState();
      }
    } catch {
      setState('not-found');
    } finally {
      setPickingIndex(null);
    }
  }

  function resetState() {
    setState('confirm');
    setLocations([]);
    setPickingIndex(null);
  }

  function handleReject() {
    resetState();
    onReject();
  }

  function handleNotFoundClose() {
    resetState();
    onNoMatch();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/50"
        onClick={state === 'loading' ? undefined : handleReject}
      />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
        {state === 'confirm' && (
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-[#1B2A4A]/10 flex items-center justify-center flex-shrink-0">
                <svg className="h-5 w-5 text-[#1B2A4A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-[#1B2A4A]">
                Is this the correct property?
              </h3>
            </div>
            <p className="text-lg font-medium text-[#1B2A4A] bg-[#F3F4F6] rounded-lg px-4 py-3 mb-6">
              {formatted}
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleConfirm}
                className="flex-1 px-4 py-3 text-sm font-medium text-white rounded-lg transition-colors h-12"
                style={{ backgroundColor: accentColor }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = hoverColor)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = accentColor)}
              >
                Yes, this is correct
              </button>
              <button
                onClick={handleReject}
                className="flex-1 px-4 py-3 text-sm font-medium border border-[#E5E7EB] text-[#4B5563] rounded-lg hover:bg-[#F3F4F6] transition-colors h-12"
              >
                No, search again
              </button>
            </div>
          </div>
        )}

        {state === 'loading' && (
          <div className="p-8 text-center">
            <div
              className="w-10 h-10 border-[3px] border-[#E5E7EB] rounded-full mx-auto mb-4 animate-spin"
              style={{ borderTopColor: accentColor }}
            />
            <p className="text-sm font-medium text-[#1B2A4A]">Looking up property details…</p>
            <p className="text-xs text-[#6B7280] mt-1">Searching county records</p>
          </div>
        )}

        {state === 'multi' && (
          <div className="p-6">
            <h3 className="text-lg font-semibold text-[#1B2A4A] mb-1">
              Multiple properties found
            </h3>
            <p className="text-sm text-[#6B7280] mb-4">
              Select the correct property from the list below.
            </p>
            <div className="max-h-80 overflow-y-auto space-y-2">
              {locations.map((loc, i) => (
                <button
                  key={i}
                  onClick={() => handlePickLocation(loc, i)}
                  disabled={pickingIndex !== null}
                  className="w-full text-left px-4 py-3 rounded-lg border border-[#E5E7EB] hover:border-[#1B2A4A]/30 transition-colors disabled:opacity-50 min-h-[44px]"
                >
                  <p className="text-sm font-medium text-[#1B2A4A]">
                    {[loc.address, loc.city, loc.state, loc.zip].filter(Boolean).join(', ')}
                  </p>
                  {loc.apn && (
                    <p className="text-xs text-[#6B7280] mt-0.5">APN: {loc.apn}</p>
                  )}
                  {pickingIndex === i && (
                    <p className="text-xs mt-1 animate-pulse" style={{ color: accentColor }}>
                      Loading details…
                    </p>
                  )}
                </button>
              ))}
            </div>
            <button
              onClick={handleReject}
              className="mt-4 w-full px-4 py-3 text-sm font-medium border border-[#E5E7EB] text-[#4B5563] rounded-lg hover:bg-[#F3F4F6] transition-colors h-12"
            >
              None of these — search again
            </button>
          </div>
        )}

        {state === 'not-found' && (
          <div className="p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4">
              <svg className="h-6 w-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-[#1B2A4A] mb-1">Property not found</h3>
            <p className="text-sm text-[#6B7280] mb-6">
              We couldn&apos;t find this property in county records. You can enter details manually.
            </p>
            <button
              onClick={handleNotFoundClose}
              className="px-6 py-3 text-sm font-medium text-white rounded-lg transition-colors h-12"
              style={{ backgroundColor: accentColor }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = hoverColor)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = accentColor)}
            >
              Enter details manually
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
