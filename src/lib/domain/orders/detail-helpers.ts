import { contacts, companies, profiles } from '@/lib/db/schema';
import { alias } from 'drizzle-orm/pg-core';

/* ── Table Aliases ─────────────────────────────────────────────────────────── */

export const escrowOfficerContact = alias(contacts, 'escrow_officer');
export const lenderContact = alias(contacts, 'lender_contact');
export const listingAgentContact = alias(contacts, 'listing_agent');
export const salesRepContact = alias(contacts, 'sales_rep');
export const titleOfficerContact = alias(contacts, 'title_officer');
export const titleCompanyAlias = alias(companies, 'title_company');
export const underwriterAlias = alias(companies, 'underwriter_company');
export const createdByProfile = alias(profiles, 'created_by_profile');

/* ── Types ─────────────────────────────────────────────────────────────────── */

export interface ContactNameFields {
  fullName: string | null;
  officerName: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
}

export interface PartyRow {
  role: string;
  isPrimary: boolean | null;
  externalName: string | null;
  externalCompany: string | null;
  externalEmail: string | null;
  externalPhone: string | null;
}

/* ── Helpers ───────────────────────────────────────────────────────────────── */

export function contactDisplayName(c: ContactNameFields | null): string | null {
  if (!c) return null;
  if (c.fullName) return c.fullName;
  if (c.officerName) return c.officerName;
  const parts = [c.firstName, c.lastName].filter(Boolean);
  if (parts.length > 0) return parts.join(' ');
  if (c.companyName) return c.companyName;
  return null;
}

export function splitName(fullStr: string | null): { firstName: string | null; lastName: string | null } {
  if (!fullStr) return { firstName: null, lastName: null };
  const parts = fullStr.trim().split(/\s+/);
  return {
    firstName: parts[0] ?? null,
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null,
  };
}

export function formatParty(p: PartyRow | null) {
  if (!p) return null;
  const { firstName, lastName } = splitName(p.externalName);
  return {
    firstName,
    lastName,
    email: p.externalEmail ?? null,
    phone: p.externalPhone ?? null,
    company: p.externalCompany ?? null,
  };
}
