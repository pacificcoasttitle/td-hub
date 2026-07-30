-- 0032 — SECURITY LOCKDOWN: enable Row Level Security on every table in public.
--
-- WHY
--   Supabase exposes PostgREST over the `public` schema, and the roles `anon`
--   and `authenticated` hold full DML grants on every table here. No table had
--   RLS enabled, so the public anon key (shipped in the browser bundle as
--   NEXT_PUBLIC_SUPABASE_ANON_KEY) could read — and per the grants, write —
--   the entire database directly, bypassing the application and every
--   authorization check in it. Verified: anon reads returned real rows from
--   contacts, orders, order_parties, order_notes (including rows flagged
--   is_internal), profiles, documents, companies, notification_logs, settings,
--   and vendor_tokens.
--
-- WHAT THIS DOES
--   Enables RLS with NO policies. Under RLS, a role with no policy matching a
--   command sees zero rows and may write nothing. That denies anon/authenticated
--   outright.
--
-- WHY IT IS A NO-OP FOR THE APPLICATION
--   The app connects as `postgres` (src/lib/db/client.ts), which has
--   rolbypassrls = true AND owns every one of these tables. Table owners bypass
--   RLS unless FORCE ROW LEVEL SECURITY is set — which this migration
--   deliberately does NOT set. Both bypass paths remain intact, so every
--   existing query, job, cron, and sync behaves exactly as before.
--
-- DELIBERATELY NOT DONE HERE
--   * No policies. Adding them is the separate RLS-pilot work.
--   * No FORCE ROW LEVEL SECURITY — that would apply policies to the owner and
--     break the service-role path the whole app depends on.
--   * No GRANT/REVOKE changes. Enabling RLS is sufficient to deny, and keeping
--     this change minimal keeps it safe and easy to reason about.
--
-- REVERSIBLE
--   Each statement reverses with: ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;
--
-- APPLY: hand-applied to production ahead of any deploy (migrations are not
--        run automatically). This migration depends on no application code and
--        no application code depends on it.

ALTER TABLE public.admin_activity_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_company_links    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_sync_state       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cpl_branches             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cpl_error_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_client_notes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_clients              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_audit           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_outbox             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_types       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.officer_cc_defaults      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_external_refs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_notes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_parties            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_properties         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_history     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prelim_analyses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_optout_audit      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_responses         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_send_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surveys                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.title_point_data         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.title_production_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_api_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_tokens            ENABLE ROW LEVEL SECURITY;
