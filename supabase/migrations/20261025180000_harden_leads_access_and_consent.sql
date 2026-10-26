-- Leads are accessed through the server-authorized API using the service role.
-- Keep RLS enabled while removing direct anon/authenticated table access.
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public anonymous insert of leads" ON public.leads;
DROP POLICY IF EXISTS "Staff read access to leads" ON public.leads;
DROP POLICY IF EXISTS "Staff update access to leads" ON public.leads;

REVOKE ALL ON TABLE public.leads FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE public.leads TO service_role;

-- Consent must be explicitly supplied by the server after an affirmative action.
ALTER TABLE public.leads ALTER COLUMN consent_status DROP DEFAULT;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS notification_status TEXT NOT NULL DEFAULT 'not_configured';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leads_notification_status_check'
      AND conrelid = 'public.leads'::regclass
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_notification_status_check
      CHECK (notification_status IN ('pending', 'not_configured', 'delivered', 'failed'));
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
