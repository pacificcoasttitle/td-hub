import type { PartyPerson, WizardStep } from './types';

export const EMPTY_PERSON: PartyPerson = { firstName: '', middleName: '', lastName: '' };

export const STEPS: { n: WizardStep; label: string }[] = [
  { n: 1, label: 'Order Type' },
  { n: 2, label: 'Property' },
  { n: 3, label: 'Parties' },
  { n: 4, label: 'Transaction' },
  { n: 5, label: 'Contacts' },
  { n: 6, label: 'Review' },
];

export const ORDER_TYPES = [
  { value: 'title_only', label: 'Title Only', description: 'Title search and insurance only' },
  { value: 'title_escrow', label: 'Title & Escrow', description: 'Full title and escrow services' },
  { value: 'escrow_only', label: 'Escrow Only', description: 'Escrow services without title' },
] as const;

export const UNDERWRITERS = [
  { value: '', label: 'Select underwriter…' },
  { value: 'westcor', label: 'Westcor' },
  { value: 'fnf', label: 'FNF / Commonwealth' },
  { value: 'natic', label: 'NATIC' },
  { value: 'doma', label: 'Doma' },
];

export const ORG_TYPES = ['LLC', 'Corporation', 'Partnership', 'Trust', 'Other'];

export const INPUT_CLASS =
  'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] ' +
  'placeholder:text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 ' +
  'focus:border-[#C5A55A] bg-white';

export const SELECT_CLASS =
  'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] ' +
  'bg-white focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A]';
