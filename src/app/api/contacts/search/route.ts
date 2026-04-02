import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';
import { getSession } from '@/lib/security/auth';

const ALLOWED_ROLES = ['super_admin', 'admin', 'cs_admin', 'open_order_team',
  'sales_rep', 'title_officer', 'escrow_officer'];

const querySchema = z.object({
  q: z.string().min(2).max(100),
  pageSize: z.coerce.number().min(1).max(50).default(10),
  type: z.string().default('all'),
});

function typeToSql(type: string) {
  switch (type) {
    case 'escrow': return sql`c.is_escrow = true`;
    case 'lender': return sql`c.is_lender = true`;
    case 'mortgage_broker': return sql`c.is_mortgage_broker = true`;
    case 'selling_agent':
    case 'agent':
    case 'realtor': return sql`c.is_selling_agent = true`;
    case 'title_officer': return sql`c.is_title_officer = true`;
    case 'escrow_officer': return sql`c.is_escrow_officer = true`;
    case 'sales_rep': return sql`c.is_sales_rep = true`;
    case 'underwriter': return sql`c.is_underwriter = true`;
    default: return sql`true`;
  }
}

function deriveClientType(row: {
  isEscrow: boolean; isLender: boolean; isMortgageBroker: boolean;
  isSellingAgent: boolean; isTitleOfficer: boolean; isEscrowOfficer: boolean;
  isSalesRep: boolean; userType: string | null;
}): string {
  if (row.isEscrow) return 'escrow';
  if (row.isLender) return 'lender';
  if (row.isMortgageBroker) return 'mortgage_broker';
  if (row.isSellingAgent) return 'realtor';
  if (row.isTitleOfficer) return 'title_officer';
  if (row.isEscrowOfficer) return 'escrow_officer';
  if (row.isSalesRep) return 'sales_rep';
  return row.userType ?? 'contact';
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawParams = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = querySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json({ results: [] });
  }

  const { q, pageSize, type } = parsed.data;

  try {
    const isEmailSearch = q.includes('@');
    const pattern = `%${q}%`;

    const searchCondition = isEmailSearch
      ? sql`c.email ILIKE ${pattern}`
      : sql`(
          c.email ILIKE ${pattern}
          OR c.first_name ILIKE ${pattern}
          OR c.last_name ILIKE ${pattern}
          OR c.full_name ILIKE ${pattern}
          OR c.company_name ILIKE ${pattern}
          OR c.lookup_code ILIKE ${pattern}
          OR co.name ILIKE ${pattern}
        )`;

    const typeCondition = type === 'all' ? sql`true` : typeToSql(type);

    const rows = await db.execute(sql`
      SELECT
        c.id,
        c.first_name,
        c.last_name,
        c.full_name,
        c.email,
        c.phone,
        c.cell,
        c.lookup_code,
        c.flookup_code,
        c.address1,
        c.city,
        c.state,
        c.zip,
        c.company_name,
        c.is_escrow,
        c.is_lender,
        c.is_mortgage_broker,
        c.is_selling_agent,
        c.is_title_officer,
        c.is_escrow_officer,
        c.is_sales_rep,
        c.user_type,
        co.name AS joined_company_name,
        co.lookup_code AS company_lookup_code,
        co.address1 AS company_address,
        co.city AS company_city,
        co.state AS company_state,
        co.zip AS company_zip,
        co.sales_rep_id AS company_sales_rep_id,
        co.title_officer_id AS company_title_officer_id,
        co.loan_underwriter AS company_loan_underwriter,
        co.sales_underwriter AS company_sales_underwriter
      FROM contacts c
      LEFT JOIN companies co ON c.flookup_code = co.lookup_code AND c.flookup_code IS NOT NULL
      WHERE ${searchCondition}
        AND ${typeCondition}
        AND c.is_active = true
      ORDER BY
        CASE WHEN c.email ILIKE ${q} THEN 0 ELSE 1 END,
        CASE WHEN c.email ILIKE ${pattern} THEN 0 ELSE 1 END,
        c.full_name ASC NULLS LAST
      LIMIT ${pageSize}
    `);

    const results = (rows as unknown as Record<string, unknown>[]).map((r) => {
      const companyName = (r.joined_company_name as string) ?? (r.company_name as string) ?? null;
      const clientType = deriveClientType({
        isEscrow: r.is_escrow as boolean,
        isLender: r.is_lender as boolean,
        isMortgageBroker: r.is_mortgage_broker as boolean,
        isSellingAgent: r.is_selling_agent as boolean,
        isTitleOfficer: r.is_title_officer as boolean,
        isEscrowOfficer: r.is_escrow_officer as boolean,
        isSalesRep: r.is_sales_rep as boolean,
        userType: r.user_type as string | null,
      });

      return {
        id: r.id as number,
        firstName: r.first_name as string | null,
        lastName: r.last_name as string | null,
        fullName: r.full_name as string | null,
        email: r.email as string | null,
        phone: (r.phone as string) ?? (r.cell as string) ?? null,
        cell: r.cell as string | null,
        companyName,
        companyLookupCode: (r.company_lookup_code as string) ?? (r.flookup_code as string) ?? null,
        clientLookupCode: (r.lookup_code as string) ?? null,
        lookupCode: (r.lookup_code as string) ?? null,
        address: (r.address1 as string) ?? (r.company_address as string) ?? null,
        city: (r.city as string) ?? (r.company_city as string) ?? null,
        state: (r.state as string) ?? (r.company_state as string) ?? null,
        zip: (r.zip as string) ?? (r.company_zip as string) ?? null,
        clientType,
        contactType: clientType,
        type: clientType,
        companySalesRepId: (r.company_sales_rep_id as number) ?? null,
        companyTitleOfficerId: (r.company_title_officer_id as number) ?? null,
        companyLoanUnderwriter: (r.company_loan_underwriter as string) ?? null,
        companySalesUnderwriter: (r.company_sales_underwriter as string) ?? null,
      };
    });

    return NextResponse.json({ results });
  } catch (err) {
    console.error('[contacts/search] Error:', err);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
