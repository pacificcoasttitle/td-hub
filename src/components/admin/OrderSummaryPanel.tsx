'use client';

import { partyHasInput } from '@/lib/domain/orders/party-contact';
import type { QuickEntryState } from '@/components/admin/quick-entry/use-quick-entry';

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function personName(p: { firstName: string; lastName: string }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(' ');
}

function fmtCurrency(raw: string): string {
  const n = parseFloat(raw.replace(/[^0-9.]/g, ''));
  if (isNaN(n) || n === 0) return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);
}

function hasContact(c: Parameters<typeof partyHasInput>[0]): boolean {
  return partyHasInput(c);
}

/* ── Component ─────────────────────────────────────────────────────────────── */

export function OrderSummaryPanel({ s }: { s: QuickEntryState }) {
  const hasClient = !!s.client;
  const hasProperty = !!(s.street || s.apn || s.county);
  const isPurchase = s.txType === 'Purchase';
  const isBorrowerFlow = s.txType === 'Refinance' || s.txType === 'Equity';
  const sellerName = personName(s.sellerPrimary);
  const sellerSecondaryName = personName(s.sellerSecondary);
  const buyerBorrowerName = personName(s.borrower);
  const buyerBorrowerSecondaryName = personName(s.secBorrower);
  const hasSeller = isPurchase && !!sellerName;
  const hasBuyerBorrower = !!(isPurchase || isBorrowerFlow) && !!buyerBorrowerName;
  const salesRepName = s.formOpts?.salesReps?.find((r) => r.value === s.salesRep)?.label ?? s.salesRep;
  const titleOfficerName = s.formOpts?.titleOfficers?.find((o) => o.value === s.titleOfficer)?.label ?? s.titleOfficer;
  const hasTx = !!(
    s.txType || s.productType || s.orderType || s.salesAmount || s.loanAmount || s.loanNumber ||
    s.coverageAmount || s.escrowNumber || salesRepName || titleOfficerName
  );
  const parties = buildParties(s);
  const hasParties = parties.length > 0;

  return (
    <div className="bg-white border border-gray-200 shadow-sm rounded-lg p-5 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto">
      <h3 className="text-lg font-semibold text-[#1A1A2E] mb-4">Order Summary</h3>

      <div className="space-y-4">
        {/* Transaction */}
        <Section filled={hasTx} label="Transaction" placeholder="Transaction details will appear here">
          {hasTx && (
            <>
              {s.txType && <Field label="Type" value={s.txType} />}
              {s.orderType && <Field label="Order Type" value={s.orderType} />}
              {s.productType && <Field label="Product" value={s.productType} />}
              {salesRepName && <Field label="Sales Rep" value={salesRepName} />}
              {titleOfficerName && <Field label="Title Officer" value={titleOfficerName} />}
              {s.salesAmount && fmtCurrency(s.salesAmount) && <Field label="Sales Price" value={fmtCurrency(s.salesAmount)} />}
              {s.loanAmount && fmtCurrency(s.loanAmount) && <Field label="Loan Amount" value={fmtCurrency(s.loanAmount)} />}
              {s.coverageAmount && fmtCurrency(s.coverageAmount) && <Field label="Coverage Amount" value={fmtCurrency(s.coverageAmount)} />}
              {s.loanNumber && <Field label="Loan #" value={s.loanNumber} />}
              {s.escrowNumber && <Field label="Escrow #" value={s.escrowNumber} />}
            </>
          )}
        </Section>

        {/* Client */}
        <Section filled={hasClient} label="Client" placeholder="Client details will appear here">
          {hasClient && s.client && (
            <>
              <Field label="Name" value={s.client.fullName ?? s.client.companyName ?? '—'} />
              {s.client.companyName && s.client.fullName && <Field label="Company" value={s.client.companyName} />}
              {s.client.email && <Field label="Email" value={s.client.email} />}
              {s.client.phone && <Field label="Phone" value={s.client.phone} />}
              {s.client.contactType && (
                <div className="mt-1">
                  <span className="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-[#F26B2B]/10 text-[#F26B2B] capitalize">
                    {s.client.contactType.replace(/_/g, ' ')}
                  </span>
                </div>
              )}
            </>
          )}
        </Section>

        {/* Property + Seller / Buyer|Borrower */}
        <Section filled={hasProperty || hasSeller || hasBuyerBorrower} label="Property" placeholder="Property details will appear here">
          {hasProperty && (
            <>
              <Field label="Address" value={[s.street, s.city, s.state, s.zip].filter(Boolean).join(', ')} />
              {s.county && <Field label="County" value={s.county} />}
              {s.apn && <Field label="APN" value={s.apn} />}
              {s.propType && <Field label="Type" value={s.propType} />}
            </>
          )}
          {hasSeller && (
            <div className={hasProperty ? 'border-t border-gray-100 pt-2 mt-2' : ''}>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Seller / Owner</span>
              <Field
                label={s.sellerIsOrg ? 'Organization' : 'Name'}
                value={sellerName}
              />
              {sellerSecondaryName && <Field label="Secondary" value={sellerSecondaryName} />}
              {s.sellerIsOrg && s.sellerOrgType && (
                <div className="mt-1">
                  <span className="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
                    {s.sellerOrgType}
                  </span>
                </div>
              )}
            </div>
          )}
          {hasBuyerBorrower && (
            <div className={(hasProperty || hasSeller) ? 'border-t border-gray-100 pt-2 mt-2' : ''}>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                {isPurchase ? 'Buyer' : 'Borrower'}
              </span>
              <Field
                label={s.borrowerIsOrg ? 'Organization' : 'Name'}
                value={buyerBorrowerName}
              />
              {buyerBorrowerSecondaryName && <Field label="Secondary" value={buyerBorrowerSecondaryName} />}
              {s.borrowerIsOrg && s.borrowerOrgType && (
                <div className="mt-1">
                  <span className="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
                    {s.borrowerOrgType}
                  </span>
                </div>
              )}
            </div>
          )}
        </Section>

        {/* Parties */}
        <Section filled={hasParties} label="Parties" placeholder="Party details will appear here">
          {hasParties && (
            <div className="space-y-1.5">
              {parties.map(({ role, name }) => (
                <div key={role}>
                  <span className="text-xs text-gray-400">{role}</span>
                  <p className="text-sm text-[#1A1A2E]">{name}</p>
                </div>
              ))}
            </div>
          )}
        </Section>

      </div>
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────────────────────── */

function Section({ filled, label, placeholder, children }: {
  filled: boolean; label: string; placeholder: string; children: React.ReactNode;
}) {
  return (
    <div className={filled ? 'border-l-2 border-[#F26B2B] pl-3' : ''}>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">{label}</h4>
      {filled ? children : <p className="text-sm text-gray-300 italic">{placeholder}</p>}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-gray-400">{label}</span>
      <p className="text-sm text-[#1A1A2E]">{value}</p>
    </div>
  );
}

/* ── Party builder ─────────────────────────────────────────────────────────── */

function buildParties(s: QuickEntryState): { role: string; name: string }[] {
  const out: { role: string; name: string }[] = [];
  if (hasContact(s.buyerAgent)) out.push({ role: 'Buyer Agent', name: s.buyerAgent.name || s.buyerAgent.company });
  if (hasContact(s.listingAgent)) out.push({ role: 'Listing Agent', name: s.listingAgent.name || s.listingAgent.company });
  if (hasContact(s.lender)) out.push({ role: 'Lender', name: s.lender.name || s.lender.company });
  if (hasContact(s.mortgageBroker)) out.push({ role: 'Mortgage Broker', name: s.mortgageBroker.name || s.mortgageBroker.company });
  if (hasContact(s.escrow)) out.push({ role: 'Escrow', name: s.escrow.name || s.escrow.company });
  return out;
}
