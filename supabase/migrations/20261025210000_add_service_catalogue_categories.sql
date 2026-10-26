CREATE TABLE IF NOT EXISTS public.service_catalogue_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  display_order integer NOT NULL DEFAULT 0 CHECK (display_order BETWEEN 0 AND 10000),
  active boolean NOT NULL DEFAULT true,
  show_in_catalogue boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS service_catalogue_categories_name_ci_idx
  ON public.service_catalogue_categories (lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));

ALTER TABLE public.service_catalogue_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.service_catalogue_categories FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.service_catalogue_categories TO service_role;

WITH existing_names AS (
  SELECT DISTINCT ON (lower(regexp_replace(btrim(category), '\s+', ' ', 'g')))
    btrim(category) AS name,
    lower(regexp_replace(btrim(category), '[^a-zA-Z0-9]+', '-', 'g')) AS base_slug,
    lower(regexp_replace(btrim(category), '\s+', ' ', 'g')) AS normalized_name
  FROM public.service_packages
  WHERE btrim(category) <> ''
  ORDER BY lower(regexp_replace(btrim(category), '\s+', ' ', 'g')), btrim(category)
), ranked AS (
  SELECT
    name,
    CASE WHEN base_slug = '' THEN 'category' ELSE trim(both '-' FROM base_slug) END AS base_slug,
    normalized_name
  FROM existing_names
), generated AS (
  SELECT
    name,
    CASE WHEN base_slug = '' THEN 'category' ELSE trim(both '-' FROM base_slug) END AS slug_base,
    normalized_name,
    count(*) OVER (PARTITION BY CASE WHEN base_slug = '' THEN 'category' ELSE trim(both '-' FROM base_slug) END) AS slug_count
  FROM ranked
)
INSERT INTO public.service_catalogue_categories (name, slug, description, display_order, active, show_in_catalogue)
SELECT
  name,
  CASE
    WHEN slug_base IN ('all', 'all-services', 'add-ons', 'cart', 'categories', 'checkout', 'enquiries', 'orders', 'payment-availability', 'success')
      OR slug_count > 1
      THEN left(slug_base, 88) || '-' || substr(md5(normalized_name), 1, 8)
    ELSE left(slug_base, 100)
  END,
  '',
  row_number() OVER (ORDER BY lower(name), name) - 1,
  true,
  true
FROM generated
ON CONFLICT (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) DO NOTHING;

ALTER TABLE public.service_packages
  ADD COLUMN IF NOT EXISTS category_id uuid;

UPDATE public.service_packages AS packages
SET category_id = categories.id
FROM public.service_catalogue_categories AS categories
WHERE packages.category_id IS NULL
  AND lower(regexp_replace(btrim(packages.category), '\s+', ' ', 'g')) =
      lower(regexp_replace(btrim(categories.name), '\s+', ' ', 'g'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'service_packages_category_id_fkey'
      AND conrelid = 'public.service_packages'::regclass
  ) THEN
    ALTER TABLE public.service_packages
      ADD CONSTRAINT service_packages_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES public.service_catalogue_categories(id)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS service_packages_category_id_idx
  ON public.service_packages (category_id);

NOTIFY pgrst, 'reload schema';
