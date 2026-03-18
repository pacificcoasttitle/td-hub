import { CompanyTypeListPage } from '@/components/admin/contacts/company-type-list-page';

export default function LendersPage() {
  return <CompanyTypeListPage title="Lenders" subtitle="External clients — lenders and lending institutions" companyType="lender" syncUserType="Lender" />;
}
