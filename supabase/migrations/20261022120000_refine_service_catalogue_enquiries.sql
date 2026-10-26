ALTER TABLE public.service_packages
  ADD COLUMN IF NOT EXISTS catalogue_badge text
    CHECK (catalogue_badge IN ('featured', 'recommended', 'most_popular'));

UPDATE public.service_packages
SET catalogue_badge = 'featured'
WHERE featured = true
  AND catalogue_badge IS NULL;

ALTER TABLE public.service_enquiry_requests
  ALTER COLUMN customer_email DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS customer_business_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS service_interest text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS consent boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
