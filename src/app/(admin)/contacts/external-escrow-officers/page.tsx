import { ContactListPage } from '@/components/admin/contacts/contact-list-page';

export default function ExternalEscrowOfficersPage() {
  return (
    <ContactListPage
      title="Escrow Employees"
      subtitle="People at outside escrow companies"
      typeFilter="escrow_officer"
      scope="external"
      showCompanyColumn
    />
  );
}
