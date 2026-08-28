'use client';

import type { ProfileSummary } from '@/lib/domain/concierge/profiles';
import type { DocCatFull, OrderDocuments } from '@/components/shared/orders-hub-parts';

// ─── Documents — the panel that answers "did this already happen?" ──────────
//
// The behaviour that matters: an ISSUED TILE NEVER OFFERS GENERATE. Today the
// team fires an action to discover whether it already ran, and cannot see the
// document they produced without leaving the hub.
//
// ─── TWO TILES AND FIVE CHIPS, AND THE SPLIT IS MEASURED ────────────────────
//
// Across all 8,036 orders:
//
//   Preliminary report   5,634 orders   70.1%   ← tile
//   Property profile         — ours to make     ← tile
//   Legal & vesting          7 orders   0.09%   ← chip
//   Grant deed               7 orders   0.09%   ← chip
//   Taxes                    7 orders   0.09%   ← chip
//   CPL                      2 orders   0.02%   ← chip
//   Proposed insured         0 orders   0%      ← chip
//
// The seven-order sets for legal & vesting, grant deed and taxes are the
// IDENTICAL seven orders — a March test batch. Five equal tiles would give
// two-thirds of the panel to documents that are absent on 99.9% of orders,
// which is the empty-pane problem restated. They are chips until the
// AddDocuments batching fix lands, then re-measured and promoted.
//
// ─── ABSENCE IS NOT THE SAME SENTENCE FOR EVERY DOCUMENT ────────────────────
//
// The rule is WHO MAKES IT, not tile-versus-chip:
//
//   "Not received"   — produced by SoftPro at order-open, has not reached us.
//                      Prelim, legal & vesting, grant deed, taxes.
//   "Not generated"  — ours to produce, and nobody has.
//                      CPL, proposed insured, property profile.
//
// "None on file" was the earlier wording for everything SoftPro-sourced. It is
// true and it is misleading: legal & vesting, grant deed and taxes ARE produced
// at order-open, so a reader seeing "none on file" concludes the document does
// not exist when it exists and simply has not been transmitted. "Not received"
// says the same thing about our records without the false implication.
//
// Measurement also moved two documents across the line. CPL and proposed
// insured are NOT SoftPro-sourced — generateProposedInsured and the FNF CPL
// path are both ours — so "not received" would blame an upstream system for
// failing to send something it was never asked for.

/**
 * Re-exported so the pane's own modules do not each reach into the shared
 * component file for it.
 *
 * NOTE THE ASYMMETRY, which is the API's and not ours: cpl, prelim and
 * proposedInsured arrive as DocCatFull (id, count, date — enough to open the
 * document). legalVesting, tax and grantDeed arrive as a bare `exists` boolean
 * with no id, so those three CANNOT be linked even when present. Their chips
 * report existence only. Worth fixing when the batching work makes them real.
 */
export type { OrderDocuments };
export type DocState = DocCatFull;

/** Only a full record can be opened. A bare `exists` flag cannot. */
function openable(d: OrderDocuments[keyof OrderDocuments] | undefined): DocCatFull | null {
  if (!d || !d.exists) return null;
  return 'latestId' in d && d.latestId !== null ? (d as DocCatFull) : null;
}

export type GenerateKind = 'cpl' | 'proposed' | 'prelim';

export interface DocumentsPanelProps {
  documents?: OrderDocuments;
  profile: ProfileSummary | null;
  profileLoading: boolean;
  canGenerateProfile: boolean;
  profileFeatureOn: boolean;
  busyProfile: boolean;
  onGenerateProfile: () => void;
  onAdjustProfile: () => void;
  onRetryProfileRender: () => void;
  onGenerate: (kind: GenerateKind) => void;
}

const shortTime = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric',
  }).format(d);
};

/** The five that are absent on essentially every order. Order is deliberate:
 *  the three that WILL fill in after the batching fix come first. */
const CHIPS: Array<{
  key: keyof OrderDocuments;
  label: string;
  /** Who produces it decides the absent wording. */
  absent: 'Not received' | 'Not generated';
}> = [
  { key: 'legalVesting', label: 'Legal & vesting', absent: 'Not received' },
  { key: 'grantDeed', label: 'Grant deed', absent: 'Not received' },
  { key: 'tax', label: 'Taxes', absent: 'Not received' },
  { key: 'cpl', label: 'CPL', absent: 'Not generated' },
  { key: 'proposedInsured', label: 'Proposed insured', absent: 'Not generated' },
];

export function DocumentsPanel(p: DocumentsPanelProps) {
  return (
    <section className="bg-white border border-[#EEF0F4] rounded-[9px]">
      <header className="h-7 flex items-center px-[13px] border-b border-[#EEF0F4]">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8A94A6]">
          Documents
        </h2>
      </header>

      <div className="px-[13px] py-[9px]">
        <div className="grid grid-cols-2 gap-[10px]">
          <PrelimTile doc={p.documents?.prelim} onFind={() => p.onGenerate('prelim')} />
          <ProfileTile {...p} />
        </div>

        <div className="mt-[10px] pt-[8px] border-t border-[#EEF0F4] flex flex-wrap items-center gap-[6px]">
          <span className="text-[10px] text-[#8A94A6] mr-[2px]">Also on file</span>
          {CHIPS.map((c) => (
            <DocChip
              key={c.key}
              label={c.label}
              absent={c.absent}
              doc={p.documents?.[c.key]}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The prelim. SoftPro produces it; we hold a copy in our own S3, put there by
 * the fetch_prelims job and the prelim webhook. 83% of Title-only orders have
 * one, which is why it is a tile.
 *
 * Absent reads "Not received" — our records are empty, and the document may
 * well exist upstream. It must never read "Not generated".
 */
function PrelimTile({ doc, onFind }: { doc?: DocCatFull; onFind: () => void }) {
  const open = openable(doc);
  const issued = open !== null;
  return (
    <Tile title="Preliminary report" issued={issued}>
      {issued ? (
        <>
          <Meta>
            Issued {shortTime(open!.latestCreatedAt)}
            {open!.count > 1 && ` · ${open!.count} on file`}
          </Meta>
          <Row>
            <TileButton onClick={() => window.open(`/api/documents/${open!.latestId}/view`, '_blank', 'noopener')}>View</TileButton>
            <TileButton onClick={() => window.open(`/api/documents/${open!.latestId}/download`, '_blank', 'noopener')}>Download</TileButton>
          </Row>
        </>
      ) : (
        <>
          <Meta>Not received</Meta>
          {/* "Find", not "Generate" — you do not generate a prelim, you look
              for one SoftPro may already hold. */}
          <Row><TileButton primary onClick={onFind}>Find</TileButton></Row>
        </>
      )}
    </Tile>
  );
}

/**
 * The Property Profile. We are the only thing that makes one, so "Not
 * generated" is a true statement rather than a guess about another system.
 */
function ProfileTile({
  profile, profileLoading, canGenerateProfile, profileFeatureOn, busyProfile,
  onGenerateProfile, onAdjustProfile, onRetryProfileRender,
}: DocumentsPanelProps) {
  const title = 'Property profile';

  if (profileLoading) return <Tile title={title}><Meta>Checking…</Meta></Tile>;

  // Retrieval succeeded but the document did not render. The data is paid for
  // and stored, so the way out is free and the tile says so.
  if (profile && profile.status === 'failed' && profile.canRenderFree) {
    return (
      <Tile title={title} tone="warn">
        <Meta>Document not produced</Meta>
        <Row>
          <TileButton primary disabled={busyProfile} onClick={onRetryProfileRender}>
            {busyProfile ? 'Retrying…' : 'Retry — free'}
          </TileButton>
        </Row>
      </Tile>
    );
  }

  // The call itself failed. Nothing is stored, so there is nothing to retry for
  // free — and the tile must not offer a button that quietly costs a credit.
  if (profile && profile.status === 'failed') {
    return (
      <Tile title={title} tone="warn">
        <Meta title={profile.errorMessage ?? undefined}>
          {truncate(profile.errorMessage ?? 'Could not retrieve property data', 44)}
        </Meta>
        {canGenerateProfile && profileFeatureOn && (
          <Row><TileButton onClick={onGenerateProfile}>Try again — 1 credit</TileButton></Row>
        )}
      </Tile>
    );
  }

  if (profile && profile.hasPdf) {
    return (
      <Tile title={title} issued>
        <Meta>
          Issued {shortTime(profile.createdAt)} · {profile.compsShown} comps
        </Meta>
        <Row>
          <TileButton onClick={() => window.open(`/api/concierge/profiles/${profile.id}/pdf`, '_blank', 'noopener')}>View</TileButton>
          <TileButton onClick={() => window.open(`/api/concierge/profiles/${profile.id}/pdf?download=1`, '_blank', 'noopener')}>Download</TileButton>
        </Row>
        {canGenerateProfile && (
          <Row>
            {/* Free, always. The comparables were bought once; the criteria are
                ours. This must never read like it costs anything. */}
            <TileButton onClick={onAdjustProfile}>Adjust comparables — free</TileButton>
          </Row>
        )}
      </Tile>
    );
  }

  if (profile && (profile.status === 'pending' || profile.status === 'retrieved')) {
    return <Tile title={title}><Meta>Generating…</Meta></Tile>;
  }

  return (
    <Tile title={title}>
      <Meta>Not generated</Meta>
      {canGenerateProfile && profileFeatureOn && (
        <Row>
          <TileButton primary disabled={busyProfile} onClick={onGenerateProfile}>
            Generate — 1 credit
          </TileButton>
        </Row>
      )}
      {canGenerateProfile && !profileFeatureOn && <Meta>Not enabled</Meta>}
    </Tile>
  );
}

/**
 * One of the five that are absent on essentially every order. A chip, not a
 * tile — but a chip that becomes a working link the moment a document appears,
 * so the day the batching fix lands these start opening documents without any
 * further change here.
 */
function DocChip({
  label, absent, doc,
}: { label: string; absent: string; doc?: OrderDocuments[keyof OrderDocuments] }) {
  const open = openable(doc);

  // Present, and we hold enough to open it.
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

  // Present, but the API gives no id for this category, so it cannot be
  // opened. Say it is on file rather than offering a link that cannot work.
  if (doc?.exists) {
    return (
      <span className="text-[10.5px] border border-[#C9D6E8] bg-[#F4F7FC] rounded-md px-[8px] py-[3px] text-[#1B2A4A] font-semibold">
        {label} — on file
      </span>
    );
  }

  return (
    <span className="text-[10.5px] border border-[#EEF0F4] rounded-md px-[8px] py-[3px] text-[#8A94A6]">
      {label} — {absent.toLowerCase()}
    </span>
  );
}

// ─── Tile chrome ────────────────────────────────────────────────────────────

const TONE = {
  plain: 'border-[#EEF0F4]',
  issued: 'border-[#CFE3D6] bg-[#F6FBF8]',
  warn: 'border-[#EFD9AE] bg-[#FDF9F2]',
} as const;

function Tile({
  title, issued, tone, children,
}: {
  title: string;
  issued?: boolean;
  tone?: 'warn';
  children: React.ReactNode;
}) {
  const t = tone === 'warn' ? TONE.warn : issued ? TONE.issued : TONE.plain;
  return (
    <div className={`border rounded-[7px] px-[10px] py-[8px] min-h-[74px] flex flex-col ${t}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-semibold text-[#1B2A4A] truncate">{title}</span>
        {issued && (
          <span className="shrink-0 text-[9.5px] font-semibold text-[#2F7D53] uppercase tracking-[0.06em]">
            Issued
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Meta({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <p className="text-[10.5px] text-[#8A94A6] mt-[3px] truncate" title={title}>{children}</p>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-[6px] mt-[6px] flex-wrap">{children}</div>;
}

function TileButton({
  children, onClick, primary, disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-[22px] px-[8px] rounded-[5px] text-[10.5px] font-semibold outline-none focus-visible:ring-1 focus-visible:ring-brand-orange/30 disabled:opacity-40 ${
        primary
          ? 'bg-brand-orange text-white hover:bg-brand-orange-hover'
          : 'bg-white border border-[#DCE1EA] text-[#3C4557] hover:bg-[#F7F9FC]'
      }`}
    >
      {children}
    </button>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
