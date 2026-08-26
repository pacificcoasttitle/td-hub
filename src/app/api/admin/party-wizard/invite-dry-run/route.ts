import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { handlePartyWizardInvite } from '@/lib/jobs/handlers/party-wizard-invite';

// ─── Party wizard invite — dry run ───────────────────────────────────────────
//
// Runs the real job with dryRun set: same candidate query, same recipient
// resolution, same templates, no link minted and no mail sent.
//
// It exists as an admin route rather than only on /api/jobs/run because that
// endpoint needs a Bearer secret no browser has, which in practice meant the
// only way to find out who this job would email was to let it email them.
//
// Reachable while sending is switched off, deliberately — reading the recipient
// list is what you do BEFORE turning it on.

/** Same pair that can toggle the sending switch, so preview and permission match. */
const PARTY_WIZARD_ADMIN_ROLES = ['super_admin', 'admin'];

export const maxDuration = 60;

export async function POST() {
  const session = await getSession();
  if (!session || !PARTY_WIZARD_ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await handlePartyWizardInvite({ dryRun: true });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[party-wizard-invite-dry-run] failed:', err);
    return NextResponse.json(
      { error: 'Dry run failed', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
