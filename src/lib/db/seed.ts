import { config } from 'dotenv';
config({ path: '.env.local' });

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { branches } from './schema/contacts';
import { roles } from './schema/admin';

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString, { prepare: false });
const db = drizzle(client);

const PCT_BRANCHES = [
  { code: 'GLT', name: 'Glendale', city: 'Glendale', state: 'CA' },
  { code: 'OCT', name: 'Orange County', city: 'Orange', state: 'CA' },
  { code: 'ONT', name: 'Ontario', city: 'Ontario', state: 'CA' },
  { code: 'PRV', name: 'Oxnard', city: 'Oxnard', state: 'CA' },
  { code: 'TSG', name: 'San Diego', city: 'San Diego', state: 'CA' },
];

const DEFAULT_ROLES = [
  { name: 'super_admin', description: 'Full access to everything', permissions: ['*'] },
  { name: 'admin', description: 'Standard admin access', permissions: ['admin.*'] },
  { name: 'cs_admin', description: 'Customer service admin', permissions: ['admin.orders', 'admin.contacts', 'admin.documents'] },
  { name: 'sales_rep', description: 'Sales representative', permissions: ['orders.own', 'documents.view'] },
  { name: 'title_officer', description: 'Title officer', permissions: ['orders.own', 'documents.view', 'documents.upload'] },
  { name: 'escrow_officer', description: 'Escrow officer', permissions: ['orders.own', 'documents.view', 'documents.upload', 'vendor_actions.cpl'] },
  { name: 'client', description: 'External client', permissions: ['client.*'] },
];

async function seed() {
  console.log('Seeding branches...');
  for (const branch of PCT_BRANCHES) {
    await db.insert(branches).values(branch).onConflictDoNothing({ target: branches.code });
  }
  console.log(`  ✓ ${PCT_BRANCHES.length} branches`);

  console.log('Seeding roles...');
  for (const role of DEFAULT_ROLES) {
    await db.insert(roles).values(role).onConflictDoNothing({ target: roles.name });
  }
  console.log(`  ✓ ${DEFAULT_ROLES.length} roles`);

  console.log('Seed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
