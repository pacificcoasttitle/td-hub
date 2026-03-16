export type Step = 1 | 2 | 3 | 4 | 5 | 6;

export interface Person { firstName: string; middleName: string; lastName: string; }
export interface Contact { id: number; fullName: string | null; companyName: string | null; email: string | null; phone: string | null; }
export interface Profile { displayName: string; email: string; phone: string | null; company: string | null; }

export const EMPTY: Person = { firstName: '', middleName: '', lastName: '' };

export const STEPS = [
  { n: 1 as Step, label: 'Type' },
  { n: 2 as Step, label: 'Property' },
  { n: 3 as Step, label: 'Parties' },
  { n: 4 as Step, label: 'Transaction' },
  { n: 5 as Step, label: 'Contacts' },
  { n: 6 as Step, label: 'Review' },
];

export const ORDER_TYPES = [
  { value: 'title_only', label: 'Title Only', sub: 'Title search & insurance' },
  { value: 'title_escrow', label: 'Title & Escrow', sub: 'Full title and escrow' },
  { value: 'escrow_only', label: 'Escrow Only', sub: 'Escrow services only' },
] as const;

export const UNDERWRITERS = [
  { value: '', label: 'Select…' },
  { value: 'westcor', label: 'Westcor' },
  { value: 'fnf', label: 'FNF / Commonwealth' },
  { value: 'natic', label: 'NATIC' },
];

export const ORG_TYPES = ['LLC', 'Corporation', 'Partnership', 'Trust', 'Other'];

export const IN = 'w-full h-12 px-3 border border-[#E5E7EB] rounded-lg text-sm text-[#1B2A4A] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#F26B2B]/20 focus:border-[#F26B2B] bg-white';
export const SEL = IN;
