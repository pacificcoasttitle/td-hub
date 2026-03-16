'use client';

import type { Step, Person, Contact } from './types';
import { ORDER_TYPES, UNDERWRITERS } from './types';
import { SH, RS, RF } from './shared';

export function StepReview({ orderType, property, parties, transaction, contacts, submitting, error, onSubmit, onPrev, onGoTo }: {
  orderType: any; property: any; parties: any; transaction: any; contacts: any;
  submitting: boolean; error: string | null; onSubmit: () => void; onPrev: () => void; onGoTo: (s: Step) => void;
}) {
  const cn = (c: Contact | null) => c?.fullName ?? c?.companyName ?? '—';
  const fp = (p: Person) => [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') || '—';
  return (
    <div className="p-6 sm:p-8">
      <SH title="Review & Submit" sub="Confirm order details before submitting." />
      <div className="space-y-4 mb-8">
        <RS title="Order Type" onEdit={() => onGoTo(1)}><RF l="Type" v={ORDER_TYPES.find((o) => o.value === orderType.type)?.label ?? orderType.type} /><RF l="Rush" v={orderType.rush ? 'Yes' : 'No'} /></RS>
        <RS title="Property" onEdit={() => onGoTo(2)}><RF l="Address" v={[property.street, property.city, property.state, property.zip].filter(Boolean).join(', ') || '—'} /><RF l="County" v={property.county || '—'} /></RS>
        <RS title="Parties" onEdit={() => onGoTo(3)}><RF l="Seller" v={fp(parties.seller)} /><RF l="Buyer" v={fp(parties.buyer)} /></RS>
        <RS title="Transaction" onEdit={() => onGoTo(4)}><RF l="Type" v={transaction.transactionType || '—'} />{transaction.underwriter && <RF l="Underwriter" v={UNDERWRITERS.find((u) => u.value === transaction.underwriter)?.label ?? transaction.underwriter} />}</RS>
        <RS title="Contacts" onEdit={() => onGoTo(5)}><RF l="Escrow" v={cn(contacts.escrowCompany)} /><RF l="Lender" v={cn(contacts.lender)} /><RF l="Title Officer" v={cn(contacts.titleOfficer)} /></RS>
      </div>
      {error && <div className="mb-4 px-4 py-3 rounded-xl text-sm bg-red-50 border border-red-200 text-red-700">{error}</div>}
      <div className="flex items-center justify-between pt-6 border-t border-[#E5E7EB]">
        <button onClick={onPrev} className="px-5 py-3 text-sm font-medium border border-[#1B2A4A] text-[#1B2A4A] rounded-lg hover:bg-[#1B2A4A]/5 transition-colors h-12 inline-flex items-center gap-2">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          Back
        </button>
        <button onClick={onSubmit} disabled={submitting} className="px-8 py-3 text-sm font-medium bg-[#F26B2B] text-white rounded-lg hover:bg-[#E05A1A] disabled:opacity-50 transition-colors h-12 inline-flex items-center gap-2">
          {submitting ? 'Creating…' : 'Submit Your Order'}
        </button>
      </div>
    </div>
  );
}
