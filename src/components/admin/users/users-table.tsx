'use client';

export interface User {
  id: string;
  displayName: string | null;
  email: string | null;
  role: string;
  branchId: number | null;
  branchCode: string | null;
  branchName: string | null;
  isActive: boolean;
  lastSignInAt: string | null;
  createdAt: string;
}

export const PAGE_SIZE = 25;

export const ALL_ROLES = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'admin', label: 'Admin' },
  { value: 'cs_admin', label: 'CS Admin' },
  { value: 'open_order_team', label: 'Open Order Team' },
  { value: 'escrow_assistant', label: 'Escrow Assistant' },
  { value: 'sales_rep', label: 'Sales Rep' },
  { value: 'title_officer', label: 'Title Officer' },
  { value: 'escrow_officer', label: 'Escrow Officer' },
  { value: 'client', label: 'Client' },
];

export const ROLE_FILTER_OPTIONS = [{ value: '', label: 'All Roles' }, ...ALL_ROLES];

export const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-red-100 text-red-800',
  admin: 'bg-indigo-100 text-indigo-800',
  cs_admin: 'bg-purple-100 text-purple-800',
  open_order_team: 'bg-orange-100 text-orange-800',
  escrow_assistant: 'bg-amber-100 text-amber-800',
  sales_rep: 'bg-sky-100 text-sky-800',
  title_officer: 'bg-teal-100 text-teal-800',
  escrow_officer: 'bg-amber-100 text-amber-800',
  client: 'bg-gray-100 text-gray-700',
};

export function userStatus(u: User): 'active' | 'invited' | 'disabled' {
  if (!u.isActive) return 'disabled';
  return u.lastSignInAt ? 'active' : 'invited';
}

export const STATUS_BADGE: Record<string, { dot: string; text: string; label: string }> = {
  active:   { dot: 'bg-green-500',  text: 'text-green-700', label: 'Active' },
  invited:  { dot: 'bg-amber-500',  text: 'text-amber-700', label: 'Invited' },
  disabled: { dot: 'bg-gray-300',   text: 'text-gray-500',  label: 'Disabled' },
};

export function RoleBadge({ role }: { role: string }) {
  const color = ROLE_COLORS[role] ?? 'bg-gray-100 text-gray-600';
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${color}`}>{role.replace(/_/g, ' ')}</span>;
}

export function ActiveToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const options = [{ value: 'all', label: 'All' }, { value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }];
  return (
    <div className="inline-flex border border-gray-200 rounded-lg overflow-hidden">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`px-3 py-2 text-xs font-medium transition-colors ${value === o.value ? 'bg-[#1B2A4A] text-white' : 'bg-white text-[#6B7280] hover:bg-gray-50'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return '—'; }
}
