import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getOfficerCcDefaults, setOfficerCcDefaults } from './officer-cc-defaults';

const { rows } = vi.hoisted(() => ({
  rows: [] as Array<{
    id: number;
    officerContactId: number;
    ccName: string | null;
    ccEmail: string;
    ccLabel: string | null;
    createdBy: string | null;
    createdAt: Date;
  }>,
}));

vi.mock('drizzle-orm', () => ({
  asc: (field: unknown) => field,
  eq: (field: unknown, value: unknown) => ({ field, value }),
}));

vi.mock('@/lib/db/schema', () => ({
  officerCcDefaults: {
    id: 'officer_cc_defaults.id',
    officerContactId: 'officer_cc_defaults.officer_contact_id',
    ccName: 'officer_cc_defaults.cc_name',
    ccEmail: 'officer_cc_defaults.cc_email',
    ccLabel: 'officer_cc_defaults.cc_label',
    createdBy: 'officer_cc_defaults.created_by',
    createdAt: 'officer_cc_defaults.created_at',
  },
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((condition: { value: number }) => ({
          orderBy: vi.fn(async () => rows
            .filter((row) => row.officerContactId === condition.value)
            .sort((a, b) => a.id - b.id)),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async (condition: { value: number }) => {
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (rows[i]?.officerContactId === condition.value) {
            rows.splice(i, 1);
          }
        }
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (values: Array<{
        officerContactId: number;
        ccName: string | null;
        ccEmail: string;
        ccLabel: string | null;
        createdBy: string | null;
      }>) => {
        for (const value of values) {
          rows.push({
            id: rows.length + 1,
            createdAt: new Date('2026-07-15T17:00:00.000Z'),
            ...value,
          });
        }
      }),
    })),
  },
}));

describe('officer CC defaults', () => {
  beforeEach(() => {
    rows.splice(0, rows.length);
  });

  it('saves and reads an escrow officer contact CC list by contact id', async () => {
    const saved = await setOfficerCcDefaults(42, [
      { ccName: 'Assistant One', ccEmail: ' Assistant@One.Example ', ccLabel: 'Prelim assistant' },
      { ccName: 'Assistant Two', ccEmail: 'assistant.two@example.com' },
    ], 'admin-user-id');

    expect(saved).toMatchObject([
      {
        officerContactId: 42,
        ccName: 'Assistant One',
        ccEmail: 'assistant@one.example',
        ccLabel: 'Prelim assistant',
        createdBy: 'admin-user-id',
      },
      {
        officerContactId: 42,
        ccName: 'Assistant Two',
        ccEmail: 'assistant.two@example.com',
        ccLabel: null,
        createdBy: 'admin-user-id',
      },
    ]);

    const readBack = await getOfficerCcDefaults(42);
    expect(readBack).toEqual(saved);
    expect(await getOfficerCcDefaults(7)).toEqual([]);
  });

  it('replaces existing CC defaults for the same officer contact', async () => {
    await setOfficerCcDefaults(42, [
      { ccName: 'Assistant One', ccEmail: 'assistant.one@example.com' },
      { ccName: 'Assistant Two', ccEmail: 'assistant.two@example.com' },
    ], 'admin-user-id');

    const replaced = await setOfficerCcDefaults(42, [
      { ccName: 'Replacement Assistant', ccEmail: 'replacement@example.com', ccLabel: 'Current prelim CC' },
    ], 'admin-user-id');

    expect(replaced).toMatchObject([
      {
        officerContactId: 42,
        ccName: 'Replacement Assistant',
        ccEmail: 'replacement@example.com',
        ccLabel: 'Current prelim CC',
        createdBy: 'admin-user-id',
      },
    ]);

    const readBack = await getOfficerCcDefaults(42);
    expect(readBack).toEqual(replaced);
    expect(readBack).toHaveLength(1);
    expect(readBack.map((recipient) => recipient.ccEmail)).not.toContain('assistant.one@example.com');
    expect(readBack.map((recipient) => recipient.ccEmail)).not.toContain('assistant.two@example.com');
  });
});
