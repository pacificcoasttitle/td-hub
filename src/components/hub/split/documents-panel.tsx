'use client';

import type { DocCatFull, OrderDocuments } from '@/components/shared/orders-hub-parts';

// ─── Documents on an order ──────────────────────────────────────────────────
//
// The hub is a fast funnel into SoftPro: orders arrive by email, the team opens
// one, and then wants to SEE it and WORK it. This panel is that, and nothing
// else.
//
// Two kinds of thing live here, and they are not interchangeable:
//
//   DOCUMENTS TO VIEW      the prelim, and the three that arrive with the
//                          open-order email — legal & vesting, grant deed,
//                          taxes. Nothing to press; either it is here or it is
//                          not.
//
//   DOCUMENTS TO CREATE    CPL and proposed insured. These are ACTIONS. A
//                          button that makes one, never a chip reporting its
//                          absence.
//
// THE PROPERTY PROFILE IS NOT HERE. It is not a document of the order — it is
// a marketing piece about a property, generated from an address, and it lives
// at /hub/property-profile reached from the nav. It was briefly a tile on this
// panel; that was wrong, because it attached an unrelated module to every order
// and put a billable action in a pane whose whole job is to be fast.
//
// ─── ABSENCE IS WORDED BY WHO MAKES THE DOCUMENT ────────────────────────────
//
//   "Not received"   — SoftPro produces it at order-open and it has not
//                      reached us. Prelim, legal & vesting, grant deed, taxes.
//
// The create actions never report absence at all. "Create CPL" is the whole
// message; a chip saying "CPL — not generated" beside a button that generates
// one is the same sentence twice.
//
// "None on file" is deliberately absent. It is true and misleading: legal &
// vesting, grant deed and taxes ARE produced at order-open, so it invites the
// reader to conclude the document does not exist when it exists and simply was
// not transmitted. See docs/tickets/ORDER_OPEN_DOCUMENTS_NEVER_REACH_THE_HUB.md
//
// Measured across all 8,036 orders: prelim 5,634 (82.6% of Title-only); legal
// & vesting / grant deed / taxes 7 each — and the IDENTICAL seven, a March test
// batch; CPL 2; proposed insured 0.

export type { OrderDocuments };
export type DocState = DocCatFull;

export type GenerateKind = 'cpl' | 'proposed' | 'prelim';

export interface DocumentsPanelProps {
  documents?: OrderDocuments;
  onGenerate: (kind: GenerateKind) => void;
  /**
   * SoftPro copy with no property. Documents are not late — they cannot
   * exist on this file. The panel says that, and does not offer Find or
   * Create as if the screen failed to load them.
   */
  shell?: boolean;
}

/**
 * Only a full record can be opened. `legalVesting`, `tax` and `grantDeed`
 * arrive as a bare `exists` boolean with no id — the API's asymmetry, not
 * ours — so they can be reported as present but not linked. A tile whose View
 * button points nowhere is worse than a chip that does not offer one.
 */
function openable(d: OrderDocuments[keyof OrderDocuments] | undefined): DocCatFull | null {
  if (!d || !d.exists) return null;
  return 'latestId' in d && d.latestId !== null ? (d as DocCatFull) : null;
}

const shortTime = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric',
  }).format(d);
};

/** Arrived with the open-order email. View only — we do not make these. */
const ARRIVING: Array<{ key: keyof OrderDocuments; label: string }> = [
  { key: 'legalVesting', label: 'Legal & vesting' },
  { key: 'grantDeed', label: 'Grant deed' },
  { key: 'tax', label: 'Taxes' },
];

export function DocumentsPanel({ documents, onGenerate, shell = false }: DocumentsPanelProps) {
  return (
    <section className="bg-white border border-[#EEF0F4] rounded-[9px]">
      <header className="h-7 flex items-center px-[13px] border-b border-[#EEF0F4]">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8A94A6]">
          Documents
        </h2>
      </header>

      <div className="px-[13px] py-[9px]">
        <PrelimTile
          doc={documents?.prelim}
          onFind={() => onGenerate('prelim')}
          shell={shell}
        />

        <div className="mt-[9px] flex flex-wrap items-center gap-[6px]">
          <span className="text-[10px] text-[#8A94A6] mr-[2px]">Order documents</span>
          {ARRIVING.map((d) => (
            <ArrivingChip
              key={d.key}
              label={d.label}
              doc={documents?.[d.key]}
              shell={shell}
            />
          ))}
        </div>

        <div className="mt-[10px] pt-[9px] border-t border-[#EEF0F4] flex flex-wrap items-center gap-[7px]">
          {shell ? (
            <p className="text-[11.5px] text-[#6B7280] leading-[1.4]">
              CPL and proposed insured need a property on the SoftPro file.
              This order has none yet.
            </p>
          ) : (
            <>
              <span className="text-[10px] text-[#8A94A6] mr-[2px]">Create</span>
              <CreateButton
                label="CPL"
                existing={openable(documents?.cpl)}
                onCreate={() => onGenerate('cpl')}
              />
              <CreateButton
                label="Proposed insured"
                existing={openable(documents?.proposedInsured)}
                onCreate={() => onGenerate('proposed')}
              />
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * The prelim. SoftPro produces it; we hold a copy in our own S3, put there by
 * the fetch_prelims job and the prelim webhook. 83% of Title-only orders have
 * one, which is why it gets the full-width tile.
 */
function PrelimTile({
  doc, onFind, shell,
}: { doc?: DocCatFull; onFind: () => void; shell: boolean }) {
  const open = openable(doc);
  const issued = open !== null;

  return (
    <div className={`border rounded-[7px] px-[11px] py-[9px] ${
      issued ? 'border-[#CFE3D6] bg-[#F6FBF8]' : 'border-[#EEF0F4]'
    }`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[12px] font-semibold text-[#1B2A4A]">Preliminary report</span>
          <span className="text-[10.5px] text-[#8A94A6] ml-[8px]">
            {issued ? (
              <>Issued {shortTime(open!.latestCreatedAt)}{open!.count > 1 && ` · ${open!.count} on file`}</>
            ) : shell ? (
              'Unavailable — SoftPro has no property on this file'
            ) : 'Not received'}
          </span>
        </div>
        <div className="flex gap-[6px] shrink-0">
          {issued ? (
            <>
              <SmallButton onClick={() => window.open(`/api/documents/${open!.latestId}/view`, '_blank', 'noopener')}>View</SmallButton>
              <SmallButton onClick={() => window.open(`/api/documents/${open!.latestId}/download`, '_blank', 'noopener')}>Download</SmallButton>
            </>
          ) : shell ? null : (
            <SmallButton primary onClick={onFind}>Find</SmallButton>
          )}
        </div>
      </div>
    </div>
  );
}

/** One of the three that come in with the open-order email. View only. */
function ArrivingChip({
  label, doc, shell,
}: { label: string; doc?: OrderDocuments[keyof OrderDocuments]; shell: boolean }) {
  const open = openable(doc);

  if (open) {
    return (
      <button
        type="button"
        onClick={() => window.open(`/api/documents/${open.latestId}/view`, '_blank', 'noopener')}
        className="text-[10.5px] border border-[#C9D6E8] bg-[#F4F7FC] rounded-md px-[8px] py-[3px] text-[#1B2A4A] font-semibold hover:bg-[#E9F0FA] outline-none focus-visible:ring-1 focus-visible:ring-brand-orange/30"
      >
        {label} — {open.count > 1 ? `${open.count} on file` : 'view'}
      </button>
    );
  }

  // Present, but with no id there is nothing to open. Say it is here rather
  // than offering a link that cannot work.
  if (doc?.exists) {
    return (
      <span className="text-[10.5px] border border-[#C9D6E8] bg-[#F4F7FC] rounded-md px-[8px] py-[3px] text-[#1B2A4A] font-semibold">
        {label} — on file
      </span>
    );
  }

  return (
    <span className="text-[10.5px] border border-[#EEF0F4] rounded-md px-[8px] py-[3px] text-[#8A94A6]">
      {label} — {shell ? 'unavailable' : 'not received'}
    </span>
  );
}

/**
 * A document we make. Always an action.
 *
 * When one already exists the button stays — a second CPL is a legitimate
 * thing to want, and the modal itself warns that generating creates a new
 * version — but the existing one is offered first, because the common case is
 * wanting to read what is already there.
 */
function CreateButton({
  label, existing, onCreate,
}: { label: string; existing: DocCatFull | null; onCreate: () => void }) {
  return (
    <span className="inline-flex items-center gap-[5px]">
      <button
        type="button"
        onClick={onCreate}
        className="h-[24px] px-[10px] rounded-md text-[10.5px] font-semibold bg-brand-orange text-white hover:bg-brand-orange-hover outline-none focus-visible:ring-1 focus-visible:ring-brand-orange/30"
      >
        Create {label}
      </button>
      {existing && (
        <button
          type="button"
          onClick={() => window.open(`/api/documents/${existing.latestId}/view`, '_blank', 'noopener')}
          className="text-[10.5px] text-[#1B2A4A] font-semibold underline decoration-[#C9D6E8] underline-offset-2 hover:decoration-[#1B2A4A] outline-none focus-visible:ring-1 focus-visible:ring-brand-orange/30 rounded"
        >
          {existing.count > 1 ? `view ${existing.count} on file` : 'view existing'}
        </button>
      )}
    </span>
  );
}

function SmallButton({
  children, onClick, primary,
}: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-[24px] px-[10px] rounded-md text-[10.5px] font-semibold outline-none focus-visible:ring-1 focus-visible:ring-brand-orange/30 ${
        primary
          ? 'bg-brand-orange text-white hover:bg-brand-orange-hover'
          : 'bg-white border border-[#DCE1EA] text-[#3C4557] hover:bg-[#F7F9FC]'
      }`}
    >
      {children}
    </button>
  );
}
