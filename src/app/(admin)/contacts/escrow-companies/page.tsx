import { CompanyTypeListPage } from '@/components/admin/contacts/company-type-list-page';

export default function EscrowCompaniesPage() {
  return <CompanyTypeListPage title="Escrow Companies" subtitle="External clients — escrow companies and their contacts" companyType="escrow_company" syncUserType="Escrow Company" />;
}
