/**
 * Scripts only. Request handlers must leave the shared pool open.
 *
 * A standalone process that imports `@/lib/db/client` (directly, or via the
 * SoftPro client's `logRequest`) never exits on its own — the pool holds a
 * live socket. Close it, flush stdout (block-buffered when redirected), exit.
 */
export async function scriptExit(code = 0): Promise<never> {
  try {
    const { closeDb } = await import('../../src/lib/db/client');
    await closeDb();
  } catch {
    // pool never opened, already ended, or DATABASE_URL missing
  }
  await new Promise<void>((resolve) => {
    process.stdout.write('', () => resolve());
  });
  process.exit(code);
}
