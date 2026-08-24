'use client';

import { useEffect, useRef, useState } from 'react';
import type { ClientContact } from '@/components/admin/client-selector';
import type { ParsedAddress } from '@/components/ui/address-autocomplete';
import type { SiteXPropertyResult } from '@/components/shared/property-confirm-modal';
import { buildPreInitAddressKey, usePreInitOnSiteX } from '@/lib/orders/use-pre-init-on-sitex';
import { isConfidentSiteXMatch } from '@/lib/domain/titlepoint/confident-sitex';
import { firstPartySubmitBlocker, toCreateOrderContact } from '@/lib/domain/orders/party-contact';
import { EP, EC, type Person, type FormOptions } from './types';

function deriveUW(product: string): string {
  return product.toLowerCase().trim() === 'full alta' ? 'CW' : 'WC';
}

export function useQuickEntry() {
  const [client, setClientRaw] = useState<ClientContact | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingAddress, setPendingAddress] = useState<ParsedAddress | null>(null);
  const [noMatchMsg, setNoMatchMsg] = useState('');
  const [apnSearching, setApnSearching] = useState(false);
  const [searchMode, setSearchMode] = useState<'address' | 'apn'>('address');

  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [apn, setApn] = useState('');
  const [county, setCounty] = useState('');
  const [legalDesc, setLegalDesc] = useState('');
  const [propType, setPropType] = useState('');
  const [siteXFilled, setSiteXFilled] = useState(false);

  const [sellerPrimary, setSellerPrimary] = useState<Person>({ ...EP });
  const [sellerSecondary, setSellerSecondary] = useState<Person>({ ...EP });
  const [hasSecondarySeller, setHasSecondarySeller] = useState(false);
  const [sellerIsOrg, setSellerIsOrg] = useState(false);
  const [sellerOrgType, setSellerOrgType] = useState('');
  const [sellerSiteX, setSellerSiteX] = useState(false);
  const [borrowerSiteX, setBorrowerSiteX] = useState(false);

  const [txType, setTxType] = useState('');
  const [productType, setProductType] = useState('');
  const [orderType, setOrderType] = useState('');
  const [salesRep, setSalesRepRaw] = useState('');
  const [titleOfficer, setTitleOfficerRaw] = useState('');
  const [underwriter, setUnderwriterRaw] = useState('');
  const [escrowNumber, setEscrowNumber] = useState('');
  const [salesAmount, setSalesAmount] = useState('');
  const [loanNumber, setLoanNumber] = useState('');
  const [loanAmount, setLoanAmount] = useState('');
  const [coverageAmount, setCoverageAmount] = useState('');
  const [borrower, setBorrower] = useState<Person>({ ...EP });
  const [secBorrower, setSecBorrower] = useState<Person>({ ...EP });
  const [hasSecBorrower, setHasSecBorrower] = useState(false);
  const [borrowerIsOrg, setBorrowerIsOrg] = useState(false);
  const [borrowerOrgType, setBorrowerOrgType] = useState('');

  const [buyerAgent, setBuyerAgent] = useState({ ...EC });
  const [listingAgent, setListingAgent] = useState({ ...EC });
  const [lender, setLender] = useState({ ...EC });
  const [mortgageBroker, setMortgageBroker] = useState({ ...EC });
  const [escrow, setEscrow] = useState({ ...EC });
  const [escrowOfficer, setEscrowOfficer] = useState('');
  const [deliverableEmails, setDeliverableEmails] = useState<string[]>([]);

  const [formOpts, setFormOpts] = useState<FormOptions | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string; orderId?: number; fileNumber?: string } | null>(null);

  // Auto-fill tracking
  const [repAutoFilled, setRepAutoFilled] = useState(false);
  const [toAutoFilled, setToAutoFilled] = useState(false);
  const [uwManual, setUwManual] = useState(false);
  const [clientCompanyName, setClientCompanyName] = useState('');

  const preInit = usePreInitOnSiteX();

  // Invalidate stale pre-init when the user edits address after a match.
  const invalidatePreInit = preInit.invalidateIfAddressChanged;
  useEffect(() => {
    invalidatePreInit(
      buildPreInitAddressKey({
        address: street,
        city: city || 'Unknown',
        state: state || 'CA',
        zip,
        apn,
      }),
    );
  }, [street, city, state, zip, apn, invalidatePreInit]);

  useEffect(() => {
    fetch('/api/form-options')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return;
        const toOpt = (arr: Array<{ id?: number; name?: string; value?: string; label?: string; email?: string }>) =>
          (arr ?? []).map((r) => ({ value: r.value ?? String(r.id ?? ''), label: r.label ?? r.name ?? r.email ?? '' }));
        setFormOpts({
          productTypes: d.productTypes ?? [],
          orderTypes: d.orderTypes ?? [],
          salesReps: toOpt(d.salesReps),
          titleOfficers: toOpt(d.titleOfficers),
          escrowOfficers: toOpt(d.escrowOfficers),
          underwriters: d.underwriters ?? [],
        });
      })
      .catch(() => {});
  }, []);

  // Auto-derive underwriter from product type (unless user manually overrode)
  const prevProduct = useRef(productType);
  useEffect(() => {
    if (productType !== prevProduct.current) {
      prevProduct.current = productType;
      if (!uwManual) setUnderwriterRaw(deriveUW(productType));
    }
  }, [productType, uwManual]);

  // ─── Client selection with officer auto-fill ─────────────────────────────

  function setClient(c: ClientContact | null) {
    setClientRaw(c);
    if (!c) {
      if (repAutoFilled) { setSalesRepRaw(''); setRepAutoFilled(false); }
      if (toAutoFilled) { setTitleOfficerRaw(''); setToAutoFilled(false); }
      setClientCompanyName('');
      return;
    }
    setClientCompanyName(c.companyName ?? '');
    if (c.companySalesRepId != null && (!salesRep || repAutoFilled)) {
      setSalesRepRaw(String(c.companySalesRepId));
      setRepAutoFilled(true);
    }
    if (c.companyTitleOfficerId != null && (!titleOfficer || toAutoFilled)) {
      setTitleOfficerRaw(String(c.companyTitleOfficerId));
      setToAutoFilled(true);
    }
  }

  function setSalesRep(v: string) { setSalesRepRaw(v); setRepAutoFilled(false); }
  function setTitleOfficer(v: string) { setTitleOfficerRaw(v); setToAutoFilled(false); }
  function setUnderwriter(v: string) { setUnderwriterRaw(v); setUwManual(true); }

  // ─── Property helpers ────────────────────────────────────────────────────

  function parseOwnerName(raw: string): Person {
    const parts = raw.split(' ').filter(Boolean);
    if (parts.length === 0) return { firstName: '', middleName: '', lastName: '' };
    if (parts.length === 1) return { firstName: parts[0], middleName: '', lastName: '' };
    return {
      firstName: parts[1],
      middleName: parts.length > 2 ? parts.slice(2).join(' ') : '',
      lastName: parts[0],
    };
  }

  function fillOwners(p: SiteXPropertyResult) {
    const isRefi = txType === 'Refinance' || txType === 'Equity';

    if (isRefi) {
      if (p.primaryOwner) { setBorrower(parseOwnerName(p.primaryOwner)); setBorrowerSiteX(true); }
      if (p.secondaryOwner) { setSecBorrower(parseOwnerName(p.secondaryOwner)); setHasSecBorrower(true); setBorrowerSiteX(true); }
    } else {
      if (p.primaryOwner) { setSellerPrimary(parseOwnerName(p.primaryOwner)); setSellerSiteX(true); }
      if (p.secondaryOwner) { setSellerSecondary(parseOwnerName(p.secondaryOwner)); setHasSecondarySeller(true); setSellerSiteX(true); }
    }
  }

  function handleAddressSelect(parsed: ParsedAddress) {
    setPendingAddress(parsed);
    setStreet(parsed.street); setCity(parsed.city); setState(parsed.state); setZip(parsed.zip);
    setShowConfirmModal(true);
    setNoMatchMsg('');
  }

  function handleSearchClick() {
    if (street && city && state && zip) {
      setPendingAddress({ street, city, state, zip, placeId: '' });
      setShowConfirmModal(true);
      setNoMatchMsg('');
    }
  }

  function handleConfirm(p: SiteXPropertyResult) {
    setShowConfirmModal(false);
    const nextStreet = p.fullAddress || street;
    const nextCity = p.city || city;
    const nextState = p.state || state;
    const nextZip = p.zip || zip;
    const nextApn = p.apn || apn;
    const nextCounty = p.county || county;
    const nextLegal = p.legalDescription || legalDesc;
    if (p.apn) setApn(p.apn);
    if (p.county) setCounty(p.county);
    if (p.legalDescription) setLegalDesc(p.legalDescription);
    if (p.propertyType) setPropType(p.propertyType);
    if (p.fullAddress) setStreet(p.fullAddress);
    if (p.city) setCity(p.city);
    if (p.state) setState(p.state);
    if (p.zip) setZip(p.zip);
    setSiteXFilled(true);
    fillOwners(p);

    // OC-1: fire Tax+LV pre-init on confident SiteX match (not on address select / submit).
    if (isConfidentSiteXMatch({ apn: nextApn, county: nextCounty, legalDescription: nextLegal })) {
      preInit.onConfidentSiteX({
        address: nextStreet,
        city: nextCity || 'Unknown',
        state: nextState || 'CA',
        county: nextCounty!,
        apn: nextApn,
        legalDescription: nextLegal,
        propertyType: p.propertyType,
        primaryOwner: p.primaryOwner,
        secondaryOwner: p.secondaryOwner,
        fullAddress: p.fullAddress,
        zip: nextZip,
      });
    } else {
      preInit.onNoSiteXMatch();
    }
  }

  async function handleApnSearch() {
    if (!apn || !county) return;
    setApnSearching(true);
    setNoMatchMsg('');
    try {
      const res = await fetch('/api/property/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'apn', apn, county }),
      });
      const data = await res.json();
      if (data.match === 'single' && data.property) {
        const p = data.property as SiteXPropertyResult;
        if (p.fullAddress) setStreet(p.fullAddress);
        if (p.city) setCity(p.city);
        if (p.state) setState(p.state);
        if (p.zip) setZip(p.zip);
        if (p.county) setCounty(p.county);
        if (p.legalDescription) setLegalDesc(p.legalDescription);
        if (p.propertyType) setPropType(p.propertyType);
        setSiteXFilled(true);
        fillOwners(p);
        if (isConfidentSiteXMatch(p)) {
          preInit.onConfidentSiteX({
            address: p.fullAddress || street,
            city: p.city || city || 'Unknown',
            state: p.state || state || 'CA',
            county: p.county!,
            apn: p.apn,
            legalDescription: p.legalDescription,
            propertyType: p.propertyType,
            primaryOwner: p.primaryOwner,
            secondaryOwner: p.secondaryOwner,
            fullAddress: p.fullAddress,
            zip: p.zip || zip,
          });
        } else {
          preInit.onNoSiteXMatch();
        }
      } else {
        setNoMatchMsg('No property found for this APN.');
        preInit.onNoSiteXMatch();
      }
    } catch {
      setNoMatchMsg('Search failed.');
      preInit.onNoSiteXMatch();
    } finally {
      setApnSearching(false);
    }
  }

  // ─── Submit ──────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setResult(null);
    const partyBlock = firstPartySubmitBlocker({
      buyerAgent, listingAgent, lender, mortgageBroker, escrowCompany: escrow,
    });
    if (partyBlock) {
      setResult({ type: 'error', message: partyBlock });
      return;
    }

    setSubmitting(true);
    try {
      const num = (s: string) => {
        const n = parseFloat(s.replace(/[^0-9.]/g, ''));
        return isNaN(n) ? 0 : n;
      };

      const payload = {
        orderType: orderType || 'Title only',
        isRushOrder: false,
        property: {
          address: street, city: city || 'Unknown', state: state || 'CA', zip: zip || '00000',
          apn: apn || undefined, legalDescription: legalDesc || undefined, county: county || undefined,
        },
        seller: {
          firstName: sellerPrimary.firstName || 'TBD', middleName: sellerPrimary.middleName || undefined, lastName: sellerPrimary.lastName || 'TBD',
          secondaryFirstName: hasSecondarySeller ? sellerSecondary.firstName || undefined : undefined,
          secondaryMiddleName: hasSecondarySeller ? sellerSecondary.middleName || undefined : undefined,
          secondaryLastName: hasSecondarySeller ? sellerSecondary.lastName || undefined : undefined,
          isOrganization: sellerIsOrg, organizationType: sellerIsOrg ? (sellerOrgType || undefined) : undefined,
        },
        buyer: {
          firstName: borrower.firstName || 'TBD', middleName: borrower.middleName || undefined, lastName: borrower.lastName || 'TBD',
          secondaryFirstName: hasSecBorrower ? secBorrower.firstName || undefined : undefined,
          secondaryMiddleName: hasSecBorrower ? secBorrower.middleName || undefined : undefined,
          secondaryLastName: hasSecBorrower ? secBorrower.lastName || undefined : undefined,
          isOrganization: borrowerIsOrg, organizationType: borrowerOrgType || undefined,
        },
        transaction: {
          type: txType || 'Purchase', product: productType || 'Residential Resale',
          escrowNumber: escrowNumber || undefined,
          salesAmount: num(salesAmount), loanNumber: loanNumber || undefined,
          loanAmount: num(loanAmount), coverageAmount: num(coverageAmount),
          branchCode: 'PCT',
          salesRep: salesRep || undefined, titleOfficer: titleOfficer || undefined,
          escrowOfficer: escrowOfficer || undefined,
          underwriterCode: underwriter || undefined,
        },
        contacts: {
          buyerAgent: toCreateOrderContact(buyerAgent),
          listingAgent: toCreateOrderContact(listingAgent),
          lender: toCreateOrderContact(lender),
          mortgageBroker: toCreateOrderContact(mortgageBroker),
          escrowCompany: toCreateOrderContact(escrow),
        },
        deliverableEmails: deliverableEmails.filter(Boolean),
        clientType: client?.contactType ?? undefined,
        onBehalfOfContactId: client?.id || undefined,
        titlePointSessionId: preInit.sessionId || undefined,
        siteXSnapshot: preInit.siteXSnapshot || undefined,
      };

      const res = await fetch('/api/orders/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Creation failed (${res.status})`);
      setResult({ type: 'success', message: `Order ${body.fileNumber ?? body.orderId ?? ''} created.`, orderId: body.orderId ?? body.id, fileNumber: body.fileNumber ?? undefined });
    } catch (err) {
      setResult({ type: 'error', message: err instanceof Error ? err.message : 'Order creation failed' });
    } finally {
      setSubmitting(false);
    }
  }

  return {
    client, setClient,
    showConfirmModal, setShowConfirmModal,
    pendingAddress, noMatchMsg, setNoMatchMsg,
    apnSearching, searchMode, setSearchMode,
    street, setStreet, city, setCity, state, setState, zip, setZip,
    apn, setApn, county, setCounty, legalDesc, setLegalDesc, propType, setPropType,
    siteXFilled,
    sellerPrimary, setSellerPrimary, sellerSecondary, setSellerSecondary,
    hasSecondarySeller, setHasSecondarySeller,
    sellerIsOrg, setSellerIsOrg, sellerOrgType, setSellerOrgType, sellerSiteX,
    borrowerSiteX,
    txType, setTxType, productType, setProductType, orderType, setOrderType,
    salesRep, setSalesRep, titleOfficer, setTitleOfficer,
    underwriter, setUnderwriter,
    escrowNumber, setEscrowNumber, salesAmount, setSalesAmount,
    loanNumber, setLoanNumber, loanAmount, setLoanAmount, coverageAmount, setCoverageAmount,
    borrower, setBorrower, secBorrower, setSecBorrower,
    hasSecBorrower, setHasSecBorrower,
    borrowerIsOrg, setBorrowerIsOrg, borrowerOrgType, setBorrowerOrgType,
    buyerAgent, setBuyerAgent, listingAgent, setListingAgent,
    lender, setLender, mortgageBroker, setMortgageBroker, escrow, setEscrow,
    escrowOfficer, setEscrowOfficer,
    deliverableEmails, setDeliverableEmails,
    formOpts, submitting, result, setResult,
    repAutoFilled, toAutoFilled, clientCompanyName,
    preInitPhase: preInit.phase,
    preInitSubmitBlocked: preInit.submitBlocked,
    preInitPreparingLabel: preInit.preparingLabel,
    titlePointSessionId: preInit.sessionId,
    handleNoSiteXMatch: preInit.onNoSiteXMatch,
    handleAddressSelect, handleSearchClick, handleConfirm, handleApnSearch, handleSubmit,
  };
}

export type QuickEntryState = ReturnType<typeof useQuickEntry>;
