import { ContactListPage } from '@/components/admin/contacts/contact-list-page';

export default function AgentsPage() {
  return <ContactListPage title="Agents" subtitle="External clients — real estate agents and brokers" typeFilter="agent" />;
}
