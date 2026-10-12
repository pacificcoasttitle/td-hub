/**
 * Invite / re-invite three open-order-team people.
 *
 * Laura Copeland and Crystal Zamora already have profiles (created 31 Aug)
 * and have never signed in. This resends the same invite email the admin
 * Invite User button sends. M McCafferty is new.
 *
 *   npx tsx --env-file=.env.local scripts/audit/invite-oot-laura-crystal-mccafferty.ts
 */
import { eq } from 'drizzle-orm';
import { db } from '../../src/lib/db/client';
import { profiles } from '../../src/lib/db/schema';
import { getSupabaseAdmin } from '../../src/lib/security/supabase-admin';
import { sendEmail } from '../../src/lib/integrations/sendgrid/client';
import { buildInviteHtml, buildInviteSubject } from '../../src/lib/domain/notifications/invite-email';
import { scriptExit } from '../lib/script-exit';

const ROLE = 'open_order_team' as const;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://td-hub.pctitle.com';

const PEOPLE = [
  { email: 'lcopeland@pct.com', displayName: 'Laura Copeland', create: false },
  { email: 'czamora@pct.com', displayName: 'Crystal Zamora', create: false },
  { email: 'mmccafferty@pct.com', displayName: 'M McCafferty', create: true },
] as const;

async function sendInvite(email: string, displayName: string) {
  const supabase = getSupabaseAdmin();
  const { data: linkData, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (error) throw new Error(`generateLink ${email}: ${error.message}`);
  const magicLink = linkData?.properties?.action_link ?? null;
  const sent = await sendEmail({
    to: email,
    subject: buildInviteSubject(),
    html: buildInviteHtml(displayName, ROLE, magicLink, APP_URL),
  });
  if (!sent.success) {
    throw new Error(`sendEmail ${email}: ${sent.error?.message ?? 'failed'}`);
  }
  return { magicLinkPresent: Boolean(magicLink), sendgrid: sent.success };
}

async function main() {
  const supabase = getSupabaseAdmin();

  for (const person of PEOPLE) {
    const [existing] = await db
      .select({
        id: profiles.id,
        email: profiles.email,
        displayName: profiles.displayName,
        role: profiles.role,
        isActive: profiles.isActive,
      })
      .from(profiles)
      .where(eq(profiles.email, person.email))
      .limit(1);

    if (person.create && !existing) {
      const { data: user, error: createError } = await supabase.auth.admin.createUser({
        email: person.email,
        email_confirm: false,
        user_metadata: { display_name: person.displayName },
      });
      if (createError || !user.user) {
        throw new Error(`createUser ${person.email}: ${createError?.message ?? 'no user'}`);
      }
      await db.insert(profiles).values({
        id: user.user.id,
        email: person.email,
        displayName: person.displayName,
        role: ROLE,
      });
      const invite = await sendInvite(person.email, person.displayName);
      console.log(JSON.stringify({ action: 'created', ...person, ...invite }));
      continue;
    }

    if (!existing) {
      throw new Error(`expected a profile for ${person.email}`);
    }

    if (existing.displayName !== person.displayName || existing.role !== ROLE) {
      await db
        .update(profiles)
        .set({
          displayName: person.displayName,
          role: ROLE,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(profiles.id, existing.id));
    }

    const invite = await sendInvite(person.email, person.displayName);
    console.log(JSON.stringify({
      action: 'reinvited',
      email: person.email,
      displayName: person.displayName,
      priorDisplayName: existing.displayName,
      priorRole: existing.role,
      ...invite,
    }));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .then(() => scriptExit(process.exitCode ?? 0));
