export const CATEGORY_LABELS: Record<string, string> = {
  cpl: 'CPL',
  prelim: 'Prelim',
  policy: 'Policy',
  legal_vesting: 'Legal Vesting',
  grant_deed: 'Grant Deed',
  tax: 'Tax',
  general: 'General',
  user_upload: 'Upload',
};

export function getStatusBanner(status: string): { label: string; bg: string; text: string; icon: string } {
  const isComplete = status === 'completed' || status === 'closed';
  return {
    label: isComplete ? 'Your order is COMPLETE' : 'Your order is IN PROGRESS',
    bg: isComplete ? 'bg-[#1B2A4A]' : 'bg-white border border-[#1B2A4A]',
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
