export interface Person { firstName: string; middleName: string; lastName: string; }
export interface PartyContact { name: string; email: string; phone: string; company: string; }
export interface FormOption { value: string; label: string; }

export interface FormOptions {
  productTypes: FormOption[];
  orderTypes: FormOption[];
  salesReps: FormOption[];
  titleOfficers: FormOption[];
  escrowOfficers: FormOption[];
}

export const EP: Person = { firstName: '', middleName: '', lastName: '' };
export const EC: PartyContact = { name: '', email: '', phone: '', company: '' };

export const ORG_TYPES = ['LLC', 'Corporation', 'Partnership', 'Trust', 'Other'];
export const TX_TYPES = ['', 'Purchase', 'Refinance', 'Equity', 'Other'];

export const IN = 'w-full h-11 px-3 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#F26B2B]/30 focus:border-[#F26B2B] bg-white';
export const SEL = IN;
export const SECTION = 'bg-white border border-gray-200 rounded-xl p-6 mb-6';
export const SH = 'text-base font-semibold text-[#1A1A2E] mb-4 flex items-center gap-2';
export const FL = 'block text-sm font-medium text-[#1A1A2E] mb-1';
