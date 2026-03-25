# 09 — Runbook

## 1. One-Time Setup

### Prerequisites
```bash
# Node 20+
node --version  # Must be >= 20.0.0

# pnpm
npm install -g pnpm

# Supabase CLI
npx supabase init
```

### Create External Services
1. **Supabase**: Create project at supabase.com → get URL + anon key + service role key
2. **Vercel**: Create project, connect to GitHub repo
3. **S3 Bucket**: Use existing PCT bucket (or create new for sandbox)
4. **Gather vendor credentials**: SoftPro, TitlePoint, Westcor, FNF, NATIC, Doma
5. **SendGrid**: Use existing PCT API key
6. **Twilio**: Use existing PCT credentials

### Initialize Repo
```bash
npx create-next-app@latest td-hub --typescript --tailwind --app --use-pnpm
cd td-hub
pnpm add drizzle-orm @supabase/supabase-js @supabase/ssr @aws-sdk/client-s3 zod
pnpm add -D drizzle-kit vitest @types/node
```

### Configure TypeScript
```json
// tsconfig.json — ensure these are set
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

### Configure Drizzle
```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './lib/db/schema/index.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

### Package Scripts
```json
// package.json scripts
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "db:seed": "tsx lib/db/seed.ts",
    "test": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

---

## 2. Environment Variables

### `.env.example`
```bash
# ─── Supabase ─────────────────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DATABASE_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres

# ─── Storage ──────────────────────────────────────────────────────────────
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
AWS_BUCKET=your-bucket-name
AWS_PATH=https://your-bucket.s3.amazonaws.com/

# ─── SoftPro ─────────────────────────────────────────────────────────────
SOFTPRO_API_URL=http://your-softpro-api:8081/api/
SOFTPRO_TOKEN=your-hmac-secret

# ─── TitlePoint ───────────────────────────────────────────────────────────
TP_USERNAME=your-tp-username
TP_PASSWORD=your-tp-password
TP_BASE_URL=https://tps.titlepoint.com/TPS/
TP_IMAGE_ENDPOINT=https://images.titlepoint.com/ImageRequest.asmx/GetImage?

# ─── Westcor ─────────────────────────────────────────────────────────────
WESTCOR_URL=https://services.ewestcor.com/
WESTCOR_GRANT_TYPE=password
WESTCOR_USERNAME=your-westcor-username
WESTCOR_PASSWORD=your-westcor-password
WESTCOR_INTEGRATION_PARTNER=your-partner-code

# ─── FNF ──────────────────────────────────────────────────────────────────
FNF_VENDOR_URL=https://vendor-api.fnf.com/
FNF_USER_URL=https://user-api.fnf.com/
FNF_CPL_URL=https://cpl-api.fnf.com/
FNF_CLIENT_ID=your-client-id
FNF_SECRET_KEY=your-secret-key
FNF_ON_BEHALF_OF_USER=your-behalf-user
FNF_USERNAME=your-fnf-username
FNF_PASSWORD=your-fnf-password

# ─── NATIC ────────────────────────────────────────────────────────────────
NATIC_URL=https://api.natic.com/
NATIC_USERNAME=your-natic-username
NATIC_PASSWORD=your-natic-password
NATIC_COMPANY=Pacific Coast Title Company
NATIC_DOCUMENT_ID=your-doc-id

# ─── Doma ─────────────────────────────────────────────────────────────────
DOMA_URL=https://api.doma.com/
DOMA_USERNAME=your-doma-username
DOMA_PASSWORD=your-doma-password
DOMA_COMPANY=Pacific Coast Title Company
DOMA_DOCUMENT_ID=your-doc-id

# ─── Email ────────────────────────────────────────────────────────────────
SENDGRID_API_KEY=your-sendgrid-key
FROM_EMAIL=noreply@pct.com

# ─── Jobs ─────────────────────────────────────────────────────────────────
JOB_RUNNER_SECRET=your-job-runner-secret
```

---

## 3. Local Development

```bash
# Copy env
cp .env.example .env.local

# Fill in real values for at least:
# - Supabase URL + keys
# - DATABASE_URL
# - JOB_RUNNER_SECRET (any random string for local)

# Install and run
pnpm install
pnpm dev

# In another terminal: apply schema
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# Open Drizzle Studio to inspect DB
pnpm db:studio
```

---

## 4. Database Workflow

```bash
# After changing any schema file:
pnpm db:generate    # Generate migration SQL
pnpm db:migrate     # Apply to database

# If migrations fail:
# 1. Check DATABASE_URL is correct
# 2. Check Supabase project is running
# 3. Fix schema issue
# 4. Re-generate and re-migrate

# NEVER manually edit migration files
```

---

## 5. Running Jobs Locally

```bash
# Trigger a job via the secured endpoint:
curl -X POST "http://localhost:3000/api/jobs/run?name=softpro.sync_recent_orders" \
  -H "Authorization: Bearer $JOB_RUNNER_SECRET"

# With date params:
curl -X POST "http://localhost:3000/api/jobs/run?name=softpro.sync_recent_orders&dateFrom=03-01-2025" \
  -H "Authorization: Bearer $JOB_RUNNER_SECRET"

# Check job status:
# Use Drizzle Studio or query the jobs table directly
```

---

## 6. Deployment

### Production URL
```
https://td-hub.vercel.app/
```

### Vercel Crons (auto-configured via vercel.json)
```
softpro.sync_recent_orders  — every hour at :00
softpro.enrich_orders       — every hour at :15
notifications.process_outbox — every 5 minutes
```

### Webhook URLs (give to SoftPro team)
```
Prelim:    https://td-hub.vercel.app/api/webhooks/softpro/prelim
Policy:    https://td-hub.vercel.app/api/webhooks/softpro/policy
Milestone: https://td-hub.vercel.app/api/webhooks/softpro/milestone
```

### Manual Job Triggers
```bash
# Sync recent orders from SoftPro
curl -X POST "https://td-hub.vercel.app/api/jobs/run?name=softpro.sync_recent_orders" \
  -H "Authorization: Bearer $JOB_RUNNER_SECRET"

# Enrich orders with contacts
curl -X POST "https://td-hub.vercel.app/api/jobs/run?name=softpro.enrich_orders" \
  -H "Authorization: Bearer $JOB_RUNNER_SECRET"

# Sync contacts by entity type
curl -X POST "https://td-hub.vercel.app/api/jobs/run?name=softpro.sync_contacts" \
  -H "Authorization: Bearer $JOB_RUNNER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"entityType": "Title Officer"}'

# Process notification outbox
curl -X POST "https://td-hub.vercel.app/api/jobs/run?name=notifications.process_outbox" \
  -H "Authorization: Bearer $JOB_RUNNER_SECRET"
```

### Vercel Environment Variables
All variables are listed in `.env.example`. Set in Vercel dashboard under Settings → Environment Variables. Key variables include Supabase, SoftPro (URL + token), AWS S3, SendGrid, Twilio, SiteX, TitlePoint, Google Maps, JOB_RUNNER_SECRET, and CRON_SECRET.

---

## 7. Agent Workflow (Cursor-Based)

### Setup
Open separate Cursor Composer sessions for each agent. Paste the agent prompt, then give it a ticket.

```
Chat 1: Builder      — backend features (services, adapters, jobs, API routes)
Chat 2: UI Builder   — frontend (pages, components, layouts)
Chat 3: Gopher       — debugging, testing, wiring up conflicts
Chat 4: Refactorer   — structural cleanup after features land
Chat 5: Reviewer     — 10-point checklist before merge
Chat 6: Director     — Claude.ai conversation for planning and decisions
```

### Workflow Per Feature
```
1. Director plans the feature and writes the ticket
2. Builder + UI Builder work in parallel on their scoped areas
3. Gopher checks for conflicts (duplicate routes, stubs that need wiring)
4. Refactorer splits any files over 300 lines
5. Reviewer runs 10-point checklist
6. If PASS → commit and push
7. If BLOCK → fix issues → re-review
```

---

## 8. Testing

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test lib/integrations/softpro/

# Type check only
pnpm typecheck
```

### What Gets Tested
- **Adapter contract tests:** Mock and real adapters produce same types
- **Domain service tests:** CRUD operations, sync mapper, status machine
- **API route tests:** Input validation, auth checks, response shapes
- **Integration tests:** Full sync flow with mock adapter

---

## 9. Troubleshooting

| Problem | Fix |
|---------|-----|
| `pnpm db:migrate` fails | Check DATABASE_URL. Check Supabase is running. |
| Auth redirects loop | Check NEXT_PUBLIC_SUPABASE_URL and ANON_KEY match your project. |
| Job endpoint returns 401 | Check JOB_RUNNER_SECRET matches between caller and server. |
| SoftPro sync returns empty | Check SOFTPRO_API_URL. Check date format (MM-DD-YYYY). Check network access. |
| S3 upload fails | Check AWS credentials. Check bucket name and region. |
| Vercel deploy fails | Check build logs. Usually a TypeScript error. Run `pnpm build` locally first. |
