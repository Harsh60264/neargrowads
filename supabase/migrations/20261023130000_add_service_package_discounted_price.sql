ALTER TABLE public.service_packages
  ADD COLUMN IF NOT EXISTS discounted_price numeric(12, 2)
    CHECK (discounted_price IS NULL OR (discounted_price >= 0 AND discounted_price < price_inr));

NOTIFY pgrst, 'reload schema';
