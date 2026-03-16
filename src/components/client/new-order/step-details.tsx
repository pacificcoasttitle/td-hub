'use client';

import type { ClientDetails, Profile } from './types';
import { CLIENT_TYPES, SEL } from './types';
import { SH, FL, Nav } from './shared';

export function StepDetails({ profile, data, onChange, onNext }: {
  profile: Profile | null;
  data: ClientDetails;
  onChange: (d: ClientDetails) => void;
  onNext: () => void;
}) {
  return (
    <div className="p-5 sm:p-6">
      <SH title="Your Details" sub="Confirm your information for this order." />

      {profile && (
        <div className="bg-[#F3F4F6] rounded-xl p-4 mb-6 flex items-center gap-4">
          <div className="w-11 h-11 bg-[#1B2A4A] rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-white text-sm font-bold">
              {profile.displayName?.charAt(0)?.toUpperCase() ?? 'U'}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#1B2A4A]">{profile.displayName}</p>
            <p className="text-xs text-[#6B7280] truncate">{profile.email}</p>
            {(profile.phone || profile.company) && (
              <p className="text-xs text-[#6B7280] truncate">
                {[profile.phone, profile.company].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <FL>Client Type</FL>
          <select
            value={data.clientType}
            onChange={(e) => onChange({ ...data, clientType: e.target.value })}
            className={SEL}
          >
            {CLIENT_TYPES.map((ct) => (
              <option key={ct.value} value={ct.value}>{ct.label}</option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-3 cursor-pointer py-2 min-h-[44px]">
          <input
            type="checkbox"
            checked={data.emailNotifications}
            onChange={(e) => onChange({ ...data, emailNotifications: e.target.checked })}
            className="rounded border-[#E5E7EB] text-[#F26B2B] focus:ring-[#F26B2B]/40 h-5 w-5"
          />
          <div>
            <p className="text-sm font-medium text-[#1B2A4A]">Email Notifications</p>
            <p className="text-xs text-[#6B7280]">Receive email updates about this order</p>
          </div>
        </label>
      </div>

      <Nav onNext={onNext} />
    </div>
  );
}
