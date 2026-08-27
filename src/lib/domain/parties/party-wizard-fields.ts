import { z } from 'zod';
import type { partyRoleEnum } from '@/lib/db/schema/orders';

export type PartyRole = (typeof partyRoleEnum)['enumValues'][number];

// ─── Field definitions per collected role ────────────────────────────────────
//
// One registry drives the form, the API validation, the note text and the
// discrete-column mapping, so adding a role later means adding an entry here
// rather than touching four files that can drift apart.
//
// v1 collects listing_agent only. The seller contact is asked for on the same
// form but is written as its OWN submission row with role='seller', so it
// replays into SoftPro through the identical path.

export interface WizardField {
  key: string;
  label: string;
  /** Mobile keyboard + browser autofill hint. Agents fill these on phones. */
  type: 'text' | 'email' | 'tel';
  autoComplete?: string;
  required?: boolean;
  placeholder?: string;
  /** Rendered under the input; keep it short. */
  hint?: string;
}

export interface WizardSection {
  title: string;
  /** Shown when the section is optional, to explain why we are asking. */
  description?: string;
  fields: WizardField[];
}

export interface RoleFormDefinition {
  role: PartyRole;
  /** Second person — the recipient is the party, not a PCT employee. */
  heading: string;
  intro: string;
  sections: WizardSection[];
}

const LISTING_AGENT_FORM: RoleFormDefinition = {
  role: 'listing_agent',
  heading: 'Listing agent details',
  intro: 'We are handling the title work for this property. Confirming your details keeps escrow and closing documents flowing to the right place.',
  sections: [
    {
      title: 'Your details',
      fields: [
        { key: 'agentName', label: 'Your name', type: 'text', autoComplete: 'name', required: true, placeholder: 'Jane Smith' },
        { key: 'agentEmail', label: 'Email', type: 'email', autoComplete: 'email', required: true, placeholder: 'jane@brokerage.com' },
        { key: 'agentPhone', label: 'Phone', type: 'tel', autoComplete: 'tel', placeholder: '(555) 555-5555' },
        { key: 'agentCompany', label: 'Brokerage', type: 'text', autoComplete: 'organization', placeholder: 'Coast Realty' },
      ],
    },
    {
      title: 'Seller contact',
      description: 'Optional — only if you have it to hand. It saves escrow chasing it later.',
      fields: [
        { key: 'sellerName', label: 'Seller name', type: 'text', placeholder: 'Optional' },
        { key: 'sellerEmail', label: 'Seller email', type: 'email', placeholder: 'Optional' },
        { key: 'sellerPhone', label: 'Seller phone', type: 'tel', placeholder: 'Optional' },
      ],
    },
  ],
};

const FORMS: Partial<Record<PartyRole, RoleFormDefinition>> = {
  listing_agent: LISTING_AGENT_FORM,
};

export function getRoleForm(role: PartyRole): RoleFormDefinition | null {
  return FORMS[role] ?? null;
}

/** Roles the wizard can currently collect. Used to reject a link for anything else. */
export const SUPPORTED_WIZARD_ROLES = Object.keys(FORMS) as PartyRole[];

// ─── Validation ──────────────────────────────────────────────────────────────

/** Trim, and treat a whitespace-only field as absent rather than as "". */
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const listingAgentSubmissionSchema = z.object({
  agentName: z.string().trim().min(1, 'Name is required').max(200),
  agentEmail: z.string().trim().email('Enter a valid email').max(200),
  agentPhone: optionalText(50),
  agentCompany: optionalText(200),
  sellerName: optionalText(200),
  // Optional, but must look like an email when supplied.
  sellerEmail: z.union([z.literal(''), z.string().trim().email('Enter a valid seller email').max(200)])
    .optional()
    .transform((v) => (v ? v : undefined)),
  sellerPhone: optionalText(50),
  /**
   * The agent told us the seller name we showed them is wrong.
   *
   * Carried as the string 'true' because every other value in the form payload
   * is a string and a lone boolean would be the one field that needed special
   * handling on both sides. It changes nothing about the party columns — it
   * only rides into the note, where a human can act on it.
   */
  counterpartFlagged: z.string().trim().max(10)
    .transform((v) => (v === 'true' ? ('true' as const) : undefined))
    .optional(),
});

export type ListingAgentSubmission = z.infer<typeof listingAgentSubmissionSchema>;

export function getSubmissionSchema(role: PartyRole): z.ZodTypeAny | null {
  if (role === 'listing_agent') return listingAgentSubmissionSchema;
  return null;
}

// ─── Mapping to the discrete replay columns ──────────────────────────────────

export interface PartyColumns {
  submittedName: string | null;
  submittedCompany: string | null;
  submittedEmail: string | null;
  submittedPhone: string | null;
}

/** The party named by `role` itself — what a SoftPro replay would write. */
export function toPartyColumns(role: PartyRole, values: ListingAgentSubmission): PartyColumns {
  if (role === 'listing_agent') {
    return {
      submittedName: values.agentName ?? null,
      submittedCompany: values.agentCompany ?? null,
      submittedEmail: values.agentEmail ?? null,
      submittedPhone: values.agentPhone ?? null,
    };
  }
  return { submittedName: null, submittedCompany: null, submittedEmail: null, submittedPhone: null };
}

/**
 * The seller the agent named, if any — a separate submission row.
 * Returns null when nothing usable was given, so we never write an empty party.
 */
export function toSellerColumns(values: ListingAgentSubmission): PartyColumns | null {
  if (!values.sellerName && !values.sellerEmail && !values.sellerPhone) return null;
  return {
    submittedName: values.sellerName ?? null,
    submittedCompany: null,
    submittedEmail: values.sellerEmail ?? null,
    submittedPhone: values.sellerPhone ?? null,
  };
}
