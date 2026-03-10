# 02 — Architecture

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 15 (App Router) | One app surface, server components, API routes, easy deploy |
| Database | Supabase PostgreSQL | Managed Postgres, built-in Auth, RLS-capable, free tier for sandbox |
| ORM | Drizzle ORM | Type-safe schema, zero abstraction, good migrations |
| Auth | Supabase Auth | Handles login/signup/password reset, JWT sessions, integrates with RLS |
| Storage | AWS S3 (existing PCT bucket) | Already in use, CPL/LV/docs already there |
| Hosting | Vercel | Git push → deploy, preview branches, cron support |
| Email | SendGrid (existing PCT account) | Already configured |
| SMS | Twilio (existing PCT account) | Already configured |
| Package Manager | pnpm | Fast, disk-efficient |

## Repo Structure

```
td-hub/
├── app/
│   ├── (admin)/                    # Admin/Ops console (authenticated)
│   │   ├── dashboard/page.tsx
│   │   ├── orders/
│   │   │   ├── page.tsx            # Order list
│   │   │   └── [id]/page.tsx       # Order workspace
│   │   ├── contacts/page.tsx       # Contacts & Companies
│   │   ├── documents/page.tsx      # Document browser
│   │   ├── vendor-actions/page.tsx  # CPL, TitlePoint
│   │   ├── jobs/page.tsx           # Jobs & Logs
│   │   ├── settings/page.tsx       # Settings & feature flags
│   │   ├── users/page.tsx          # Users & Roles
│   │   └── layout.tsx              # Admin shell (sidebar + header)
│   ├── (client)/                   # Client portal (authenticated, scoped)
│   │   ├── orders/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── documents/page.tsx
│   │   └── layout.tsx
│   ├── (auth)/                     # Login, password reset
│   │   ├── login/page.tsx
│   │   └── layout.tsx
│   ├── api/
│   │   ├── orders/
│   │   │   ├── route.ts            # GET list, POST create
│   │   │   ├── [id]/route.ts       # GET detail, PATCH update
│   │   │   └── [id]/resync/route.ts # POST trigger resync
│   │   ├── contacts/route.ts       # GET search, POST create, PUT update
│   │   ├── companies/route.ts
│   │   ├── documents/
│   │   │   ├── upload/route.ts
│   │   │   └── [id]/route.ts       # GET download, DELETE
│   │   ├── vendor-actions/
│   │   │   ├── cpl/route.ts        # POST generate CPL
│   │   │   └── titlepoint/route.ts  # POST create request
│   │   ├── jobs/
│   │   │   └── run/route.ts        # POST run job (secured)
│   │   └── webhooks/
│   │       └── softpro/
│   │           ├── prelim/route.ts
│   │           ├── policy/route.ts
│   │           └── milestone/route.ts
│   └── layout.tsx                  # Root layout
├── lib/
│   ├── domain/
│   │   ├── orders/
│   │   │   ├── service.ts          # Order CRUD, sync mapper
│   │   │   ├── status-machine.ts   # Allowed transitions
│   │   │   └── types.ts            # Order domain types
│   │   ├── contacts/
│   │   │   ├── service.ts
│   │   │   └── types.ts
│   │   ├── documents/
│   │   │   ├── service.ts
│   │   │   ├── audit.ts
│   │   │   └── types.ts
│   │   └── settings/
│   │       └── service.ts
│   ├── db/
│   │   ├── schema/                 # Drizzle schema (see 04-data-model.md)
│   │   │   ├── orders.ts
│   │   │   ├── contacts.ts
│   │   │   ├── documents.ts
│   │   │   ├── integrations.ts
│   │   │   ├── jobs.ts
│   │   │   ├── admin.ts
│   │   │   └── index.ts            # Barrel export
│   │   ├── client.ts               # Drizzle + Supabase connection
│   │   └── seed.ts                 # Branch + role seed data
│   ├── integrations/
│   │   ├── types.ts                # VendorAdapter, VendorResult<T>
│   │   ├── softpro/
│   │   │   ├── client.ts
│   │   │   ├── mapper.ts
│   │   │   ├── types.ts
│   │   │   └── mock.ts
│   │   ├── titlepoint/
│   │   │   ├── client.ts
│   │   │   ├── types.ts
│   │   │   └── mock.ts
│   │   ├── cpl/
│   │   │   ├── westcor/client.ts
│   │   │   ├── fnf/client.ts
│   │   │   ├── natic/client.ts     # Shared by NATIC + Doma
│   │   │   └── types.ts
│   │   └── s3/
│   │       ├── client.ts
│   │       └── mock.ts
│   ├── jobs/
│   │   ├── runner.ts               # Job execution + claim
│   │   ├── retry.ts                # Exponential backoff
│   │   └── handlers/
│   │       ├── sync-orders.ts
│   │       ├── sync-status.ts
│   │       └── sync-contacts.ts
│   ├── security/
│   │   ├── auth.ts                 # Session helpers
│   │   ├── roles.ts                # Role checking
│   │   └── middleware.ts           # Route protection
│   └── events/
│       └── outbox.ts               # Event outbox for decoupled side effects
├── components/
│   ├── ui/                         # Design system primitives
│   ├── admin/                      # Admin-specific components
│   └── client/                     # Client portal components
├── tests/
│   ├── contracts/                  # Adapter contract tests
│   ├── domain/                     # Service unit tests
│   └── integration/                # Full flow tests
├── docs/
│   ├── canon/                      # Read-only legacy reference docs
│   ├── legacy/                     # Extracted snapshots
│   └── playbook/                   # This playbook
├── fixtures/                       # Mock API responses for testing
│   ├── softpro/
│   ├── titlepoint/
│   ├── westcor/
│   ├── fnf/
│   └── natic/
├── drizzle.config.ts
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── .env.example
└── package.json
```

## Design Rules

1. **Domain logic is separate from adapters.** `lib/domain/` never imports from `lib/integrations/`.
2. **No direct vendor calls from UI code.** All vendor interactions go through API routes → domain services → adapters.
3. **Every vendor action logs request/result metadata** to `vendor_api_logs`.
4. **Every document action is auditable** via `document_audit`.
5. **No public job endpoints.** All job triggers require `JOB_RUNNER_SECRET` header.
6. **No hardcoded secrets.** Everything from env vars.
7. **No god files.** If a file exceeds ~300 lines, the Refactorer agent splits it.
8. **TypeScript strict mode.** `"strict": true`, `"noUncheckedIndexedAccess": true`. Zero `any` types.
9. **Zod validation on all API inputs.** No trusting client data.
10. **Server Components by default.** Client Components only when interactivity requires it.

## Auth Model

| User Type | Auth Method | What They See |
|-----------|-------------|---------------|
| Admin (Super Admin, Admin, CS Admin) | Supabase Auth → `profiles` table | Full admin console |
| Internal Staff (Sales Rep, Title Officer, Escrow Officer) | Supabase Auth → `profiles` table | Scoped order views, documents, some actions |
| Client (external agents, lenders) | Supabase Auth → `profiles` table | Client portal only |

The `profiles` table extends Supabase Auth with app-layer role, branch, and status. See `04-data-model.md`.

## Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Single Next.js app with route groups | Simpler than separate admin + client apps. Route groups `(admin)` and `(client)` share the same codebase but have different layouts and auth checks. |
| Supabase Auth over NextAuth | Already using Supabase for DB. One fewer dependency. Built-in password reset, email verification. |
| Drizzle over Prisma | Lower abstraction, better type inference, easier raw SQL escape hatch. |
| Direct FKs for key order roles + order_parties for the rest | Orders always have a sales_rep, title_officer, escrow_officer. Querying these via a join table for every list view is wasteful. Direct FKs for the big three, `order_parties` for everyone else (buyer agent, listing agent, lender contact, etc.). |
| Event outbox over direct side effects | When an order closes, we need to send email, create notification, maybe trigger SMS. Outbox pattern lets us add/change side effects without modifying the status update code. |

## Build Model

Four agents, each with a standalone prompt in `agent-prompts.md`:

| Agent | Owns | Does Not Touch |
|-------|------|---------------|
| Builder | `lib/`, `app/api/`, `fixtures/` | `app/(admin)/`, `components/`, `docs/` |
| Refactorer | Any file (structure only) | No behavior changes, no schema changes |
| UI Builder | `app/(admin)/`, `app/(client)/`, `app/(auth)/`, `components/` | `lib/`, `app/api/` |
| Reviewer | Read-only (reports issues) | Does not write code |

Workflow: Builder → Refactorer → UI Builder → Reviewer → merge.

## Canon References
- `lean_transaction_desk_hub_plan.md` §6, §7
- `softpro-route-extraction.md` §11 (minimum routes)
- `legacy-admin-extraction.md` §2 (navigation structure → informs route groups)
- `agent-prompts.md` (complete agent prompt definitions)
