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
    <div className="p-5 sm:p-6">
      <SH title="Review & Submit" sub="Confirm order details." />
      <div className="space-y-4 mb-6">
        <RS title="Order Type" onEdit={() => onGoTo(1)}><RF l="Type" v={ORDER_TYPES.find((o) => o.value === orderType.type)?.label ?? orderType.type} /><RF l="Rush" v={orderType.rush ? 'Yes' : 'No'} /></RS>
        <RS title="Property" onEdit={() => onGoTo(2)}><RF l="Address" v={[property.street, property.city, property.state, property.zip].filter(Boolean).join(', ') || '—'} /><RF l="County" v={property.county || '—'} /></RS>
        <RS title="Parties" onEdit={() => onGoTo(3)}><RF l="Seller" v={fp(parties.seller)} /><RF l="Buyer" v={fp(parties.buyer)} /></RS>
        <RS title="Transaction" onEdit={() => onGoTo(4)}><RF l="Type" v={transaction.transactionType || '—'} />{transaction.underwriter && <RF l="Underwriter" v={UNDERWRITERS.find((u) => u.value === transaction.underwriter)?.label ?? transaction.underwriter} />}</RS>
        <RS title="Contacts" onEdit={() => onGoTo(5)}><RF l="Escrow" v={cn(contacts.escrowCompany)} /><RF l="Lender" v={cn(contacts.lender)} /><RF l="Title Officer" v={cn(contacts.titleOfficer)} /></RS>
      </div>
      {error && <div className="mb-4 px-4 py-3 rounded-lg text-sm bg-red-50 border border-red-200 text-red-700">{error}</div>}
      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <button onClick={onPrev} className="px-4 py-2.5 text-sm font-medium border border-gray-200 text-[#6B7280] rounded-lg hover:bg-gray-50 transition-colors min-h-[44px]">← Back</button>
        <button onClick={onSubmit} disabled={submitting} className="px-6 py-2.5 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] disabled:opacity-50 transition-colors inline-flex items-center gap-2 min-h-[44px]">
          {submitting ? 'Creating…' : 'Submit Order'}
        </button>
      </div>
    </div>
  );
}
