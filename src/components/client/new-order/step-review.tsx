'use client';

import { useState, useRef } from 'react';
import type { Step, Person, PartyContact, ClientDetails, PropertyData, SellerData, TransactionData, PartiesData } from './types';
import { TRANSACTION_TYPES, CLIENT_TYPES } from './types';
import { SH, RS, RF } from './shared';

export function StepReview({
  clientDetails, property, seller, transaction, parties,
  submitting, submitBlocked = false, preparingLabel = null, preInitPhase,
  error, duplicateWarning, onSubmit, onPrev, onGoTo, onFilesChange,
}: {
  clientDetails: ClientDetails;
  property: PropertyData;
  seller: SellerData;
  transaction: TransactionData;
  parties: PartiesData;
  submitting: boolean;
  /** OC-1: true while Tax+LV pre-init is in flight (same gate as Hub). */
  submitBlocked?: boolean;
  preparingLabel?: string | null;
  preInitPhase?: string;
  error: string | null;
  duplicateWarning: string | null;
  onSubmit: () => void;
  onPrev: () => void;
  onGoTo: (s: Step) => void;
  onFilesChange: (files: File[]) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const fp = (p: Person) => [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') || '—';
  const pc = (c: PartyContact) => c.name || c.company || '—';
  const ctLabel = CLIENT_TYPES.find((ct) => ct.value === clientDetails.clientType)?.label ?? clientDetails.clientType;
  const ttLabel = TRANSACTION_TYPES.find((t) => t.value === transaction.transactionType)?.label ?? transaction.transactionType;
  const isPurchase = transaction.transactionType === 'Purchase';
  const isRefiLike = transaction.transactionType === 'Refinance' || transaction.transactionType === 'Equity';

  function handleFiles(newFiles: FileList | null) {
    if (!newFiles) return;
    const arr = [...files, ...Array.from(newFiles)];
    setFiles(arr);
    onFilesChange(arr);
  }

  function removeFile(index: number) {
    const arr = files.filter((_, i) => i !== index);
    setFiles(arr);
    onFilesChange(arr);
  }

  return (
    <div className="p-6 sm:p-8">
      <SH title="Upload & Review" sub="Upload curative documents and confirm your order details." />

      <div
        className={`border-2 border-dashed rounded-xl p-6 text-center mb-6 transition-colors ${dragOver ? 'border-[#F26B2B] bg-[#F26B2B]/5' : 'border-[#E5E7EB] hover:border-[#D1D5DB]'}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
      >
        <svg className="h-8 w-8 text-[#9CA3AF] mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <p className="text-sm font-medium text-[#1B2A4A]">Drop curative documents here</p>
        <p className="text-xs text-[#9CA3AF] mt-1">or</p>
        <button onClick={() => inputRef.current?.click()} className="mt-2 px-4 py-2 text-sm font-medium border border-[#F26B2B] text-[#F26B2B] rounded-lg hover:bg-[#F26B2B]/5 transition-colors min-h-[40px]">
          Browse Files
        </button>
        <input ref={inputRef} type="file" multiple onChange={(e) => handleFiles(e.target.files)} className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.tif,.tiff" />
      </div>

      {files.length > 0 && (
        <div className="mb-6 space-y-2">
          {files.map((f, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2 bg-[#F3F4F6] rounded-lg">
              <div className="flex items-center gap-2 min-w-0">
                <svg className="h-4 w-4 text-[#6B7280] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <span className="text-sm text-[#1B2A4A] truncate">{f.name}</span>
                <span className="text-xs text-[#9CA3AF] flex-shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
              </div>
              <button onClick={() => removeFile(i)} className="text-red-500 hover:text-red-700 p-1 min-h-[44px] flex items-center">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {duplicateWarning && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm bg-amber-50 border border-amber-200 text-amber-700 flex items-center gap-2">
          <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          {duplicateWarning}
        </div>
      )}

      <div className="space-y-4 mb-8">
        <RS title="Your Details" onEdit={() => onGoTo(1)}>
          <RF l="Client Type" v={ctLabel || '—'} />
          <RF l="Notifications" v={clientDetails.emailNotifications ? 'Yes' : 'No'} />
        </RS>

        <RS title="Property" onEdit={() => onGoTo(2)}>
          <RF l="Address" v={[property.street, property.city, property.state, property.zip].filter(Boolean).join(', ') || '—'} />
          <RF l="County" v={property.county || '—'} />
          <RF l="APN" v={property.apn || '—'} />
        </RS>

        <RS title="Transaction" onEdit={() => onGoTo(3)}>
          <RF l="Type" v={ttLabel || '—'} />
          {transaction.salesAmount && <RF l="Sales Amount" v={`$${transaction.salesAmount}`} />}
          {transaction.loanAmount && <RF l="Loan Amount" v={`$${transaction.loanAmount}`} />}
          {transaction.coverageAmount && <RF l="Coverage Amount" v={`$${transaction.coverageAmount}`} />}
          {transaction.loanNumber && <RF l="Loan Number" v={transaction.loanNumber} />}
          {transaction.salesRep && <RF l="Sales Rep" v={transaction.salesRep} />}
          {transaction.titleOfficer && <RF l="Title Officer" v={transaction.titleOfficer} />}
          {isPurchase && (
            <>
              <RF l="Primary seller" v={fp(seller.primary)} />
              {seller.hasSecondary && <RF l="Secondary seller" v={fp(seller.secondary)} />}
            </>
          )}
          {isRefiLike && (
            <>
              <RF l="Primary borrower" v={fp(transaction.primaryBorrower)} />
              {transaction.hasSecondaryBorrower && <RF l="Secondary borrower" v={fp(transaction.secondaryBorrower)} />}
            </>
          )}
        </RS>

        <RS title="Parties" onEdit={() => onGoTo(4)}>
          {parties.showAgents && <RF l="Buyer Agent" v={pc(parties.buyerAgent)} />}
          {parties.showAgents && <RF l="Listing Agent" v={pc(parties.listingAgent)} />}
          {parties.showLender && <RF l="Lender" v={pc(parties.lender)} />}
          {parties.showEscrow && <RF l="Escrow" v={pc(parties.escrow)} />}
          {parties.deliverableEmails.length > 0 && <RF l="Deliverable Emails" v={parties.deliverableEmails.filter(Boolean).join(', ') || '—'} />}
          {!parties.showAgents && !parties.showLender && !parties.showEscrow && <RF l="—" v="No parties added" />}
        </RS>
      </div>

      {error && <div className="mb-4 px-4 py-3 rounded-xl text-sm bg-red-50 border border-red-200 text-red-700">{error}</div>}

      <div className="flex items-center justify-between pt-6 border-t border-[#E5E7EB]">
        <button onClick={onPrev} className="px-5 py-3 text-sm font-medium border border-[#1B2A4A] text-[#1B2A4A] rounded-lg hover:bg-[#1B2A4A]/5 transition-colors h-12 inline-flex items-center gap-2">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          Back
        </button>
        <div className="flex flex-col items-end gap-1">
          {preparingLabel && (
            <p className="text-sm text-[#6B7280]" data-testid="pre-init-preparing">{preparingLabel}</p>
          )}
          {preInitPhase === 'ready' && (
            <p className="text-xs text-green-700" data-testid="pre-init-ready">Title data ready</p>
          )}
          {preInitPhase === 'timed_out' && (
            <p className="text-xs text-[#6B7280]" data-testid="pre-init-timed-out">
              Title data still preparing in background — you can submit
            </p>
          )}
          <button
            onClick={onSubmit}
            disabled={submitting || submitBlocked}
            data-testid="client-create-order-submit"
            className="px-8 py-3 text-sm font-medium bg-[#F26B2B] text-white rounded-lg hover:bg-[#E05A1A] disabled:opacity-50 transition-colors h-12 inline-flex items-center gap-2"
          >
            {submitting ? 'Creating…' : submitBlocked ? 'Preparing…' : 'Submit Your Order'}
          </button>
        </div>
      </div>
    </div>
  );
}
