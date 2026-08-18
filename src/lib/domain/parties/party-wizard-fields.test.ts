import { describe, expect, it } from 'vitest';
import {
  getRoleForm,
  getSubmissionSchema,
  listingAgentSubmissionSchema,
  SUPPORTED_WIZARD_ROLES,
  toPartyColumns,
  toSellerColumns,
  type ListingAgentSubmission,
} from './party-wizard-fields';

const valid = { agentName: 'Jane Smith', agentEmail: 'jane@brokerage.com' };

describe('listing agent submission validation', () => {
  it('accepts the minimum: name and email', () => {
    const r = listingAgentSubmissionSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it.each([
    ['missing name', { agentEmail: 'a@b.com' }],
    ['blank name', { agentName: '   ', agentEmail: 'a@b.com' }],
    ['missing email', { agentName: 'Jane' }],
    ['malformed email', { agentName: 'Jane', agentEmail: 'not-an-email' }],
  ])('rejects %s', (_label, input) => {
    expect(listingAgentSubmissionSchema.safeParse(input).success).toBe(false);
  });

  it('rejects an over-long name rather than truncating into the column', () => {
    const r = listingAgentSubmissionSchema.safeParse({ ...valid, agentName: 'x'.repeat(201) });
    expect(r.success).toBe(false);
  });

  it('trims surrounding whitespace', () => {
    const r = listingAgentSubmissionSchema.safeParse({
      agentName: '  Jane Smith  ', agentEmail: '  jane@brokerage.com  ',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.agentName).toBe('Jane Smith');
      expect(r.data.agentEmail).toBe('jane@brokerage.com');
    }
  });

  it('treats a whitespace-only optional field as absent, not as an empty string', () => {
    const r = listingAgentSubmissionSchema.safeParse({ ...valid, agentCompany: '   ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.agentCompany).toBeUndefined();
  });

  it('allows an omitted seller email but rejects a malformed one', () => {
    expect(listingAgentSubmissionSchema.safeParse({ ...valid, sellerEmail: '' }).success).toBe(true);
    expect(listingAgentSubmissionSchema.safeParse({ ...valid, sellerEmail: 'nope' }).success).toBe(false);
  });
});

describe('mapping to replay columns', () => {
  const full: ListingAgentSubmission = {
    agentName: 'Jane Smith',
    agentEmail: 'jane@brokerage.com',
    agentPhone: '5625550101',
    agentCompany: 'Coast Realty',
    sellerName: 'Sam Seller',
    sellerEmail: 'sam@example.com',
    sellerPhone: '5625550202',
  };

  it('maps the agent onto the discrete columns a CreateUser replay needs', () => {
    expect(toPartyColumns('listing_agent', full)).toEqual({
      submittedName: 'Jane Smith',
      submittedCompany: 'Coast Realty',
      submittedEmail: 'jane@brokerage.com',
      submittedPhone: '5625550101',
    });
  });

  it('uses null, not undefined, so the columns insert cleanly', () => {
    const cols = toPartyColumns('listing_agent', { ...valid } as ListingAgentSubmission);
    expect(cols.submittedCompany).toBeNull();
    expect(cols.submittedPhone).toBeNull();
  });

  it('splits the seller into its own party so it replays through the same path', () => {
    expect(toSellerColumns(full)).toEqual({
      submittedName: 'Sam Seller',
      submittedCompany: null,
      submittedEmail: 'sam@example.com',
      submittedPhone: '5625550202',
    });
  });

  it('returns null when no seller was given, so we never write an empty party', () => {
    expect(toSellerColumns({ ...valid } as ListingAgentSubmission)).toBeNull();
  });

  it('accepts a seller with only one field filled in', () => {
    const partial = { ...valid, sellerName: 'Sam Seller' } as ListingAgentSubmission;
    expect(toSellerColumns(partial)?.submittedName).toBe('Sam Seller');
  });
});

describe('role registry', () => {
  it('v1 supports listing_agent only', () => {
    expect(SUPPORTED_WIZARD_ROLES).toEqual(['listing_agent']);
    expect(getRoleForm('listing_agent')).not.toBeNull();
    expect(getRoleForm('buyer_agent')).toBeNull();
    expect(getSubmissionSchema('buyer_agent')).toBeNull();
  });

  it('marks exactly name and email as required', () => {
    const form = getRoleForm('listing_agent')!;
    const required = form.sections.flatMap((s) => s.fields).filter((f) => f.required).map((f) => f.key);
    expect(required).toEqual(['agentName', 'agentEmail']);
  });

  it('gives every field a mobile keyboard hint', () => {
    const form = getRoleForm('listing_agent')!;
    for (const field of form.sections.flatMap((s) => s.fields)) {
      expect(['text', 'email', 'tel']).toContain(field.type);
    }
  });

  it('asks nothing beyond listing-agent scope plus the seller contact', () => {
    const form = getRoleForm('listing_agent')!;
    const keys = form.sections.flatMap((s) => s.fields).map((f) => f.key).sort();
    expect(keys).toEqual([
      'agentCompany', 'agentEmail', 'agentName', 'agentPhone',
      'sellerEmail', 'sellerName', 'sellerPhone',
    ]);
  });
});
