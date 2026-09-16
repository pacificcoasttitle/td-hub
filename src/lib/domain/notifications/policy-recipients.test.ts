import { describe, expect, it } from 'vitest';
import { missingPolicyRoles, policySendLine, type PolicyRecipientResolution } from './policy-recipients';

const escrow = { email: 'escrow@bridge.com', name: 'Adriana', role: 'escrow_company' };
const lender = { email: 'lender@bank.com', name: 'Wells', role: 'lender' };
const owner = { email: 'buyer@home.com', name: 'Jordan', role: 'buyer' };

function resolved(partial: Partial<PolicyRecipientResolution>): PolicyRecipientResolution {
  return {
    kind: 'lender_policy',
    ok: true,
    missing: [],
    escrow: null,
    lender: null,
    owner: null,
    ...partial,
  };
}

describe('missingPolicyRoles', () => {
  it('needs escrow and lender for a lender policy', () => {
    expect(missingPolicyRoles('lender_policy', { escrow, lender, owner: null })).toEqual([]);
    expect(missingPolicyRoles('lender_policy', { escrow, lender: null, owner: null })).toEqual(['lender']);
  });

  it('needs the owner for an owner policy — the party-wizard gap', () => {
    expect(missingPolicyRoles('owner_policy', { escrow, lender, owner: null })).toEqual(['owner']);
    expect(missingPolicyRoles('owner_policy', { escrow: null, lender: null, owner })).toEqual([]);
  });

  it('needs escrow for a supplement', () => {
    expect(missingPolicyRoles('supplement', { escrow: null, lender, owner })).toEqual(['escrow']);
  });
});

describe('policySendLine', () => {
  it('sends a lender policy to escrow and copies the lender', () => {
    expect(policySendLine(resolved({ kind: 'lender_policy', escrow, lender }))).toEqual({
      to: escrow,
      cc: [lender],
    });
  });

  it('sends an owner policy only to the owner', () => {
    expect(policySendLine(resolved({ kind: 'owner_policy', owner }))).toEqual({
      to: owner,
      cc: [],
    });
  });

  it('refuses a line when a required party is missing', () => {
    expect(policySendLine(resolved({ kind: 'owner_policy', ok: false, missing: ['owner'], owner: null }))).toBeNull();
  });
});
