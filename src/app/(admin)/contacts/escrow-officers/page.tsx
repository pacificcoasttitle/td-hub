import { ContactListPage } from '@/components/admin/contacts/contact-list-page';

export default function EscrowOfficersPage() {
  return <ContactListPage title="Escrow Officers" subtitle="Internal staff — escrow officers synced from SoftPro" typeFilter="escrow_officer" showCompanyColumn={false} />;
}
