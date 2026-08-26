'use client';

import type { ProfileSummary } from '@/lib/domain/concierge/profiles';

// ─── Documents — the panel that answers "did this already happen?" ──────────
//
// The behaviour that matters: an ISSUED TILE NEVER OFFERS GENERATE. Today the
// team fires an action to discover whether it already ran, and cannot see the
// document they produced without leaving the hub.
//
// ─── ABSENCE IS NOT THE SAME SENTENCE FOR EVERY DOCUMENT ────────────────────
//
// CPL, Prelim and Proposed Insured read "None on file" when absent — a claim
// about OUR records and nothing more.
//
// They must NOT read "Not generated". SoftPro returns an empty document list
// for prelims on 410 of 418 Title & Escrow orders, and we do not know whether
// those documents exist somewhere the endpoint does not expose. A tile
// asserting "not generated" would tell an operator to stop looking for
// something that may be sitting in a folder we cannot see. "None on file" is
// true either way.
//
// Property Profile reads "Not generated", because we are the only thing that
// makes one. There is no folder it could be hiding in.

export interface DocState {
  exists: boolean;
  latestId: number | null;
  latestCreatedAt: string | null;
  count: number;
}

export interface DocumentsPanelProps {
  documents?: {
    cpl?: DocState;
    prelim?: DocState;
    proposedInsured?: DocState;
  };
  profile: ProfileSummary | null;
  profileLoading: boolean;
  canGenerateProfile: boolean;
  profileFeatureOn: boolean;
  busyProfile: boolean;
  onGenerateProfile: () => void;
  onAdjustProfile: () => void;
  onRetryProfileRender: () => void;
  onGenerate: (kind: 'cpl' | 'proposed' | 'prelim') => void;
}

const shortTime = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric',
  }).format(d);
};

export function DocumentsPanel(p: DocumentsPanelProps) {
  return (
    <section className="bg-white border border-[#E9EAEE] rounded-[9px]">
      <header className="h-7 flex items-center px-[13px] border-b border-[#F0F1F3]">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9AA0AA]">Documents</h2>
      </header>
      <div className="px-[13px] py-[9px] grid grid-cols-4 gap-[10px]">
        <SoftProTile
          title="Closing Protection Letter"
          doc={p.documents?.cpl}
          onGenerate={() => p.onGenerate('cpl')}
        />
        <SoftProTile
          title="Proposed Insured"
          doc={p.documents?.proposedInsured}
          onGenerate={() => p.onGenerate('proposed')}
        />
        <SoftProTile
          title="Preliminary Report"
          doc={p.documents?.prelim}
          onGenerate={() => p.onGenerate('prelim')}
          generateLabel="Find"
        />
        <ProfileTile {...p} />
      </div>
    </section>
  );
}

/**
 * A document SoftPro owns. Absence is reported as "None on file" — see the
 * module note. Never "Not generated".
 */
function SoftProTile({
  title, doc, onGenerate, generateLabel = 'Generate',
}: {
  title: string;
  doc?: DocState;
  onGenerate: () => void;
  generateLabel?: string;
}) {
  const issued = !!doc?.exists && doc.latestId !== null;
  return (
    <Tile title={title} issued={issued}>
      {issued ? (
        <>
          <Meta>
            Issued {shortTime(doc!.latestCreatedAt)}
            {doc!.count > 1 && ` · ${doc!.count} on file`}
          </Meta>
          <Row>
            <TileButton onClick={() => window.open(`/api/documents/${doc!.latestId}/view`, '_blank', 'noopener')}>View</TileButton>
            <TileButton onClick={() => window.open(`/api/documents/${doc!.latestId}/download`, '_blank', 'noopener')}>Download</TileButton>
          </Row>
        </>
      ) : (
        <>
          {/* Deliberate wording. We know our records are empty; we do NOT know
              the document was never produced. */}
          <Meta>None on file</Meta>
          <Row><TileButton primary onClick={onGenerate}>{generateLabel}</TileButton></Row>
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
  const title = 'Property Profile';

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
      {/* True: nothing else produces this document. */}
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

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function Tile({
  title, issued, tone, children,
}: {
  title: string;
  issued?: boolean;
  tone?: 'warn';
  children: React.ReactNode;
}) {
  const border = tone === 'warn' ? 'border-[#EFD9AE] bg-[#FDF9F2]'
    : issued ? 'border-[#CDE8DA] bg-[#F7FCF9]'
    : 'border-[#E9EAEE] bg-white';
  const dot = tone === 'warn' ? '#D69A2E' : issued ? '#3FA97C' : '#C9CDD4';
  return (
    <div className={`border rounded-[8px] p-[9px] min-h-[66px] flex flex-col gap-[4px] ${border}`}>
      <div className="flex items-start gap-[5px]">
        <span className="w-[6px] h-[6px] rounded-full mt-[4px] shrink-0" style={{ background: dot }} aria-hidden />
        <span className="text-[10.5px] font-semibold text-[#3C4557] leading-[1.25]">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Meta({ children, title }: { children: React.ReactNode; title?: string }) {
  return <p className="text-[10px] text-[#6B7280] leading-[1.3]" title={title}>{children}</p>;
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-[5px] mt-auto pt-[3px]">{children}</div>;
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
      className={[
        'h-6 px-[8px] rounded-[5px] text-[10.5px] font-semibold transition-colors',
        'outline-none focus-visible:ring-1 focus-visible:ring-brand-orange/30 disabled:opacity-50',
        primary
          ? 'bg-brand-orange text-white hover:bg-brand-orange-hover'
          : 'bg-white border border-[#E5E5E5] text-[#3C4557] hover:bg-[#FAFAFB]',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
