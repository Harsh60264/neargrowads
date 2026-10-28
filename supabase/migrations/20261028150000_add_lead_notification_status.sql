-- Reconcile the lead API's notification state with an existing public.leads table.
-- Apply only after confirming public.leads exists and notification_status is absent.

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

GRANT SELECT, INSERT, UPDATE ON TABLE public.leads TO service_role;

NOTIFY pgrst, 'reload schema';
