import { CompanyTypeListPage } from '@/components/admin/contacts/company-type-list-page';

export default function AgentsPage() {
  return (
    <CompanyTypeListPage
      title="Real Estate Companies"
      subtitle="Brokerages linked to real estate agents on PCT orders"
      companyType="real_estate_company"
    />
  );
}
