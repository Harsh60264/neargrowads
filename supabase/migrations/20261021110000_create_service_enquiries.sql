CREATE TABLE IF NOT EXISTS public.service_enquiry_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_reference text NOT NULL UNIQUE,
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  customer_phone text NOT NULL DEFAULT '',
  selected_packages jsonb NOT NULL CHECK (jsonb_typeof(selected_packages) = 'array'),
  request_note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'in_progress', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_enquiry_requests_created_at_idx
  ON public.service_enquiry_requests (created_at DESC);

ALTER TABLE public.service_enquiry_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.service_enquiry_requests FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT ON TABLE public.service_enquiry_requests TO service_role;
