'use client';

import type { SellerData } from './types';
import { EMPTY, ORG_TYPES, SEL } from './types';
import { SH, FL, Nav, PF } from './shared';

export function StepSeller({ data, onChange, onNext, onPrev }: {
  data: SellerData;
  onChange: (d: SellerData) => void;
  onNext: () => void;
  onPrev: () => void;
}) {
  const upPrimary = (f: string, v: string) =>
    onChange({ ...data, primary: { ...data.primary, [f]: v } });
  const upSecondary = (f: string, v: string) =>
    onChange({ ...data, secondary: { ...data.secondary, [f]: v } });

  return (
    <div className="p-5 sm:p-6">
      <SH title="Seller Details" sub="Enter the property seller information." />

      {data.siteXFilled && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-green-50 border border-green-200 rounded-lg mb-5">
          <svg className="h-4 w-4 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-sm text-green-700 font-medium">Auto-filled from property records</p>
        </div>
      )}

      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Primary Seller</p>
          <label className="flex items-center gap-2 min-h-[44px]">
            <input
              type="checkbox"
              checked={data.isOrg}
              onChange={(e) => onChange({ ...data, isOrg: e.target.checked })}
              className="rounded border-gray-300 text-[#F26B2B] h-4 w-4 focus:ring-[#F26B2B]/40"
            />
            <span className="text-xs text-[#6B7280]">Organization</span>
          </label>
        </div>
        {data.isOrg && (
          <div className="mb-3">
            <FL>Organization Type</FL>
            <select
              value={data.orgType}
              onChange={(e) => onChange({ ...data, orgType: e.target.value })}
              className={SEL}
            >
              <option value="">Select…</option>
              {ORG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
        <PF person={data.primary} onChange={upPrimary} />
      </div>

      {!data.hasSecondary ? (
        <button
          onClick={() => onChange({ ...data, hasSecondary: true })}
          className="text-sm font-medium text-[#1B2A4A] min-h-[44px] flex items-center gap-1"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add secondary seller
        </button>
      ) : (
        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Secondary Seller</p>
            <button
              onClick={() => onChange({ ...data, hasSecondary: false, secondary: { ...EMPTY } })}
              className="text-xs text-red-500 min-h-[44px]"
            >
              Remove
            </button>
          </div>
          <PF person={data.secondary} onChange={upSecondary} />
        </div>
      )}

      <Nav onPrev={onPrev} onNext={onNext} />
    </div>
  );
}
