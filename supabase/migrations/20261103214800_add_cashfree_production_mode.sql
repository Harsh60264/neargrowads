BEGIN;

ALTER TABLE public.service_orders
  DROP CONSTRAINT IF EXISTS service_orders_provider_mode_check,
  ADD CONSTRAINT service_orders_provider_mode_check
    CHECK (
      (provider = 'razorpay' AND provider_mode = 'test')
      OR (provider = 'cashfree' AND provider_mode IN ('test', 'live'))
    );

ALTER TABLE public.service_store_payment_settings
  ADD COLUMN IF NOT EXISTS cashfree_production_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cashfree_production_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS cashfree_production_verified_by uuid
    REFERENCES public.admin_identity_history(id) ON DELETE SET NULL;

ALTER TABLE public.cashfree_checkout_intents
  ADD COLUMN IF NOT EXISTS checkout_mode text NOT NULL DEFAULT 'sandbox';

ALTER TABLE public.cashfree_checkout_intents
  DROP CONSTRAINT IF EXISTS cashfree_checkout_intents_checkout_mode_check,
  ADD CONSTRAINT cashfree_checkout_intents_checkout_mode_check
    CHECK (checkout_mode IN ('sandbox', 'production'));

COMMENT ON COLUMN public.service_store_payment_settings.cashfree_production_enabled IS
  'Primary Owner-controlled live Cashfree activation. Defaults disabled; independent of Sandbox activation.';
COMMENT ON COLUMN public.cashfree_checkout_intents.checkout_mode IS
  'Deployment environment bound to this durable idempotency intent. Existing intents are Sandbox.';
COMMENT ON COLUMN public.cashfree_webhook_events.event_fingerprint IS
  'SHA-256 retry fingerprint; Production prefixes the selected mode before hashing the verified raw body to isolate environments.';

CREATE OR REPLACE FUNCTION public.claim_cashfree_checkout_intent_for_mode(
  p_client_idempotency_hash text,
  p_request_fingerprint text,
  p_order_reference text,
  p_provider_idempotency_key text,
  p_tracking_token_hash text,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_customer_business_name text,
  p_customer_onboarding_notes text,
  p_line_items jsonb,
  p_total_amount_paise bigint,
  p_currency text,
  p_create_if_missing boolean,
  p_checkout_mode text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  result jsonb;
  existing_mode text;
  order_uuid uuid;
BEGIN
  IF p_checkout_mode IS DISTINCT FROM 'production' THEN
    RETURN jsonb_build_object('status', 'invalid_mode');
  END IF;

  SELECT checkout_mode INTO existing_mode
  FROM public.cashfree_checkout_intents
  WHERE client_idempotency_hash = p_client_idempotency_hash
  FOR UPDATE;
  IF FOUND AND existing_mode <> p_checkout_mode THEN
    RETURN jsonb_build_object('status', 'conflict');
  END IF;

  result := public.claim_cashfree_checkout_intent(
    p_client_idempotency_hash, p_request_fingerprint, p_order_reference,
    p_provider_idempotency_key, p_tracking_token_hash, p_customer_name,
    p_customer_email, p_customer_phone, p_customer_business_name,
    p_customer_onboarding_notes, p_line_items, p_total_amount_paise,
    p_currency, p_create_if_missing
  );
  IF result->>'service_order_id' IS NULL OR
     result->>'status' NOT IN ('claimed', 'completed') THEN
    RETURN result;
  END IF;

  order_uuid := (result->>'service_order_id')::uuid;
  UPDATE public.cashfree_checkout_intents
  SET checkout_mode = 'production'
  WHERE service_order_id = order_uuid
    AND checkout_mode IN ('sandbox', 'production');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cashfree production intent mode could not be persisted';
  END IF;

  UPDATE public.service_orders
  SET provider_mode = 'live'
  WHERE id = order_uuid
    AND provider = 'cashfree'
    AND payment_status = 'pending'
    AND currency = 'INR';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cashfree production order mode could not be persisted';
  END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_cashfree_checkout_intent_for_mode(
  p_intent_id uuid,
  p_claim_token uuid,
  p_cashfree_order_id text,
  p_payment_session_id text,
  p_total_amount_paise bigint,
  p_currency text,
  p_checkout_mode text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  result jsonb;
  order_uuid uuid;
BEGIN
  IF p_checkout_mode IS DISTINCT FROM 'production' THEN
    RETURN jsonb_build_object('status', 'invalid_mode');
  END IF;
  SELECT service_order_id INTO order_uuid
  FROM public.cashfree_checkout_intents
  WHERE id = p_intent_id AND checkout_mode = p_checkout_mode
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'mode_mismatch');
  END IF;

  UPDATE public.service_orders
  SET provider_mode = 'test'
  WHERE id = order_uuid AND provider = 'cashfree' AND provider_mode = 'live';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'mode_mismatch');
  END IF;

  result := public.complete_cashfree_checkout_intent(
    p_intent_id, p_claim_token, p_cashfree_order_id,
    p_payment_session_id, p_total_amount_paise, p_currency
  );
  UPDATE public.service_orders
  SET provider_mode = 'live'
  WHERE id = order_uuid AND provider = 'cashfree' AND provider_mode = 'test';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cashfree production order mode could not be restored';
  END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_cashfree_webhook_event_for_mode(
  p_event_fingerprint text,
  p_event_type text,
  p_provider_order_id text,
  p_cashfree_order_id text,
  p_provider_payment_id text,
  p_payment_status text,
  p_payment_amount_paise bigint,
  p_currency text,
  p_is_captured boolean,
  p_checkout_mode text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_checkout_mode IS DISTINCT FROM 'production' OR NOT EXISTS (
    SELECT 1
    FROM public.service_orders
    WHERE provider = 'cashfree'
      AND provider_mode = 'live'
      AND provider_order_id = p_provider_order_id
      AND cashfree_order_id = p_cashfree_order_id
  ) THEN
    RETURN 'unmatched_order';
  END IF;
  RETURN public.process_cashfree_webhook_event(
    p_event_fingerprint, p_event_type, p_provider_order_id,
    p_cashfree_order_id, p_provider_payment_id, p_payment_status,
    p_payment_amount_paise, p_currency, p_is_captured
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_cashfree_production_gateway(
  p_actor_id uuid,
  p_enable boolean
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  settings_row public.service_store_payment_settings%ROWTYPE;
BEGIN
  IF p_enable IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE id = p_actor_id AND status = 'active'
      AND role = 'owner' AND is_primary_owner = true
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.service_store_payment_settings (id)
  VALUES (true)
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO settings_row
  FROM public.service_store_payment_settings
  WHERE id = true
  FOR UPDATE;

  UPDATE public.service_store_payment_settings
  SET cashfree_production_enabled = p_enable,
      cashfree_production_verified_at = CASE WHEN p_enable THEN now() ELSE NULL END,
      cashfree_production_verified_by = CASE WHEN p_enable THEN p_actor_id ELSE NULL END,
      updated_by = p_actor_id,
      updated_at = now()
  WHERE id = true;

  INSERT INTO public.service_store_payment_audit (
    actor_id, action, field_name, old_value_masked, new_value_masked,
    verification_result, activation_status
  ) VALUES (
    p_actor_id,
    CASE WHEN p_enable THEN 'cashfree_production_enabled' ELSE 'cashfree_production_disabled' END,
    'cashfree_production_gateway',
    CASE WHEN settings_row.cashfree_production_enabled THEN 'enabled' ELSE 'disabled' END,
    CASE WHEN p_enable THEN 'enabled' ELSE 'disabled' END,
    'production_server_configuration_present',
    CASE WHEN p_enable THEN 'live_mode_enabled' ELSE 'disabled' END
  );
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_cashfree_checkout_intent_for_mode(text, text, text, text, text, text, text, text, text, text, jsonb, bigint, text, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_cashfree_checkout_intent_for_mode(text, text, text, text, text, text, text, text, text, text, jsonb, bigint, text, boolean, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.complete_cashfree_checkout_intent_for_mode(uuid, uuid, text, text, bigint, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_cashfree_checkout_intent_for_mode(uuid, uuid, text, text, bigint, text, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.process_cashfree_webhook_event_for_mode(text, text, text, text, text, text, bigint, text, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_cashfree_webhook_event_for_mode(text, text, text, text, text, text, bigint, text, boolean, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.set_cashfree_production_gateway(uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_cashfree_production_gateway(uuid, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.cashfree_production_gateway_readiness()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  procedure_signature text;
  procedure_oid oid;
  anon_oid oid;
  authenticated_oid oid;
BEGIN
  IF NOT public.cashfree_gateway_readiness() OR
     to_regclass('public.admin_identity_history') IS NULL OR
     NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.service_store_payment_settings'::regclass
         AND attname IN (
           'cashfree_production_enabled',
           'cashfree_production_verified_at',
           'cashfree_production_verified_by'
         )
         AND NOT attisdropped
       GROUP BY attrelid HAVING count(*) = 3
     ) OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.cashfree_checkout_intents'::regclass
         AND attname = 'checkout_mode' AND NOT attisdropped AND attnotnull
         AND format_type(atttypid, atttypmod) = 'text'
     ) OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute AS setting_column
       JOIN pg_catalog.pg_attrdef AS setting_default
         ON setting_default.adrelid = setting_column.attrelid
        AND setting_default.adnum = setting_column.attnum
       WHERE setting_column.attrelid = 'public.service_store_payment_settings'::regclass
         AND setting_column.attname = 'cashfree_production_enabled'
         AND setting_column.attnotnull
         AND pg_catalog.pg_get_expr(setting_default.adbin, setting_default.adrelid) = 'false'
     ) OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_constraint AS foreign_key
       JOIN pg_catalog.pg_attribute AS source_column
         ON source_column.attrelid = foreign_key.conrelid
        AND source_column.attnum = ANY(foreign_key.conkey)
       JOIN pg_catalog.pg_attribute AS target_column
         ON target_column.attrelid = foreign_key.confrelid
        AND target_column.attnum = ANY(foreign_key.confkey)
       WHERE foreign_key.contype = 'f'
         AND foreign_key.convalidated
         AND foreign_key.confdeltype = 'n'
         AND foreign_key.conrelid = 'public.service_store_payment_settings'::regclass
         AND foreign_key.confrelid = 'public.admin_identity_history'::regclass
         AND source_column.attname = 'cashfree_production_verified_by'
         AND target_column.attname = 'id'
     ) OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint
       WHERE conrelid = 'public.service_orders'::regclass
         AND conname = 'service_orders_provider_mode_check'
         AND pg_catalog.pg_get_constraintdef(oid) LIKE '%provider_mode%'
         AND pg_catalog.pg_get_constraintdef(oid) LIKE '%razorpay%'
         AND pg_catalog.pg_get_constraintdef(oid) LIKE '%cashfree%'
         AND pg_catalog.pg_get_constraintdef(oid) LIKE '%test%'
         AND pg_catalog.pg_get_constraintdef(oid) LIKE '%live%'
     ) OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint
       WHERE conrelid = 'public.cashfree_checkout_intents'::regclass
         AND conname = 'cashfree_checkout_intents_checkout_mode_check'
         AND pg_catalog.pg_get_constraintdef(oid) LIKE '%sandbox%'
         AND pg_catalog.pg_get_constraintdef(oid) LIKE '%production%'
     ) THEN
    RETURN false;
  END IF;

  FOREACH procedure_signature IN ARRAY ARRAY[
    'public.claim_cashfree_checkout_intent_for_mode(text,text,text,text,text,text,text,text,text,text,jsonb,bigint,text,boolean,text)',
    'public.complete_cashfree_checkout_intent_for_mode(uuid,uuid,text,text,bigint,text,text)',
    'public.process_cashfree_webhook_event_for_mode(text,text,text,text,text,text,bigint,text,boolean,text)',
    'public.set_cashfree_production_gateway(uuid,boolean)',
    'public.cashfree_production_gateway_readiness()'
  ] LOOP
    procedure_oid := to_regprocedure(procedure_signature);
    SELECT oid INTO anon_oid FROM pg_catalog.pg_roles WHERE rolname = 'anon';
    SELECT oid INTO authenticated_oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated';
    IF procedure_oid IS NULL OR
       NOT has_function_privilege('service_role', procedure_oid, 'EXECUTE') OR
       EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc AS function_row
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(function_row.proacl, pg_catalog.acldefault('f', function_row.proowner))
         ) AS acl_entry
         WHERE function_row.oid = procedure_oid
           AND acl_entry.grantee IN (0, anon_oid, authenticated_oid)
           AND acl_entry.privilege_type = 'EXECUTE'
       ) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.cashfree_production_gateway_readiness()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cashfree_production_gateway_readiness()
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
