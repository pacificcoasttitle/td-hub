import { CompanyTypeListPage } from '@/components/admin/contacts/company-type-list-page';

export default function LendersPage() {
  return <CompanyTypeListPage title="Lender Companies" subtitle="Lenders and lending institutions" companyType="lender" syncUserType="Lender" createAs="lender" />;
}
