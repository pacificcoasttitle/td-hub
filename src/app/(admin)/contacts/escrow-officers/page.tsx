import { ContactListPage } from '@/components/admin/contacts/contact-list-page';

export default function EscrowOfficersPage() {
  return (
    <ContactListPage
      title="Internal Escrow Officers"
      subtitle="PCT internal escrow team"
      typeFilter="escrow_officer"
      scope="internal"
      showCompanyColumn={false}
    />
  );
}
