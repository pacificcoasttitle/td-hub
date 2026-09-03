'use client';

import { useEffect, useRef, useState } from 'react';
import type { ClientContact } from '@/components/admin/client-selector';
import type { ParsedAddress } from '@/components/ui/address-autocomplete';
import type { SiteXPropertyResult } from '@/components/shared/property-confirm-modal';
import {
  missingTitlePointInputs,
  describeMissingTitlePointInputs,
} from '@/lib/domain/orders/titlepoint-preconditions';
import { buildPreInitAddressKey, usePreInitOnSiteX } from '@/lib/orders/use-pre-init-on-sitex';
import { isConfidentSiteXMatch } from '@/lib/domain/titlepoint/confident-sitex';
import { toCreateOrderContact } from '@/lib/domain/orders/party-contact';
import { claimCreateInFlight, releaseCreateInFlight } from '@/lib/orders/claim-create-in-flight';
import { EP, EC, type Person, type FormOptions } from './types';
import { classifySiteXOwners } from '@/lib/domain/orders/names/classify-owners';
import { legacyToTitleCase } from '@/lib/domain/orders/names/title-case';
import { ownerTarget } from '@/lib/domain/orders/names/owner-routing';

function deriveUW(product: string): string {
  return product.toLowerCase().trim() === 'full alta' ? 'CW' : 'WC';
}

export function useQuickEntry() {
  const [client, setClientRaw] = useState<ClientContact | null>(null);
  const [deliverableEmails, setDeliverableEmails] = useState<string[]>([]);
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
  const [ownerWarnings, setOwnerWarnings] = useState<string[]>([]);

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

  const [formOpts, setFormOpts] = useState<FormOptions | null>(null);
  // A null formOpts used to mean three things at once — still loading, the call
  // failed, and the call returned nothing. The escrow officer slot has to tell
  // the operator which of those happened, so the outcome is tracked separately.
  const [formOptsStatus, setFormOptsStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  const [submitting, setSubmitting] = useState(false);
  const createInFlightRef = useRef(false);
  const [result, setResult] = useState<{
    type: 'success' | 'error';
    message: string;
    orderId?: number;
    fileNumber?: string;
    submitLocked?: boolean;
  } | null>(null);

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
        if (!d) { setFormOptsStatus('failed'); return; }
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
        setFormOptsStatus('ready');
      })
      .catch(() => setFormOptsStatus('failed'));
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

  /**
   * The ONLY place the SiteX last-first flip is applied, and it is applied to a
   * raw SiteX field. Names the operator types are never routed through here.
   *
   * Routing follows legacy: on a Purchase the record owners are the SELLERS and
   * the operator keys the buyer; on anything else the owners ARE the borrower
   * and overwrite that field.
   */
  function fillOwners(p: SiteXPropertyResult) {
    const owners = classifySiteXOwners(p.primaryOwner, p.secondaryOwner);
    setOwnerWarnings(owners.warnings);
    if (!owners.primary) return;

    if (ownerTarget(txType) === 'seller') {
      setSellerPrimary(owners.primary.person);
      setSellerIsOrg(owners.primary.isOrg);
      setSellerOrgType(owners.primary.isOrg ? owners.primary.orgType : '');
      setSellerSiteX(true);
      if (owners.secondary) {
        setSellerSecondary(owners.secondary.person);
        setHasSecondarySeller(true);
      }
    } else {
      setBorrower(owners.primary.person);
      setBorrowerIsOrg(owners.primary.isOrg);
      setBorrowerOrgType(owners.primary.isOrg ? owners.primary.orgType : '');
      setBorrowerSiteX(true);
      if (owners.secondary) {
        setSecBorrower(owners.secondary.person);
        setHasSecBorrower(true);
      }
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
    // custom.js:950-986 — legacy title-cases the street and the city and leaves
    // state and ZIP exactly as they arrive, so "CA" stays "CA".
    const nextStreet = p.fullAddress ? legacyToTitleCase(p.fullAddress) : street;
    const nextCity = p.city ? legacyToTitleCase(p.city) : city;
    const nextState = p.state || state;
    const nextZip = p.zip || zip;
    const nextApn = p.apn || apn;
    const nextCounty = p.county || county;
    const nextLegal = p.legalDescription || legalDesc;
    if (p.apn) setApn(p.apn);
    if (p.county) setCounty(p.county);
    if (p.legalDescription) setLegalDesc(p.legalDescription);
    if (p.propertyType) setPropType(p.propertyType);
    if (p.fullAddress) setStreet(nextStreet);
    if (p.city) setCity(nextCity);
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
        if (p.fullAddress) setStreet(legacyToTitleCase(p.fullAddress));
        if (p.city) setCity(legacyToTitleCase(p.city));
        if (p.state) setState(p.state);
        if (p.zip) setZip(p.zip);
        if (p.county) setCounty(p.county);
        if (p.legalDescription) setLegalDesc(p.legalDescription);
        if (p.propertyType) setPropType(p.propertyType);
        setSiteXFilled(true);
        fillOwners(p);
        if (isConfidentSiteXMatch(p)) {
          preInit.onConfidentSiteX({
            address: p.fullAddress ? legacyToTitleCase(p.fullAddress) : street,
            city: p.city ? legacyToTitleCase(p.city) : (city || 'Unknown'),
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
      } else if (data.match === 'error') {
        // We do not know whether the property exists — the search did not
        // complete. Saying "no property found" here is a claim we cannot make.
        setNoMatchMsg('The property search could not be completed. Try again, or enter the address manually.');
        preInit.onNoSiteXMatch();
      } else {
        setNoMatchMsg('No property found for this APN.');
        preInit.onNoSiteXMatch();
      }
    } catch {
      setNoMatchMsg('The property search could not be completed. Try again, or enter the address manually.');
      preInit.onNoSiteXMatch();
    } finally {
      setApnSearching(false);
    }
  }

  // ─── Submit ──────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (result?.submitLocked) return;
    if (submitting) return;

    // ─── County is required, because without it there are no documents ──────
    //
    // TitlePoint needs address, state AND county. Any one missing skipped the
    // searches entirely, and until now silently: 4 of 27 live hub orders in
    // seven days were created with no county and got no title documents at all.
    //
    // This is the entrance, not the whole fix — county has two sources and a
    // SiteX failure empties it just as effectively as a blank field. The server
    // records which input was missing whatever the cause; see
    // titlepoint-preconditions.ts. This just stops the common one at the form,
    // where the operator can still do something about it.
    const missingForTitlePoint = missingTitlePointInputs({
      address: street, state: state || 'CA', county,
    });
    if (missingForTitlePoint.length > 0) {
      setResult({ type: 'error', message: describeMissingTitlePointInputs(missingForTitlePoint) });
      return;
    }

    if (!claimCreateInFlight(createInFlightRef)) return;
    setResult(null);
    setSubmitting(true);
    try {
      const num = (s: string) => {
        const n = parseFloat(s.replace(/[^0-9.]/g, ''));
        return isNaN(n) ? 0 : n;
      };

      const payload = {
        orderType: orderType || 'Title only',
        isRushOrder: false,
        // Blank rows are how the operator adds the next one; they are not
        // addresses. Server validates again — the form is not the boundary.
        deliverableEmails: deliverableEmails.filter((e) => e.trim() !== ''),
        property: {
          address: street, city: city || 'Unknown', state: state || 'CA', zip: zip || '00000',
          apn: apn || undefined, legalDescription: legalDesc || undefined, county: county || undefined,
        },
        seller: {
          firstName: sellerPrimary.firstName || (sellerIsOrg ? sellerPrimary.lastName : '') || 'TBD',
          middleName: sellerPrimary.middleName || undefined,
          lastName: sellerIsOrg ? (sellerPrimary.lastName || '-') : (sellerPrimary.lastName || 'TBD'),
          secondaryFirstName: hasSecondarySeller ? sellerSecondary.firstName || undefined : undefined,
          secondaryMiddleName: hasSecondarySeller ? sellerSecondary.middleName || undefined : undefined,
          secondaryLastName: hasSecondarySeller ? sellerSecondary.lastName || undefined : undefined,
          isOrganization: sellerIsOrg, organizationType: sellerIsOrg ? (sellerOrgType || undefined) : undefined,
        },
        buyer: {
          firstName: borrower.firstName || (borrowerIsOrg ? borrower.lastName : '') || 'TBD',
          middleName: borrower.middleName || undefined,
          lastName: borrowerIsOrg ? (borrower.lastName || '-') : (borrower.lastName || 'TBD'),
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
      if (!res.ok) {
        setResult({
          type: 'error',
          message: body?.error ?? `Creation failed (${res.status})`,
          fileNumber: body?.fileNumber ?? undefined,
          orderId: body?.orderId ?? undefined,
          submitLocked: body?.submitLocked === true || body?.createdInSoftPro === true,
        });
        return;
      }
      setResult({ type: 'success', message: `Order ${body.fileNumber ?? body.orderId ?? ''} created.`, orderId: body.orderId ?? body.id, fileNumber: body.fileNumber ?? undefined, submitLocked: body?.submitLocked === true });
    } catch (err) {
      setResult({ type: 'error', message: err instanceof Error ? err.message : 'Order creation failed' });
    } finally {
      releaseCreateInFlight(createInFlightRef);
      setSubmitting(false);
    }
  }

  return {
    client, setClient,
    deliverableEmails, setDeliverableEmails,
    showConfirmModal, setShowConfirmModal,
    pendingAddress, noMatchMsg, setNoMatchMsg,
    apnSearching, searchMode, setSearchMode,
    street, setStreet, city, setCity, state, setState, zip, setZip,
    apn, setApn, county, setCounty, legalDesc, setLegalDesc, propType, setPropType,
    siteXFilled, ownerWarnings,
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
    formOpts, formOptsStatus, submitting, result, setResult,
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
