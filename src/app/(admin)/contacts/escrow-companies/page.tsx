import { ContactListPage } from '@/components/admin/contacts/contact-list-page';

export default function EscrowCompaniesPage() {
  return <ContactListPage title="Escrow Companies" subtitle="External clients — escrow companies and their contacts" typeFilter="escrow_officer" />;
}
