BEGIN;

CREATE TABLE IF NOT EXISTS public.wildcard_business_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_order_id uuid NOT NULL UNIQUE
    REFERENCES public.service_orders(id) ON DELETE RESTRICT,
  business_address text NOT NULL
    CHECK (length(btrim(business_address)) BETWEEN 3 AND 500),
  preferred_promotion_areas text NOT NULL DEFAULT ''
    CHECK (length(preferred_promotion_areas) <= 500),
  purchase_terms_version text NOT NULL
    CHECK (purchase_terms_version = 'localdrop-wildcard-business-v1'),
  purchase_terms_accepted_at timestamptz NOT NULL DEFAULT now(),
  fulfillment_status text NOT NULL DEFAULT 'pending'
    CHECK (fulfillment_status IN ('pending', 'processing', 'in_distribution', 'completed')),
  confirmation_email_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wildcard_business_orders_created_at_idx
  ON public.wildcard_business_orders (created_at DESC);
CREATE INDEX IF NOT EXISTS wildcard_business_orders_fulfillment_status_idx
  ON public.wildcard_business_orders (fulfillment_status, created_at DESC);

ALTER TABLE public.wildcard_business_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wildcard_business_orders FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.wildcard_business_orders FROM service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.wildcard_business_orders TO service_role;

CREATE OR REPLACE FUNCTION public.create_localdrop_wildcard_business_order(
  p_service_order_id uuid,
  p_business_address text,
  p_preferred_promotion_areas text,
  p_terms_version text,
  p_location_consent boolean,
  p_location_latitude numeric,
  p_location_longitude numeric,
  p_location_accuracy_meters numeric,
  p_location_captured_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  order_row public.service_orders%ROWTYPE;
  business_order public.wildcard_business_orders%ROWTYPE;
BEGIN
  IF p_service_order_id IS NULL OR p_business_address IS NULL OR
     length(btrim(p_business_address)) NOT BETWEEN 3 AND 500 OR
     p_preferred_promotion_areas IS NULL OR length(p_preferred_promotion_areas) > 500 OR
     p_terms_version IS DISTINCT FROM 'localdrop-wildcard-business-v1' OR
     p_location_consent IS NULL OR
     (p_location_consent AND (
       p_location_latitude IS NULL OR p_location_latitude NOT BETWEEN -90 AND 90 OR
       p_location_longitude IS NULL OR p_location_longitude NOT BETWEEN -180 AND 180 OR
       p_location_accuracy_meters IS NULL OR p_location_accuracy_meters <= 0 OR
       p_location_accuracy_meters > 50000 OR p_location_captured_at IS NULL OR
       p_location_captured_at > now() + interval '1 minute' OR
       p_location_captured_at < now() - interval '30 days'
     )) OR
     (NOT p_location_consent AND (
       p_location_latitude IS NOT NULL OR p_location_longitude IS NOT NULL OR
       p_location_accuracy_meters IS NOT NULL OR p_location_captured_at IS NOT NULL
     )) THEN
    RAISE EXCEPTION 'Invalid WildCard business order details';
  END IF;

  SELECT * INTO order_row
  FROM public.service_orders
  WHERE id = p_service_order_id
  FOR UPDATE;

  IF NOT FOUND OR order_row.provider <> 'cashfree' OR order_row.currency <> 'INR' OR
     order_row.total_amount_paise <> 1000000 OR jsonb_array_length(order_row.line_items) <> 1 OR
     order_row.line_items->0->>'packageCode' <> 'WILDCARD-BUSINESS-2100' OR
     order_row.line_items->0->>'quantity' <> '2100' OR
     order_row.line_items->0->>'lineSubtotalInr' <> '10000' THEN
    RAISE EXCEPTION 'Cashfree order does not match the fixed WildCard package';
  END IF;

  SELECT * INTO business_order
  FROM public.wildcard_business_orders
  WHERE service_order_id = p_service_order_id
  FOR UPDATE;

  IF FOUND THEN
    IF business_order.business_address <> btrim(p_business_address) OR
       business_order.preferred_promotion_areas <> btrim(p_preferred_promotion_areas) OR
       business_order.purchase_terms_version <> p_terms_version OR
       order_row.customer_location_consent <> p_location_consent OR
       order_row.customer_location_latitude IS DISTINCT FROM p_location_latitude OR
       order_row.customer_location_longitude IS DISTINCT FROM p_location_longitude OR
       order_row.customer_location_accuracy_meters IS DISTINCT FROM p_location_accuracy_meters OR
       order_row.customer_location_captured_at IS DISTINCT FROM p_location_captured_at THEN
      RAISE EXCEPTION 'WildCard business order details conflict with the original checkout';
    END IF;
    RETURN business_order.id;
  END IF;

  UPDATE public.service_orders
  SET customer_location_consent = p_location_consent,
      customer_location_latitude = p_location_latitude,
      customer_location_longitude = p_location_longitude,
      customer_location_accuracy_meters = p_location_accuracy_meters,
      customer_location_captured_at = p_location_captured_at,
      updated_at = now()
  WHERE id = p_service_order_id;

  INSERT INTO public.wildcard_business_orders (
    service_order_id, business_address, preferred_promotion_areas, purchase_terms_version
  ) VALUES (
    p_service_order_id, btrim(p_business_address), btrim(p_preferred_promotion_areas), p_terms_version
  )
  RETURNING * INTO business_order;

  RETURN business_order.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_localdrop_business_order_fulfillment(
  p_admin_id uuid,
  p_business_order_id uuid,
  p_fulfillment_status text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  business_order public.wildcard_business_orders%ROWTYPE;
  payment_status text;
  payment_mode text;
BEGIN
  PERFORM public.assert_delivery_team_admin(p_admin_id, 'edit');
  IF p_business_order_id IS NULL OR p_fulfillment_status IS NULL OR
     p_fulfillment_status NOT IN ('pending', 'processing', 'in_distribution', 'completed') THEN
    RAISE EXCEPTION 'Invalid WildCard business order fulfillment update';
  END IF;

  SELECT b.*
  INTO business_order
  FROM public.wildcard_business_orders AS b
  JOIN public.service_orders AS s ON s.id = b.service_order_id
  WHERE b.id = p_business_order_id
  FOR UPDATE OF b, s;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WildCard business order not found';
  END IF;
  SELECT s.payment_status, s.provider_mode
  INTO payment_status, payment_mode
  FROM public.service_orders AS s
  WHERE s.id = business_order.service_order_id;
  IF payment_status <> 'paid' OR payment_mode <> 'live' THEN
    RAISE EXCEPTION 'Only verified Production payments can enter fulfillment';
  END IF;

  UPDATE public.wildcard_business_orders
  SET fulfillment_status = p_fulfillment_status,
      updated_at = now()
  WHERE id = p_business_order_id;

  RETURN p_fulfillment_status;
END;
$$;

REVOKE ALL ON FUNCTION public.create_localdrop_wildcard_business_order(
  uuid, text, text, text, boolean, numeric, numeric, numeric, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_localdrop_wildcard_business_order(
  uuid, text, text, text, boolean, numeric, numeric, numeric, timestamptz
) TO service_role;
REVOKE ALL ON FUNCTION public.admin_update_localdrop_business_order_fulfillment(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_localdrop_business_order_fulfillment(uuid, uuid, text)
  TO service_role;

COMMIT;
