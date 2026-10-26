-- Grant the server-only Supabase service role the table privileges used by the Leads API.
-- RLS remains enabled; the service_role key is never exposed to the browser.
GRANT SELECT, INSERT, UPDATE ON TABLE public.leads TO service_role;
