CREATE TABLE IF NOT EXISTS public.case_studies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  category text NOT NULL,
  client_descriptor text NOT NULL DEFAULT '',
  approved_client_name text NOT NULL DEFAULT '',
  timeframe text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  challenge text NOT NULL DEFAULT '',
  strategy text NOT NULL DEFAULT '',
  deliverables_executed jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(deliverables_executed) = 'array'),
  results_context text NOT NULL DEFAULT '',
  metrics jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(metrics) = 'array'),
  tools_used jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tools_used) = 'array'),
  testimonial_quote jsonb,
  testimonial_approved boolean NOT NULL DEFAULT false,
  service_slug text NOT NULL DEFAULT '',
  cta_label text NOT NULL DEFAULT 'View Service Model',
  cta_link text NOT NULL DEFAULT '',
  featured boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  image_url text NOT NULL DEFAULT '',
  image_alt text NOT NULL DEFAULT '',
  image_position_x smallint NOT NULL DEFAULT 50 CHECK (image_position_x BETWEEN 0 AND 100),
  image_position_y smallint NOT NULL DEFAULT 50 CHECK (image_position_y BETWEEN 0 AND 100),
  image_size text NOT NULL DEFAULT 'cover' CHECK (image_size IN ('cover', 'contain')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX IF NOT EXISTS case_studies_public_order_idx
  ON public.case_studies (display_order, created_at)
  WHERE status = 'published';
CREATE INDEX IF NOT EXISTS case_studies_category_status_idx
  ON public.case_studies (category, status, display_order);

ALTER TABLE public.case_studies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.case_studies FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.case_studies TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('case-study-media', 'case-study-media', false, 15728640, ARRAY['image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 15728640,
    allowed_mime_types = ARRAY['image/png', 'image/webp'];

CREATE OR REPLACE FUNCTION public.reorder_case_studies(p_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  updated_count integer;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) > 500 OR
    cardinality(p_ids) <> (SELECT count(DISTINCT value) FROM unnest(p_ids) AS ids(value)) THEN
    RAISE EXCEPTION 'Case study order must contain between 1 and 500 unique identifiers';
  END IF;

  UPDATE public.case_studies AS study
  SET display_order = ordered.ordinality - 1,
      updated_at = now()
  FROM unnest(p_ids) WITH ORDINALITY AS ordered(id, ordinality)
  WHERE study.id = ordered.id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'One or more case studies could not be reordered';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_case_studies(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_case_studies(uuid[]) TO service_role;
