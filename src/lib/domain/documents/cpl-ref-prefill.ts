/**
 * What a Proposed Insured letter inherits from a CPL on the same order.
 *
 * The team generates a CPL, opens Proposed Insured, and retypes the same
 * lender address, assignment clause and loan number. `cpl/service.ts` already
 * stores those on a successful CPL; nothing read them back into PI, which is
 * the whole bug. Mapping: docs/tickets/CPL_PIL_SHARED_MODAL_FIELDS.md.
 *
 * READ-ONLY. This module never writes to order_external_refs. A Proposed
 * Insured letter is a consumer of CPL input, not a second author of it — if
 * PI wrote back, an edit made while drafting a PI would silently change what
 * the next CPL starts from, and neither modal would show where the value came
 * from.
 *
 * NOT FILTERED BY `system`. `order_external_refs.system` is the underwriter
 * (`westcor` / `fnf`), and PI has no underwriter at all. Filtering would mean
 * a CPL issued on Westcor prefills a PI while the same order re-issued on FNF
 * starts blank. Reading every underwriter's refs closes that gap without an
 * `ALTER TYPE` on the enum, so there is no migration here.
 */

import { db } from '@/lib/db/client';
import { orderExternalRefs } from '@/lib/db/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';

/**
 * ALLOWLIST, deliberately not `ref_type LIKE 'cpl_%'`.
 *
 * Two cpl_* refs exist that must NOT reach this modal, and a prefix match
 * would carry both plus anything added later:
 *
 *   cpl_branch_id      — THE TRAP. CPL branches come from
 *                        /api/cpl-branches?underwriter=X (underwriter codes
 *                        like CA1038); PI branches come from /api/branches
 *                        (PCT internal, OCT/GLT). Two id spaces, one field
 *                        name, both integers in a dropdown, and nothing looks
 *                        wrong if you get it backwards. Order 20021472-GLT
 *                        holds branch 2 under westcor and 20 under fnf.
 *   cpl_lender_contact — the person at the lender ("Attention"). PI has no
 *                        such input, so there is nothing to prefill into.
 *
 * A new cpl_* ref therefore does not flow here until someone adds it to this
 * list on purpose.
 */
export const SHARED_CPL_REF_TYPES = [
  'cpl_lender_address',
  'cpl_lender_city',
  'cpl_lender_state',
  'cpl_lender_zip',
  'cpl_assignment_clause',
  'cpl_loan_number',
] as const;

export type SharedCplRefType = (typeof SHARED_CPL_REF_TYPES)[number];

export interface CplRefPrefill {
  lenderAddress?: string;
  lenderCity?: string;
  lenderState?: string;
  lenderZip?: string;
  assignmentClause?: string;
  loanNumber?: string;
}

const REF_TO_FIELD: Record<SharedCplRefType, keyof CplRefPrefill> = {
  cpl_lender_address: 'lenderAddress',
  cpl_lender_city: 'lenderCity',
  cpl_lender_state: 'lenderState',
  cpl_lender_zip: 'lenderZip',
  cpl_assignment_clause: 'assignmentClause',
  cpl_loan_number: 'loanNumber',
};

/**
 * Most recent first — with a caveat that belongs in the open, because the
 * table cannot fully honour it.
 *
 * `order_external_refs` has `created_at` and no `updated_at`, and the upsert
 * in cpl/service.ts sets only `ref_value` on conflict. So `created_at` is the
 * time a (order, system, ref_type) row was FIRST written, not when its value
 * was last edited. A Westcor ref created in July and edited today still sorts
 * behind an FNF ref first created last week.
 *
 * This only matters when one order holds the same ref_type under two
 * underwriters. Measured 2026-09-08: 1 order of 148 (`20021472-GLT`), and on
 * that order every value this module reads is IDENTICAL across westcor and
 * fnf — the only field that differs is cpl_branch_id, which is excluded above.
 * So the tie-break currently decides nothing, and adding an `updated_at`
 * column to chase it would be a migration bought for one order and no
 * observable difference.
 *
 * If that count grows, or if the two underwriters start disagreeing on a
 * shared field, this is the thing to fix and `updated_at` is the fix.
 */
export async function getCplRefPrefill(orderId: number): Promise<CplRefPrefill> {
  const rows = await db
    .select({
      refType: orderExternalRefs.refType,
      refValue: orderExternalRefs.refValue,
    })
    .from(orderExternalRefs)
    .where(and(
      eq(orderExternalRefs.orderId, orderId),
      inArray(orderExternalRefs.refType, [...SHARED_CPL_REF_TYPES]),
    ))
    .orderBy(desc(orderExternalRefs.createdAt), desc(orderExternalRefs.id));

  const prefill: CplRefPrefill = {};

  for (const row of rows) {
    const field = REF_TO_FIELD[row.refType as SharedCplRefType];
    if (!field) continue;
    // First row wins: the ordering above already put the preferred one first.
    if (prefill[field] !== undefined) continue;
    const value = row.refValue?.trim();
    if (!value) continue;
    prefill[field] = value;
  }

  return prefill;
}

/**
 * A stored CPL value wins over one derived from the order or the company
 * record, because it is what a human typed on this file — the company address
 * is a default, the CPL value is a decision. An empty or absent ref never
 * blanks a derived value.
 */
export function preferCplRef(cplValue: string | undefined, derived: string): string {
  const value = cplValue?.trim();
  return value ? value : derived;
}
