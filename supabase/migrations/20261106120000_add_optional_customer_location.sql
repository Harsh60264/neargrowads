BEGIN;

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS customer_location_latitude numeric(9, 6),
  ADD COLUMN IF NOT EXISTS customer_location_longitude numeric(9, 6),
  ADD COLUMN IF NOT EXISTS customer_location_accuracy_meters numeric(10, 2),
  ADD COLUMN IF NOT EXISTS customer_location_locality text,
  ADD COLUMN IF NOT EXISTS customer_location_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_location_consent boolean NOT NULL DEFAULT false;

ALTER TABLE public.service_enquiry_requests
  ADD COLUMN IF NOT EXISTS customer_location_latitude numeric(9, 6),
  ADD COLUMN IF NOT EXISTS customer_location_longitude numeric(9, 6),
  ADD COLUMN IF NOT EXISTS customer_location_accuracy_meters numeric(10, 2),
  ADD COLUMN IF NOT EXISTS customer_location_locality text,
  ADD COLUMN IF NOT EXISTS customer_location_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_location_consent boolean NOT NULL DEFAULT false;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS customer_location_latitude numeric(9, 6),
  ADD COLUMN IF NOT EXISTS customer_location_longitude numeric(9, 6),
  ADD COLUMN IF NOT EXISTS customer_location_accuracy_meters numeric(10, 2),
  ADD COLUMN IF NOT EXISTS customer_location_locality text,
  ADD COLUMN IF NOT EXISTS customer_location_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_location_consent boolean NOT NULL DEFAULT false;

ALTER TABLE public.service_orders
  ADD CONSTRAINT service_orders_customer_location_coordinates_check CHECK (
    (customer_location_consent = false AND customer_location_latitude IS NULL AND customer_location_longitude IS NULL)
    OR (customer_location_consent = true AND customer_location_latitude BETWEEN -90 AND 90 AND customer_location_longitude BETWEEN -180 AND 180
      AND customer_location_accuracy_meters > 0 AND customer_location_captured_at IS NOT NULL)
  );

ALTER TABLE public.service_enquiry_requests
  ADD CONSTRAINT service_enquiry_customer_location_coordinates_check CHECK (
    (customer_location_consent = false AND customer_location_latitude IS NULL AND customer_location_longitude IS NULL)
    OR (customer_location_consent = true AND customer_location_latitude BETWEEN -90 AND 90 AND customer_location_longitude BETWEEN -180 AND 180
      AND customer_location_accuracy_meters > 0 AND customer_location_captured_at IS NOT NULL)
  );

ALTER TABLE public.leads
  ADD CONSTRAINT leads_customer_location_coordinates_check CHECK (
    (customer_location_consent = false AND customer_location_latitude IS NULL AND customer_location_longitude IS NULL)
    OR (customer_location_consent = true AND customer_location_latitude BETWEEN -90 AND 90 AND customer_location_longitude BETWEEN -180 AND 180
      AND customer_location_accuracy_meters > 0 AND customer_location_captured_at IS NOT NULL)
  );

COMMIT;
