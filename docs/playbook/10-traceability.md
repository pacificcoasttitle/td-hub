# 10 — Traceability Matrix

> Maps every vNext feature to: canon doc, legacy reference, vNext module, and acceptance test.
> If a feature isn't in this matrix, it doesn't exist yet.

## Phase 0 — Foundation

| Feature | Canon Doc | Legacy Reference | vNext Module | Acceptance Test |
|---------|-----------|-----------------|--------------|-----------------|
| Repo scaffold | `lean_transaction_desk_hub_plan.md` §6 | N/A (new) | Root config | `pnpm build` passes |
| Drizzle schema | `lean_transaction_desk_hub_plan.md` §8 | `td-source-extraction.md` §7 (Phinx migrations) | `lib/db/schema/` | All tables in Supabase dashboard |
| Auth skeleton | `lean_transaction_desk_hub_plan.md` §14 | `legacy-admin-extraction.md` §3 (auth flow) | `lib/security/`, `app/(auth)/` | Can log in, unauthenticated → redirect |
| Admin shell | `lean_transaction_desk_hub_plan.md` §12 | `legacy-admin-extraction.md` §2 (sidebar) | `app/(admin)/layout.tsx` | 8 empty admin pages load |
| Branch seed | `lean_transaction_desk_hub_plan.md` §8.1 | `constants.php` COUNTRY_CODE | `lib/db/seed.ts` | 5 branches in DB |
| Role seed | `lean_transaction_desk_hub_plan.md` §12.8 | `legacy-admin-extraction.md` §3 (role table) | `lib/db/seed.ts` | 7 roles in DB |

## Phase 1 — SoftPro Sync + Order Hub

| Feature | Canon Doc | Legacy Reference | vNext Module | Acceptance Test |
|---------|-----------|-----------------|--------------|-----------------|
| SoftPro HTTP client | `softpro-route-extraction.md` §5 | `td-source-extraction.md` §1 (`SoftPro.php::make_request`) | `lib/integrations/softpro/client.ts` | Can call getOrders, responses parsed correctly |
| SoftPro response types | `softpro-route-extraction.md` §6 | `td-source-extraction.md` §2 (`fetchSoftproOrders` field mapping) | `lib/integrations/softpro/types.ts` | Types match actual API response |
| SoftPro order mapper | `softpro-route-extraction.md` §6 | `td-source-extraction.md` §2 (field-by-field mapping in `fetchSoftproOrders`) | `lib/integrations/softpro/mapper.ts` | Country→county, dates parsed, status lowercase |
| SoftPro mock adapter | `softpro-route-extraction.md` §5 | N/A | `lib/integrations/softpro/mock.ts` | Returns same types as real adapter |
| Order CRUD service | `lean_transaction_desk_hub_plan.md` §5.1 | `td-source-extraction.md` §6 (`Order_model.php`) | `lib/domain/orders/service.ts` | CRUD operations work, paginated list |
| Order upsert from SoftPro | `softpro-route-extraction.md` §4 Flow 2 | `td-source-extraction.md` §2 (`fetchSoftproOrders` create/update logic) | `lib/domain/orders/service.ts` | New orders created, existing updated |
| Status machine | `order-lifecycle.md` | `td-source-extraction.md` §2 (status transitions in sync) | `lib/domain/orders/status-machine.ts` | Valid transitions pass, invalid rejected |
| Date parsing | `softpro-route-extraction.md` §6 | `td-source-extraction.md` §2 (`DateTime::createFromFormat`) | `lib/integrations/softpro/mapper.ts` | Both SoftPro date formats handled |
| Sync recent orders job | `softpro-route-extraction.md` §4 Flow 2 | `td-source-extraction.md` §2 (`Cron::fetchSoftproOrders`) | `lib/jobs/handlers/sync-orders.ts` | Orders appear in DB after job runs |
| Sync status job | `softpro-route-extraction.md` §4 Flow 3 | `td-source-extraction.md` §2 (`Cron::updateAllSoftProOrderStatus`) | `lib/jobs/handlers/sync-status.ts` | Statuses updated, 10-day chunks |
| Job runner | `lean_transaction_desk_hub_plan.md` §8.4 | `td-source-extraction.md` §2 (cron methods) | `lib/jobs/runner.ts` | Jobs queued, claimed, completed/failed |
| Job endpoint auth | `lean_transaction_desk_hub_plan.md` §14 | `legacy-admin-extraction.md` §6 (public cron = security issue) | `app/api/jobs/run/route.ts` | 401 without secret, 200 with secret |
| Vendor API logging | `softpro-route-extraction.md` §7 | `td-source-extraction.md` §1 (`apiLogs::syncLogs`) | `lib/integrations/` (all adapters) | Every SoftPro call logged |
| Order list page | `lean_transaction_desk_hub_plan.md` §12.2 | `legacy-admin-extraction.md` §5 (Orders Listing) | `app/(admin)/orders/page.tsx` | Renders real data, filters work |
| Order workspace | `lean_transaction_desk_hub_plan.md` §12.2 | `legacy-admin-extraction.md` §5 (Order Details) | `app/(admin)/orders/[id]/page.tsx` | All tabs render, resync works |
| Manual resync | `softpro-route-extraction.md` §3.6 | `legacy-admin-extraction.md` §4 (Sync SoftPro button) | `app/api/orders/[id]/resync/route.ts` | Single order re-synced on click |

## Phase 2 — Document Hub

| Feature | Canon Doc | Legacy Reference | vNext Module | Acceptance Test |
|---------|-----------|-----------------|--------------|-----------------|
| S3 client | `lean_transaction_desk_hub_plan.md` §8.3 | `td-source-extraction.md` §5 (`uploadDocumentOnAwsS3`) | `lib/integrations/s3/client.ts` | Upload/download/delete work |
| Document service | `lean_transaction_desk_hub_plan.md` §5.2 | `td-source-extraction.md` §5 (document methods) | `lib/domain/documents/service.ts` | CRUD + audit trail |
| Document audit | `lean_transaction_desk_hub_plan.md` §5.2 | N/A (new — legacy had no audit) | `lib/domain/documents/audit.ts` | Every action logged |
| Attach to SoftPro | `softpro-route-extraction.md` §4 Flow 4 | `td-source-extraction.md` §5 (`uploadCPLDocumentToSoftpro`) | `lib/domain/documents/service.ts` | Document pushed to SoftPro |
| Document UI | `lean_transaction_desk_hub_plan.md` §12.4 | `legacy-admin-extraction.md` §5 (Document Listings) | `app/(admin)/documents/` | Upload, view, download work |

## Phase 3 — Contacts & Admin

| Feature | Canon Doc | Legacy Reference | vNext Module | Acceptance Test |
|---------|-----------|-----------------|--------------|-----------------|
| Contact service | `lean_transaction_desk_hub_plan.md` §8.2 | `softpro-route-extraction.md` §6 (lookup sync) | `lib/domain/contacts/service.ts` | CRUD + role-based search |
| Unified contact page | `lean_transaction_desk_hub_plan.md` §12.3 | `legacy-admin-extraction.md` §5 (10+ entity pages) | `app/(admin)/contacts/page.tsx` | One page replaces 10 legacy pages |
| Company management | `lean_transaction_desk_hub_plan.md` §8.2 | `legacy-admin-extraction.md` §5 (SP Companies) | `app/(admin)/contacts/page.tsx` | Company CRUD with linked contacts |
| User management | `lean_transaction_desk_hub_plan.md` §12.8 | `legacy-admin-extraction.md` §3 (auth + roles) | `app/(admin)/users/page.tsx` | Invite, disable, assign roles |
| Settings | `lean_transaction_desk_hub_plan.md` §12.7 | `legacy-admin-extraction.md` §5 (Settings) | `app/(admin)/settings/page.tsx` | Key-value config, branch CRUD |

## Phase 4 — Vendor Actions

| Feature | Canon Doc | Legacy Reference | vNext Module | Acceptance Test |
|---------|-----------|-----------------|--------------|-----------------|
| Westcor CPL adapter | `cpl-underwriters.md` | `td-source-extraction.md` §3 (`Westcor.php`) | `lib/integrations/cpl/westcor/` | Generate CPL via mock |
| FNF CPL adapter | `cpl-underwriters.md` | `td-source-extraction.md` §3 (`Fnf.php`) | `lib/integrations/cpl/fnf/` | Generate CPL via mock |
| NATIC/Doma CPL adapter | `cpl-underwriters.md` | `td-source-extraction.md` §3 (`Natic.php`) | `lib/integrations/cpl/natic/` | Generate CPL via mock |
| selectCplForm | `cpl-underwriters.md` | `td-source-extraction.md` §3 (`selectCplForm` method) | `lib/integrations/cpl/westcor/` | Name-based selection, not position |
| TitlePoint adapter | `titlepoint.md` | `td-source-extraction.md` §4 (`Titlepoint.php`) | `lib/integrations/titlepoint/` | Create, poll, fetch via mock |
| CPL generation UI | `lean_transaction_desk_hub_plan.md` §12.5 | `legacy-admin-extraction.md` §4 (CPL workflow) | `app/(admin)/vendor-actions/` | Full CPL flow in UI |

## Phase 5 — Client Portal

| Feature | Canon Doc | Legacy Reference | vNext Module | Acceptance Test |
|---------|-----------|-----------------|--------------|-----------------|
| Client login | `lean_transaction_desk_hub_plan.md` §13 | `legacy-admin-extraction.md` §3 (Login.php) | `app/(client)/` | Client logs in, sees own orders |
| Client order view | `lean_transaction_desk_hub_plan.md` §13 | N/A (new — legacy had limited client view) | `app/(client)/orders/` | Scoped to client's orders only |
| Client documents | `lean_transaction_desk_hub_plan.md` §13 | N/A | `app/(client)/documents/` | View/download only |

---

## Intentional Changes from Legacy

| Legacy Behavior | vNext Behavior | Reason |
|----------------|----------------|--------|
| 9 separate lookup sync cron jobs | 1 parameterized sync job | They're identical except for userType param |
| 10+ entity listing pages | 1 contacts page with role filter | All query same table with different boolean flag |
| Public cron endpoints | Authenticated job endpoints | Security |
| Home.php (9,940 lines) | Separated into domain services + API routes + UI | No god files |
| `pct_resware_log` name | `vendor_api_logs` | Sane naming |
| 12 boolean flags for roles | JSONB roles array | Flexible, queryable, no column sprawl |
| 4 separate CPL branch tables | 1 unified `cpl_branches` table | Same data, different vendor |
| Hardcoded `Country` → county | Preserved mapping, documented | Legacy bug, but changing would break data |
| 540s timeout | 60s timeout | 9 minutes is unreasonable |
| SSL verification disabled | SSL verification enabled | Security |
| `die` statements in libraries | Proper error handling | Never crash the process |
| 8-agent parallel model | 4-agent sequential model (Builder → Refactorer → UI Builder → Reviewer) | Solo builder with AI leverage, not fake org chart |
| Mobile-first responsive | Desktop-first (1280px+), mobile app later | Internal tool used on desktop, not phones |

---

## Build Process Artifacts

| Artifact | Location | Purpose |
|----------|----------|---------|
| Agent prompts | `agent-prompts.md` | Standalone paste-ready prompts for 4 Claude Code agents |
| Phase plan | `08-phase-plan.md` | Tickets with acceptance criteria per phase |
| Runbook | `09-runbook.md` | Setup, deployment, Claude Code workflow |
| This matrix | `10-traceability.md` | Feature → canon → legacy → vNext → test mapping |
