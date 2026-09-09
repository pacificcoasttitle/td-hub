import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });

/** Scripts only. Request handlers must leave the pool open. */
export async function closeDb(): Promise<void> {
  try {
    await client.end({ timeout: 5 });
  } catch {
    // already closed
  }
}
