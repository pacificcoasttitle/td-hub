'use client';

import type { SalesOrder } from './types';

export type SalesAction =
  | 'review_prelim' | 'prelim_summary' | 'update_prelim'
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
}

const primaryBtn =
  'text-[11px] px-2 py-1 rounded transition-colors whitespace-nowrap';
const secondaryBtn =
  'text-[11px] px-2 py-1 rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap';
const disabledBtn =
  'text-[11px] px-2 py-1 rounded border border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed whitespace-nowrap';

export function OrderActions({ order, onAction, tessaPrelimEnabled = false }: Props) {
  const hasPrelim = !!order.hasPrelim;

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {hasPrelim ? (
        <>
          <button
            type="button"
            title="Review Prelim"
            onClick={() => onAction('review_prelim', order)}
            className={`${primaryBtn} bg-green-600 text-white hover:bg-green-700`}
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
          <button
            type="button"
            title="Update Prelim"
            onClick={() => onAction('update_prelim', order)}
            className={secondaryBtn}
          >
            Update Prelim
          </button>
          <button
            type="button"
            title="View Contacts"
            onClick={() => onAction('view_contacts', order)}
            className={secondaryBtn}
          >
            View Contacts
          </button>
          <button type="button" disabled title="Coming soon" className={disabledBtn}>
            View Invoice
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
          <button type="button" disabled title="Coming soon" className={disabledBtn}>
            View Invoice
          </button>
        </>
      )}
    </div>
  );
}
