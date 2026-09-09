import { ContactListPage } from '@/components/admin/contacts/contact-list-page';

export default function RealEstateAgentsPage() {
  return (
    <ContactListPage
      title="Real Estate Employees"
      subtitle="People at real estate brokerages"
      typeFilter="real_estate_agent"
      showCompanyColumn
      emptyStateMessage="No real estate agents found"
    />
  );
}
