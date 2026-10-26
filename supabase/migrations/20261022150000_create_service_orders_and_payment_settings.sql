CREATE TABLE IF NOT EXISTS public.service_store_payment_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  business_name text NOT NULL DEFAULT '',
  payment_contact_phone text NOT NULL DEFAULT '',
  razorpay_test_enabled boolean NOT NULL DEFAULT false,
  razorpay_test_verified_key_id text,
  razorpay_test_verified_at timestamptz,
  razorpay_test_verified_by uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.service_store_payment_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  field_name text NOT NULL,
  old_value_masked text NOT NULL DEFAULT '',
  new_value_masked text NOT NULL DEFAULT '',
  verification_result text NOT NULL DEFAULT 'not_applicable',
  activation_status text NOT NULL DEFAULT 'not_activated',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_store_payment_audit_created_at_idx
  ON public.service_store_payment_audit (created_at DESC);

CREATE OR REPLACE FUNCTION public.update_service_store_payment_contact(
  p_actor_id uuid,
  p_business_name text,
  p_payment_contact_phone text,
  p_confirm_old_phone text,
  p_confirm_new_phone text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  settings_row public.service_store_payment_settings%ROWTYPE;
  old_masked text;
  new_masked text;
BEGIN
  INSERT INTO public.service_store_payment_settings (id)
  VALUES (true)
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO settings_row
  FROM public.service_store_payment_settings
  WHERE id = true
  FOR UPDATE;

  IF settings_row.payment_contact_phone <> p_confirm_old_phone OR
     p_payment_contact_phone <> p_confirm_new_phone THEN
    RETURN false;
  END IF;

  old_masked := CASE WHEN settings_row.payment_contact_phone = '' THEN '' ELSE
    repeat('*', greatest(4, length(regexp_replace(settings_row.payment_contact_phone, '\s', '', 'g')) - 4)) ||
    right(regexp_replace(settings_row.payment_contact_phone, '\s', '', 'g'), 4) END;
  new_masked := CASE WHEN p_payment_contact_phone = '' THEN '' ELSE
    repeat('*', greatest(4, length(regexp_replace(p_payment_contact_phone, '\s', '', 'g')) - 4)) ||
    right(regexp_replace(p_payment_contact_phone, '\s', '', 'g'), 4) END;

  UPDATE public.service_store_payment_settings
  SET business_name = p_business_name,
      payment_contact_phone = p_payment_contact_phone,
      updated_by = p_actor_id,
      updated_at = now()
  WHERE id = true;

  INSERT INTO public.service_store_payment_audit (
    actor_id, action, field_name, old_value_masked, new_value_masked, verification_result, activation_status
  ) VALUES (
    p_actor_id, 'payment_contact_updated', 'payment_contact_phone', old_masked, new_masked,
    'owner_password_reauthenticated', 'not_a_payment_destination'
  );
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_service_store_test_gateway(
  p_actor_id uuid,
  p_key_id text,
  p_enable boolean
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  settings_row public.service_store_payment_settings%ROWTYPE;
BEGIN
  INSERT INTO public.service_store_payment_settings (id)
  VALUES (true)
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO settings_row
  FROM public.service_store_payment_settings
  WHERE id = true
  FOR UPDATE;

  IF p_enable AND settings_row.razorpay_test_verified_key_id IS DISTINCT FROM p_key_id THEN
    RETURN false;
  END IF;

  UPDATE public.service_store_payment_settings
  SET razorpay_test_enabled = p_enable,
      updated_by = p_actor_id,
      updated_at = now()
  WHERE id = true;

  INSERT INTO public.service_store_payment_audit (
    actor_id, action, field_name, old_value_masked, new_value_masked, verification_result, activation_status
  ) VALUES (
    p_actor_id,
    CASE WHEN p_enable THEN 'razorpay_test_enabled' ELSE 'razorpay_test_disabled' END,
    'razorpay_test_gateway',
    CASE WHEN settings_row.razorpay_test_enabled THEN 'enabled' ELSE 'disabled' END,
    CASE WHEN p_enable THEN 'enabled' ELSE 'disabled' END,
    CASE WHEN settings_row.razorpay_test_verified_key_id = p_key_id THEN 'provider_credentials_verified' ELSE 'not_verified' END,
    CASE WHEN p_enable THEN 'test_mode_enabled_no_real_settlement' ELSE 'disabled' END
  );
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_service_store_test_gateway_verification(
  p_actor_id uuid,
  p_key_id text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  settings_row public.service_store_payment_settings%ROWTYPE;
  old_masked text;
  new_masked text;
BEGIN
  INSERT INTO public.service_store_payment_settings (id)
  VALUES (true)
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO settings_row
  FROM public.service_store_payment_settings
  WHERE id = true
  FOR UPDATE;

  old_masked := CASE WHEN settings_row.razorpay_test_verified_key_id IS NULL THEN '' ELSE
    repeat('*', greatest(4, length(settings_row.razorpay_test_verified_key_id) - 4)) ||
    right(settings_row.razorpay_test_verified_key_id, 4) END;
  new_masked := repeat('*', greatest(4, length(p_key_id) - 4)) || right(p_key_id, 4);

  UPDATE public.service_store_payment_settings
  SET razorpay_test_enabled =
        CASE WHEN settings_row.razorpay_test_verified_key_id IS DISTINCT FROM p_key_id THEN false
             ELSE settings_row.razorpay_test_enabled END,
      razorpay_test_verified_key_id = p_key_id,
      razorpay_test_verified_at = now(),
      razorpay_test_verified_by = p_actor_id,
      updated_by = p_actor_id,
      updated_at = now()
  WHERE id = true;

  INSERT INTO public.service_store_payment_audit (
    actor_id, action, field_name, old_value_masked, new_value_masked, verification_result, activation_status
  ) VALUES (
    p_actor_id, 'razorpay_test_credentials_verified', 'razorpay_test_gateway', old_masked, new_masked,
    'provider_api_accepted_test_credentials', 'not_activated'
  );
  RETURN true;
END;
$$;

CREATE TABLE IF NOT EXISTS public.service_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_reference text NOT NULL UNIQUE,
  tracking_token_hash text NOT NULL,
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  customer_phone text NOT NULL,
  customer_business_name text NOT NULL DEFAULT '',
  customer_onboarding_notes text NOT NULL DEFAULT '',
  line_items jsonb NOT NULL CHECK (jsonb_typeof(line_items) = 'array'),
  total_amount_paise bigint NOT NULL CHECK (total_amount_paise > 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  provider text NOT NULL DEFAULT 'razorpay' CHECK (provider = 'razorpay'),
  provider_mode text NOT NULL DEFAULT 'test' CHECK (provider_mode = 'test'),
  provider_order_id text UNIQUE,
  provider_payment_id text UNIQUE,
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  fulfillment_status text NOT NULL DEFAULT 'awaiting_payment' CHECK (fulfillment_status IN ('awaiting_payment', 'queued', 'in_progress', 'completed', 'cancelled')),
  provider_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provider_snapshot) = 'object'),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_orders_created_at_idx
  ON public.service_orders (created_at DESC);
CREATE INDEX IF NOT EXISTS service_orders_payment_status_idx
  ON public.service_orders (payment_status, created_at DESC);

ALTER TABLE public.service_store_payment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_store_payment_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_orders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.service_store_payment_settings FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.service_store_payment_audit FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.service_orders FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE public.service_store_payment_settings TO service_role;
GRANT SELECT, INSERT ON TABLE public.service_store_payment_audit TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.service_orders TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_service_order_payment(
  p_provider_order_id text,
  p_provider_payment_id text,
  p_amount_paise bigint
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  order_row public.service_orders%ROWTYPE;
BEGIN
  SELECT * INTO order_row
  FROM public.service_orders
  WHERE provider_order_id = p_provider_order_id
  FOR UPDATE;

  IF NOT FOUND OR order_row.total_amount_paise <> p_amount_paise THEN
    RETURN false;
  END IF;

  IF order_row.payment_status = 'paid' THEN
    RETURN order_row.provider_payment_id = p_provider_payment_id;
  END IF;

  IF order_row.payment_status <> 'pending' THEN
    RETURN false;
  END IF;

  UPDATE public.service_orders
  SET payment_status = 'paid',
      fulfillment_status = CASE WHEN order_row.provider_mode = 'live' THEN 'queued' ELSE 'awaiting_payment' END,
      provider_payment_id = p_provider_payment_id,
      paid_at = now(),
      updated_at = now()
  WHERE id = order_row.id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_service_order_payment(text, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_service_order_payment(text, text, bigint) TO service_role;
REVOKE ALL ON FUNCTION public.update_service_store_payment_contact(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_service_store_payment_contact(uuid, text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.set_service_store_test_gateway(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_service_store_test_gateway(uuid, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.record_service_store_test_gateway_verification(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_service_store_test_gateway_verification(uuid, text) TO service_role;
