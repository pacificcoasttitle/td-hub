import { ContactListPage } from '@/components/admin/contacts/contact-list-page';

export default function ExternalEscrowOfficersPage() {
  return (
    <ContactListPage
      title="Escrow Employees"
      subtitle="People at outside escrow companies"
      typeFilter="escrow_officer"
      scope="external"
      // Widening this page to both escrow flags (externalEscrowPersonFilter)
      // also matches 592 company_contact rows — escrow firms stored as contacts,
      // no name, no email. requireName hides them, as it does on Lender and
      // Mortgage Employees. Measured 2026-09-11: it hides none of the 722 rows
      // the page showed before the change.
      requireName
      showCompanyColumn
    />
  );
}
