export const CATEGORY_LABELS: Record<string, string> = {
  cpl: 'CPL',
  proposed_insured: 'Proposed Insured',
  prelim: 'Prelim',
  policy: 'Policy',
  legal_vesting: 'Legal Vesting',
  grant_deed: 'Grant Deed',
  tax: 'Tax',
  general: 'General',
  user_upload: 'Upload',
  curative: 'Curative',
  supporting: 'Supporting',
};

export const CATEGORY_STYLES: Record<string, string> = {
  cpl: 'bg-purple-100 text-purple-700',
  proposed_insured: 'bg-teal-100 text-teal-700',
  legal_vesting: 'bg-blue-100 text-blue-700',
  tax: 'bg-green-100 text-green-700',
  grant_deed: 'bg-amber-100 text-amber-700',
  prelim: 'bg-blue-50 text-blue-700',
  policy: 'bg-emerald-100 text-emerald-700',
  general: 'bg-gray-100 text-gray-600',
  curative: 'bg-red-100 text-red-700',
  user_upload: 'bg-indigo-100 text-indigo-700',
  supporting: 'bg-gray-100 text-gray-600',
};

export const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  open: { bg: 'bg-[#DBEAFE]', text: 'text-[#1E40AF]', label: 'Open' },
  in_process: { bg: 'bg-[#FEF3C7]', text: 'text-[#92400E]', label: 'In Process' },
  completed: { bg: 'bg-[#D1FAE5]', text: 'text-[#065F46]', label: 'Completed' },
  closed: { bg: 'bg-[#F1F5F9]', text: 'text-[#475569]', label: 'Closed' },
  canceled: { bg: 'bg-[#FEE2E2]', text: 'text-[#991B1B]', label: 'Canceled' },
  duplicate: { bg: 'bg-[#F3F4F6]', text: 'text-[#4B5563]', label: 'Duplicate' },
};

export function getStatusBanner(status: string): { label: string; bg: string; text: string; icon: string } {
  const isComplete = status === 'completed' || status === 'closed';
  return {
    label: isComplete ? 'Your order is COMPLETE' : 'Your order is IN PROGRESS',
    bg: isComplete ? 'bg-[#1B2A4A]' : 'bg-white border border-[#E5E7EB]',
    text: isComplete ? 'text-white' : 'text-[#1B2A4A]',
    icon: isComplete
      ? 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
      : 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  };
}

export function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatFileSize(bytes: number | null | undefined) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
