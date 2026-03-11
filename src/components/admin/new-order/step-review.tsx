import Link from 'next/link';
import type {
  WizardStep, OrderTypeData, PropertyData, PartiesData,
  TransactionData, ContactsData, ContactResult, PartyPerson, SubmitResult,
} from './types';
import { ORDER_TYPES, UNDERWRITERS } from './constants';
import { StepHeader } from './shared';

export function Step6Review({
  orderType, property, parties, transaction, contacts,
  submitting, result, onSubmit, onPrev, onGoTo,
}: {
  orderType: OrderTypeData; property: PropertyData; parties: PartiesData;
  transaction: TransactionData; contacts: ContactsData;
  submitting: boolean; result: SubmitResult | null;
  onSubmit: () => void; onPrev: () => void; onGoTo: (s: WizardStep) => void;
}) {
  const otLabel = ORDER_TYPES.find((o) => o.value === orderType.orderType)?.label ?? orderType.orderType;

  function formatPerson(p: PartyPerson): string {
    return [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') || '—';
  }

  function contactName(c: ContactResult | null): string {
    return c?.fullName ?? c?.companyName ?? '—';
  }

  return (
    <div className="p-6">
      <StepHeader title="Review & Submit" sub="Verify the order details before creating." />

      <div className="space-y-5 mb-6">
        <ReviewSection title="Order Type" onEdit={() => onGoTo(1)}>
          <ReviewField label="Type" value={otLabel} />
          <ReviewField label="Rush" value={orderType.rushOrder ? 'Yes' : 'No'} />
          <ReviewField label="Branch" value={orderType.branchId ? `Branch #${orderType.branchId}` : 'Not selected'} />
        </ReviewSection>

        <ReviewSection title="Property" onEdit={() => onGoTo(2)}>
          <ReviewField label="Address" value={[property.street, property.city, property.state, property.zip].filter(Boolean).join(', ') || '—'} />
          <ReviewField label="County" value={property.county || '—'} />
          <ReviewField label="APN" value={property.apn || '—'} />
        </ReviewSection>

        <ReviewSection title="Parties" onEdit={() => onGoTo(3)}>
          <ReviewField label="Seller" value={formatPerson(parties.seller)} />
          {parties.hasSecondarySeller && <ReviewField label="Secondary Seller" value={formatPerson(parties.secondarySeller)} />}
          <ReviewField label="Buyer/Borrower" value={formatPerson(parties.buyer)} />
          {parties.hasSecondaryBuyer && <ReviewField label="Secondary Buyer" value={formatPerson(parties.secondaryBuyer)} />}
          {parties.buyerIsOrg && <ReviewField label="Organization" value={parties.orgType || '—'} />}
        </ReviewSection>

        <ReviewSection title="Transaction" onEdit={() => onGoTo(4)}>
          <ReviewField label="Type" value={transaction.transactionType || '—'} />
          {transaction.productType && <ReviewField label="Product" value={transaction.productType} />}
          {transaction.underwriter && <ReviewField label="Underwriter" value={UNDERWRITERS.find((u) => u.value === transaction.underwriter)?.label ?? transaction.underwriter} />}
          {transaction.salesAmount && <ReviewField label="Sales Amount" value={`$${transaction.salesAmount}`} />}
          {transaction.loanAmount && <ReviewField label="Loan Amount" value={`$${transaction.loanAmount}`} />}
          {transaction.coverageAmount && <ReviewField label="Coverage" value={`$${transaction.coverageAmount}`} />}
        </ReviewSection>

        <ReviewSection title="Contacts" onEdit={() => onGoTo(5)}>
          <ReviewField label="Escrow Company" value={contactName(contacts.escrowCompany)} />
          <ReviewField label="Lender" value={contactName(contacts.lender)} />
          <ReviewField label="Buyer's Agent" value={contactName(contacts.buyerAgent)} />
          <ReviewField label="Listing Agent" value={contactName(contacts.listingAgent)} />
          <ReviewField label="Title Officer" value={contactName(contacts.titleOfficer)} />
        </ReviewSection>
      </div>

      {result && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${
          result.type === 'success'
            ? 'bg-green-50 border border-green-200 text-green-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          <p className="font-medium">{result.message}</p>
          {result.type === 'success' && result.orderId && (
            <Link href={`/orders/${result.orderId}`} className="text-green-800 underline text-xs mt-1 inline-block">
              View order →
            </Link>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <button onClick={onPrev} className="px-4 py-2 text-sm font-medium border border-gray-200 text-[#6B7280] rounded-lg hover:bg-gray-50 transition-colors">
          ← Back
        </button>
        {(!result || result.type === 'error') && (
          <button
            onClick={onSubmit}
            disabled={submitting}
            className="px-6 py-2.5 text-sm font-medium bg-[#C5A55A] text-white rounded-lg hover:bg-[#b3923e] disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
          >
            {submitting && (
              <svg className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {submitting ? 'Creating order in SoftPro…' : 'Create Order'}
          </button>
        )}
      </div>
    </div>
  );
}

function ReviewSection({
  title, onEdit, children,
}: {
  title: string; onEdit: () => void; children: React.ReactNode;
}) {
  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">{title}</p>
        <button onClick={onEdit} className="text-xs text-[#C5A55A] hover:text-[#b3923e] font-medium transition-colors">
          Edit
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">{children}</div>
    </div>
  );
}

function ReviewField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-[#6B7280] flex-shrink-0">{label}:</span>
      <span className="text-sm text-[#1A1A2E] font-medium truncate">{value}</span>
    </div>
  );
}
