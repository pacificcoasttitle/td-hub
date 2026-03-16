'use client';

import { useEffect, useState } from 'react';
import type { ClientContact } from '@/components/admin/client-selector';
import type { ParsedAddress } from '@/components/ui/address-autocomplete';
import type { SiteXPropertyResult } from '@/components/shared/property-confirm-modal';
import { EP, EC, type Person, type FormOptions } from './types';

export function useQuickEntry() {
  const [client, setClient] = useState<ClientContact | null>(null);
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

  const [txType, setTxType] = useState('');
  const [productType, setProductType] = useState('');
  const [orderType, setOrderType] = useState('');
  const [salesRep, setSalesRep] = useState('');
  const [titleOfficer, setTitleOfficer] = useState('');
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
  const [escrow, setEscrow] = useState({ ...EC });
  const [escrowOfficer, setEscrowOfficer] = useState('');
  const [deliverableEmails, setDeliverableEmails] = useState<string[]>([]);

  const [formOpts, setFormOpts] = useState<FormOptions | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string; orderId?: number } | null>(null);

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
        });
      })
      .catch(() => {});
  }, []);

  function fillOwners(p: SiteXPropertyResult) {
    if (p.primaryOwner) {
      const parts = p.primaryOwner.split(' ');
      setSellerPrimary({ firstName: parts[0] ?? '', middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '', lastName: parts.length > 1 ? parts[parts.length - 1] : '' });
      setSellerSiteX(true);
    }
    if (p.secondaryOwner) {
      const parts = p.secondaryOwner.split(' ');
      setSellerSecondary({ firstName: parts[0] ?? '', middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '', lastName: parts.length > 1 ? parts[parts.length - 1] : '' });
      setHasSecondarySeller(true);
      setSellerSiteX(true);
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
        const p = data.property;
        if (p.fullAddress) setStreet(p.fullAddress);
        if (p.city) setCity(p.city);
        if (p.state) setState(p.state);
        if (p.zip) setZip(p.zip);
        if (p.county) setCounty(p.county);
        if (p.legalDescription) setLegalDesc(p.legalDescription);
        if (p.propertyType) setPropType(p.propertyType);
        setSiteXFilled(true);
        fillOwners(p);
      } else {
        setNoMatchMsg('No property found for this APN.');
      }
    } catch {
      setNoMatchMsg('Search failed.');
    } finally {
      setApnSearching(false);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    setResult(null);
    try {
      const payload = {
        clientId: client?.id,
        property: { street, city, state, zip, apn, county, legalDescription: legalDesc, propertyType: propType },
        seller: { primary: sellerPrimary, secondary: hasSecondarySeller ? sellerSecondary : undefined, isOrg: sellerIsOrg, orgType: sellerOrgType },
        transaction: { transactionType: txType, productType, orderType, salesRep, titleOfficer, escrowNumber, salesAmount, loanNumber, loanAmount, coverageAmount },
        borrower: { primary: borrower, secondary: hasSecBorrower ? secBorrower : undefined, isOrg: borrowerIsOrg, orgType: borrowerOrgType },
        parties: { buyerAgent, listingAgent, lender, escrow, escrowOfficer },
        deliverableEmails: deliverableEmails.filter(Boolean),
      };
      const res = await fetch('/api/orders/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Creation failed (${res.status})`);
      setResult({ type: 'success', message: `Order ${body.fileNumber ?? body.orderId ?? ''} created.`, orderId: body.orderId ?? body.id });
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
    txType, setTxType, productType, setProductType, orderType, setOrderType,
    salesRep, setSalesRep, titleOfficer, setTitleOfficer,
    escrowNumber, setEscrowNumber, salesAmount, setSalesAmount,
    loanNumber, setLoanNumber, loanAmount, setLoanAmount, coverageAmount, setCoverageAmount,
    borrower, setBorrower, secBorrower, setSecBorrower,
    hasSecBorrower, setHasSecBorrower,
    borrowerIsOrg, setBorrowerIsOrg, borrowerOrgType, setBorrowerOrgType,
    buyerAgent, setBuyerAgent, listingAgent, setListingAgent,
    lender, setLender, escrow, setEscrow,
    escrowOfficer, setEscrowOfficer,
    deliverableEmails, setDeliverableEmails,
    formOpts, submitting, result, setResult,
    handleAddressSelect, handleSearchClick, handleConfirm, handleApnSearch, handleSubmit,
  };
}

export type QuickEntryState = ReturnType<typeof useQuickEntry>;
