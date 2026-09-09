import { CompanyTypeListPage } from '@/components/admin/contacts/company-type-list-page';

export default function MortgageBrokersPage() {
  return <CompanyTypeListPage title="Mortgage Companies" subtitle="Mortgage brokerages" companyType="mortgage_broker" syncUserType="Mortgage Broker" createAs="mortgage_broker" />;
}
