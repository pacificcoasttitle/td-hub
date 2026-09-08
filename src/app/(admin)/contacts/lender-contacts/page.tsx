import { ContactListPage } from '@/components/admin/contacts/contact-list-page';

/**
 * The people at lending institutions.
 *
 * /contacts/lenders lists the COMPANIES; this lists the people who work at
 * them. 1,704 of them existed with no page to see them on — reachable only
 * through the lender search inside the CPL and Proposed Insured modals.
 *
 * scope="external" matches /contacts/external-escrow-officers. Measured before
 * copying it: of 1,709 lender contacts it hides 5, every one carrying a
 * @pct.com address, and none with a hub login.
 */
export default function LenderContactsPage() {
  return (
    <ContactListPage
      title="Lender Contacts"
      subtitle="People at lending institutions"
      typeFilter="lender"
      scope="external"
      showCompanyColumn
      emptyStateMessage="No lender contacts found"
    />
  );
}
