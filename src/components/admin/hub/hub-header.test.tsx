import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/hub' }));
vi.mock('@/lib/security/sign-out', () => ({ handleSignOut: () => {} }));

const { HubHeader } = await import('./hub-header');

// The hub top bar is the WHOLE navigation of the shell the operators work in —
// there is no sidebar here. Rendered and read as text rather than grepped: a
// nav that renders nothing still contains its own source.
function visible(role: string): string {
  return renderToStaticMarkup(<HubHeader displayName="Jerry Hernandez" role={role} />)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('the hub header', () => {
  it('offers Reports to the operators who work here', () => {
    // open_order_team are the nine people the concierge profile is for, and the
    // hub is where they spend the day. Before this, Reports was three clicks
    // and a change of shell away.
    expect(visible('open_order_team')).toContain('Reports');
  });

  it('offers it to admins too', () => {
    expect(visible('super_admin')).toContain('Reports');
    expect(visible('admin')).toContain('Reports');
  });

  it('withholds it from hub roles that cannot generate one', () => {
    // escrow_assistant and cs_admin reach the hub but are not on
    // CONCIERGE_GENERATE_ROLES, and the sidebar does not offer them Reports
    // either. Two doors, one answer.
    expect(visible('escrow_assistant')).not.toContain('Reports');
    expect(visible('cs_admin')).not.toContain('Reports');
  });

  it('still shows the orders links to every hub role', () => {
    for (const role of ['open_order_team', 'escrow_assistant', 'cs_admin', 'admin', 'super_admin']) {
      expect(visible(role), role).toContain('Orders');
      expect(visible(role), role).toContain('New Order');
    }
  });

  it('shows nothing at all to a role with no paths, rather than everything', () => {
    // A missing role must fail closed. `NAV_BY_ROLE[role] ?? []` is what makes
    // that true, and it is one keystroke from being wrong.
    const text = visible('title_production');
    expect(text).not.toContain('Reports');
    expect(text).not.toContain('New Order');
  });
});
