import { ContactListPage } from '@/components/admin/contacts/contact-list-page';

export default function SalesRepsPage() {
  return <ContactListPage title="Sales Reps" subtitle="Internal staff — sales representatives synced from SoftPro" typeFilter="sales_rep" showCompanyColumn={false} />;
}
