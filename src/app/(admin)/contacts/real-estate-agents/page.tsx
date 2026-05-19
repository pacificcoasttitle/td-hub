import { ContactListPage } from '@/components/admin/contacts/contact-list-page';

export default function RealEstateAgentsPage() {
  return (
    <ContactListPage
      title="Real Estate Agents"
      subtitle="People flagged from listing-agent assignments on PCT orders"
      typeFilter="real_estate_agent"
      showCompanyColumn
      emptyStateMessage="No real estate agents found"
    />
  );
}
