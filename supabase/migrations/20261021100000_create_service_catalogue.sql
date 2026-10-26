CREATE TABLE IF NOT EXISTS public.service_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  package_code text,
  title text NOT NULL,
  category text NOT NULL,
  package_kind text NOT NULL DEFAULT 'service' CHECK (package_kind IN ('service', 'add_on')),
  summary text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_inr numeric(12, 2) NOT NULL CHECK (price_inr >= 0),
  billing_type text NOT NULL CHECK (billing_type IN ('monthly', 'one_time', 'per_session')),
  image_url text NOT NULL DEFAULT '',
  deliverables jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(deliverables) = 'array'),
  exclusions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(exclusions) = 'array'),
  client_requirements jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(client_requirements) = 'array'),
  target_audience text NOT NULL DEFAULT '',
  delivery_timeline text NOT NULL DEFAULT '',
  faqs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(faqs) = 'array'),
  featured boolean NOT NULL DEFAULT false,
  quantity_supported boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_packages_status_category_idx
  ON public.service_packages (status, category);

CREATE INDEX IF NOT EXISTS service_packages_featured_idx
  ON public.service_packages (featured, updated_at DESC)
  WHERE status = 'published';

ALTER TABLE public.service_packages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.service_packages FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.service_packages TO service_role;
