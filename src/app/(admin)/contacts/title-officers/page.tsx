import { ContactListPage } from '@/components/admin/contacts/contact-list-page';

export default function TitleOfficersPage() {
  return <ContactListPage title="Title Officers" subtitle="Internal staff — title officers synced from SoftPro" typeFilter="title_officer" showCompanyColumn={false} />;
}
