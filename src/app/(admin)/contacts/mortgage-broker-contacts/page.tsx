import { ContactListPage } from '@/components/admin/contacts/contact-list-page';

/**
 * The people at mortgage brokerages. /contacts/mortgage-brokers lists the
 * COMPANIES; this lists the people. See lender-contacts for why scope is
 * external — the same measurement gave 2 hidden of 1,002 here.
 */
export default function MortgageBrokerContactsPage() {
  return (
    <ContactListPage
      title="Mortgage Employees"
      subtitle="People at mortgage brokerages"
      typeFilter="mortgage_broker"
      scope="external"
      showCompanyColumn
      requireName
      emptyStateMessage="No mortgage broker contacts found"
    />
  );
}
