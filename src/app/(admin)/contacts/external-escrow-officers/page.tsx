import { ContactListPage } from '@/components/admin/contacts/contact-list-page';

export default function ExternalEscrowOfficersPage() {
  return (
    <ContactListPage
      title="External Escrow Officers"
      subtitle="Escrow officers at outside escrow companies"
      typeFilter="escrow_officer"
      scope="external"
      showCompanyColumn
    />
  );
}
