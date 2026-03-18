import { CompanyTypeListPage } from '@/components/admin/contacts/company-type-list-page';

export default function AgentsPage() {
  return <CompanyTypeListPage title="Agents" subtitle="External clients — real estate agents and brokers" companyType="selling_agent" syncUserType="Selling Agent/Broker" />;
}
