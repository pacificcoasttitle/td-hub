'use client';

import type { SalesOrder } from './types';

export type SalesAction =
  | 'review_prelim' | 'prelim_summary' | 'update_prelim'
  | 'push_prelim_update'
  | 'regenerate_summary' | 'get_prelim_doc'
  | 'view_contacts' | 'view_detail';

interface Props {
  order: SalesOrder;
  onAction: (action: SalesAction, order: SalesOrder) => void;
  /**
   * Effective AI Prelim feature flag (admin DB flag AND env master-kill).
   * When false, the AI-driven "Prelim Summary" / "Regenerate Summary" entry
   * points are not rendered. Non-AI actions (Review/Update/Get prelim doc)
   * are unaffected. Defaults to false so the feature ships dark.
   */
  tessaPrelimEnabled?: boolean;
  /**
   * Effective Update Prelim flag (admin DB flag AND env backstop). When false
   * the button does not render. Defaults to false so it ships dark.
   */
  updatePrelimEnabled?: boolean;
}

const primaryBtn =
  'text-[11px] px-2 py-1 rounded transition-colors whitespace-nowrap';
const secondaryBtn =
  'text-[11px] px-2 py-1 rounded border border-[#DFE3EA] bg-white text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap';
const reviewPrelimBtn =
  `${primaryBtn} bg-[#F26B2B] text-white shadow-[0_10px_22px_-12px_rgba(242,107,43,0.9)] hover:bg-[#E05A1A]`;

export function OrderActions({
  order,
  onAction,
  tessaPrelimEnabled = false,
  updatePrelimEnabled = false,
}: Props) {
  const hasPrelim = !!order.hasPrelim;

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {hasPrelim ? (
        <>
          <button
            type="button"
            title="Review Prelim"
            onClick={() => onAction('review_prelim', order)}
            className={reviewPrelimBtn}
          >
            Review Prelim
          </button>
          {tessaPrelimEnabled && (
            <button
              type="button"
              title="Prelim Summary"
              onClick={() => onAction('prelim_summary', order)}
              className={`${primaryBtn} bg-blue-600 text-white hover:bg-blue-700`}
            >
              Prelim Summary
            </button>
          )}
          {/*
            The button below PUSHES an operator's PDF to SoftPro. It is not the
            'update_prelim' action, which FETCHES from SoftPro and is still
            removed from this row — read on before wiring anything to that name.

            'update_prelim' could never work here. It rendered only when
            hasPrelim === true, and fetchPrelimsForOrder early-returns the
            moment an order already has an active prelim (fetch-prelims.ts).
            Same predicate on both ends, so the click could never reach
            SoftPro: it returned documentsFound: 0 and the modal then showed
            "No prelim available yet in SoftPro" directly above the prelim it
            already had.

            Do not re-add THAT one. Catching an UPDATED prelim from the vendor
            needs change detection (the parked
            GetAttachedDocumentsPrelim/ModifiedAt polling), not another fetch
            button. "Get Prelim Doc" in the hasPrelim === false branch below is
            the real, working on-demand fetch — leave it alone.
          */}
          {updatePrelimEnabled && (
            <button
              type="button"
              title="Upload an updated prelim to SoftPro"
              onClick={() => onAction('push_prelim_update', order)}
              className={secondaryBtn}
            >
              Update Prelim
            </button>
          )}
          <button
            type="button"
            title="View Contacts"
            onClick={() => onAction('view_contacts', order)}
            className={secondaryBtn}
          >
            View Contacts
          </button>
          {tessaPrelimEnabled && (
            <button
              type="button"
              title="Regenerate Summary"
              onClick={() => onAction('regenerate_summary', order)}
              className={secondaryBtn}
            >
              Regenerate Summary
            </button>
          )}
        </>
      ) : (
        <>
          <span className="bg-blue-100 text-blue-700 text-[11px] px-2 py-1 rounded font-medium whitespace-nowrap">
            Not Ready
          </span>
          <button
            type="button"
            title="Get Prelim Doc"
            onClick={() => onAction('get_prelim_doc', order)}
            className={secondaryBtn}
          >
            Get Prelim Doc
          </button>
          <button
            type="button"
            title="View Contacts"
            onClick={() => onAction('view_contacts', order)}
            className={secondaryBtn}
          >
            View Contacts
          </button>
        </>
      )}
    </div>
  );
}
