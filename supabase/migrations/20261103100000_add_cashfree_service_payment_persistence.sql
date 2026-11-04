BEGIN;

ALTER TABLE public.service_store_payment_settings
  ADD COLUMN IF NOT EXISTS cashfree_test_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cashfree_test_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS cashfree_test_verified_by uuid
    REFERENCES public.admin_identity_history(id) ON DELETE SET NULL;

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS payment_session_id text,
  ADD COLUMN IF NOT EXISTS cashfree_order_id text,
  ADD COLUMN IF NOT EXISTS total_amount_inr_paise bigint
    GENERATED ALWAYS AS (total_amount_paise) STORED;

COMMENT ON COLUMN public.service_orders.total_amount_inr_paise IS
  'Generated alias of total_amount_paise, explicitly denominated in INR paise. Not a general currency minor-unit amount.';
COMMENT ON COLUMN public.service_orders.payment_session_id IS
  'Cashfree hosted checkout session identifier. Treat as sensitive and never log or expose beyond the checkout flow.';
COMMENT ON COLUMN public.service_orders.cashfree_order_id IS
  'Cashfree-generated cf_order_id, distinct from the merchant-supplied provider_order_id.';

ALTER TABLE public.service_orders
  DROP CONSTRAINT IF EXISTS service_orders_provider_check,
  ADD CONSTRAINT service_orders_provider_check
    CHECK (provider IN ('razorpay', 'cashfree')),
  DROP CONSTRAINT IF EXISTS service_orders_currency_check,
  ADD CONSTRAINT service_orders_currency_check
    CHECK (
      (provider = 'razorpay' AND currency = 'INR')
      OR (provider = 'cashfree' AND currency = 'INR')
    ),
  DROP CONSTRAINT IF EXISTS service_orders_cashfree_checkout_identifiers_check,
  ADD CONSTRAINT service_orders_cashfree_checkout_identifiers_check
    CHECK (
      provider <> 'cashfree'
      OR (
        provider_order_id IS NOT NULL
        AND length(btrim(provider_order_id)) > 0
        AND (
          (
            payment_status = 'pending'
            AND payment_session_id IS NULL
            AND cashfree_order_id IS NULL
          )
          OR (
            payment_session_id IS NOT NULL
            AND length(btrim(payment_session_id)) > 0
            AND cashfree_order_id IS NOT NULL
            AND length(btrim(cashfree_order_id)) > 0
          )
        )
      )
    );

CREATE UNIQUE INDEX IF NOT EXISTS service_orders_provider_payment_session_id_uidx
  ON public.service_orders (provider, payment_session_id)
  WHERE payment_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS service_orders_cashfree_order_id_uidx
  ON public.service_orders (cashfree_order_id)
  WHERE cashfree_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS service_orders_provider_payment_id_idx
  ON public.service_orders (provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.cashfree_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_order_id uuid REFERENCES public.service_orders(id) ON DELETE SET NULL,
  event_fingerprint text NOT NULL
    CHECK (event_fingerprint ~ '^[0-9a-f]{64}$'),
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 120),
  provider_order_id text,
  provider_payment_id text,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processing', 'processed', 'failed')),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT cashfree_webhook_events_event_fingerprint_key UNIQUE (event_fingerprint)
);

CREATE INDEX IF NOT EXISTS cashfree_webhook_events_service_order_id_idx
  ON public.cashfree_webhook_events (service_order_id);
CREATE INDEX IF NOT EXISTS cashfree_webhook_events_provider_order_id_idx
  ON public.cashfree_webhook_events (provider_order_id)
  WHERE provider_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cashfree_webhook_events_provider_payment_id_idx
  ON public.cashfree_webhook_events (provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

COMMENT ON TABLE public.cashfree_webhook_events IS
  'Minimal durable Cashfree webhook deduplication and reconciliation metadata. Retain fingerprints and provider identifiers; do not purge solely by age. Never store raw payloads or secrets.';
COMMENT ON COLUMN public.cashfree_webhook_events.event_fingerprint IS
  'SHA-256 fingerprint of the exact verified raw webhook body. Detects byte-identical retries only; not a stable provider event identity.';
COMMENT ON COLUMN public.cashfree_webhook_events.provider_payment_id IS
  'Durable provider payment identifier for reconciliation and payment-level idempotency.';

CREATE TABLE IF NOT EXISTS public.cashfree_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_order_id uuid REFERENCES public.service_orders(id) ON DELETE SET NULL,
  provider_order_id text NOT NULL,
  cashfree_order_id text NOT NULL,
  provider_payment_id text NOT NULL,
  payment_status text NOT NULL CHECK (
    payment_status IN ('SUCCESS', 'NOT_ATTEMPTED', 'FAILED', 'USER_DROPPED', 'VOID', 'CANCELLED', 'PENDING')
  ),
  payment_amount_paise bigint NOT NULL CHECK (payment_amount_paise > 0),
  currency text NOT NULL CHECK (currency = 'INR'),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cashfree_payment_attempts_provider_payment_id_key UNIQUE (provider_payment_id)
);

CREATE INDEX IF NOT EXISTS cashfree_payment_attempts_service_order_id_idx
  ON public.cashfree_payment_attempts (service_order_id);
CREATE INDEX IF NOT EXISTS cashfree_payment_attempts_provider_order_id_idx
  ON public.cashfree_payment_attempts (provider_order_id);

COMMENT ON TABLE public.cashfree_payment_attempts IS
  'Durable Cashfree attempt-level identifiers and verified payment state for reconciliation. Retain records; do not purge solely by age. Never store raw payloads or secrets.';

CREATE TABLE IF NOT EXISTS public.cashfree_checkout_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_idempotency_hash text NOT NULL
    CHECK (client_idempotency_hash ~ '^[0-9a-f]{64}$'),
  request_fingerprint text NOT NULL
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  service_order_id uuid UNIQUE
    REFERENCES public.service_orders(id) ON DELETE SET NULL,
  order_reference text NOT NULL UNIQUE,
  provider_idempotency_key text NOT NULL UNIQUE
    CHECK (provider_idempotency_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  state text NOT NULL DEFAULT 'creating'
    CHECK (state IN ('creating', 'ambiguous', 'completed', 'expired', 'manual_reconciliation')),
  claim_token uuid,
  lease_expires_at timestamptz,
  intent_expires_at timestamptz NOT NULL,
  create_attempt_count integer NOT NULL DEFAULT 0
    CHECK (create_attempt_count BETWEEN 0 AND 3),
  provider_request_started boolean NOT NULL DEFAULT false,
  cashfree_order_id text UNIQUE,
  failure_kind text
    CHECK (failure_kind IS NULL OR failure_kind IN ('provider_outcome_unknown', 'manual_reconciliation_required')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cashfree_checkout_intents_client_key UNIQUE (client_idempotency_hash),
  CONSTRAINT cashfree_checkout_intents_lease_check CHECK (
    (claim_token IS NULL AND lease_expires_at IS NULL)
    OR (claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS cashfree_checkout_intents_recovery_idx
  ON public.cashfree_checkout_intents (state, lease_expires_at)
  WHERE state IN ('creating', 'ambiguous');

COMMENT ON TABLE public.cashfree_checkout_intents IS
  'Durable Cashfree Sandbox Create Order idempotency state. Retain key hashes, fingerprints, merchant/provider identifiers and recovery state; do not purge solely by age.';
COMMENT ON COLUMN public.cashfree_checkout_intents.client_idempotency_hash IS
  'SHA-256 of the opaque client checkout key; the plaintext key is not stored.';
COMMENT ON COLUMN public.cashfree_checkout_intents.request_fingerprint IS
  'SHA-256 of normalized customer and cart identity (package IDs and quantities). A reused key with different customer/cart details is rejected; the first validated price snapshot remains authoritative for retries.';
COMMENT ON COLUMN public.cashfree_checkout_intents.provider_request_started IS
  'Set atomically before a Create Order request. After a crash, retries reconcile by merchant order ID before any repeat POST.';

ALTER TABLE public.cashfree_checkout_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cashfree_checkout_intents FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.cashfree_checkout_intents FROM service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.cashfree_checkout_intents TO service_role;

ALTER TABLE public.cashfree_payment_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cashfree_payment_attempts FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.cashfree_payment_attempts FROM service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.cashfree_payment_attempts TO service_role;

ALTER TABLE public.cashfree_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cashfree_webhook_events FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.cashfree_webhook_events FROM service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.cashfree_webhook_events TO service_role;

CREATE OR REPLACE FUNCTION public.claim_cashfree_checkout_intent(
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
  p_create_if_missing boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  intent_row public.cashfree_checkout_intents%ROWTYPE;
  order_row public.service_orders%ROWTYPE;
  new_claim_token uuid;
  claim_action text;
BEGIN
  IF p_client_idempotency_hash IS NULL OR p_client_idempotency_hash !~ '^[0-9a-f]{64}$' OR
     p_request_fingerprint IS NULL OR p_request_fingerprint !~ '^[0-9a-f]{64}$' OR
     p_create_if_missing IS NULL THEN
    RAISE EXCEPTION 'Invalid Cashfree checkout intent';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_idempotency_hash, 0));
  SELECT * INTO intent_row
  FROM public.cashfree_checkout_intents
  WHERE client_idempotency_hash = p_client_idempotency_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    IF NOT p_create_if_missing THEN
      RETURN jsonb_build_object('status', 'missing');
    END IF;
    IF p_order_reference IS NULL OR p_order_reference !~ '^NGO-[A-F0-9]{24}$' OR
       p_provider_idempotency_key IS NULL OR p_provider_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
       p_tracking_token_hash IS NULL OR p_tracking_token_hash !~ '^[0-9a-f]{64}$' OR
       p_customer_name IS NULL OR length(p_customer_name) NOT BETWEEN 2 AND 120 OR
       p_customer_email IS NULL OR length(p_customer_email) NOT BETWEEN 3 AND 255 OR
       p_customer_phone IS NULL OR length(p_customer_phone) NOT BETWEEN 7 AND 25 OR
       p_customer_business_name IS NULL OR length(p_customer_business_name) > 160 OR
       p_customer_onboarding_notes IS NULL OR length(p_customer_onboarding_notes) > 2000 OR
       p_line_items IS NULL OR jsonb_typeof(p_line_items) <> 'array' OR
       p_total_amount_paise IS NULL OR p_total_amount_paise < 100 OR
       p_currency IS DISTINCT FROM 'INR' THEN
      RAISE EXCEPTION 'Invalid Cashfree checkout snapshot';
    END IF;
    INSERT INTO public.service_orders (
      order_reference, tracking_token_hash, customer_name, customer_email, customer_phone,
      customer_business_name, customer_onboarding_notes, line_items, total_amount_paise,
      currency, provider, provider_mode, provider_order_id
    ) VALUES (
      p_order_reference, p_tracking_token_hash, p_customer_name, lower(p_customer_email), p_customer_phone,
      p_customer_business_name, p_customer_onboarding_notes, p_line_items, p_total_amount_paise,
      'INR', 'cashfree', 'test', p_order_reference
    )
    RETURNING * INTO order_row;

    INSERT INTO public.cashfree_checkout_intents (
      client_idempotency_hash, request_fingerprint, service_order_id, order_reference,
      provider_idempotency_key, intent_expires_at
    ) VALUES (
      p_client_idempotency_hash, p_request_fingerprint, order_row.id, p_order_reference,
      p_provider_idempotency_key, now() + interval '24 hours'
    )
    RETURNING * INTO intent_row;
  ELSE
    IF intent_row.request_fingerprint <> p_request_fingerprint THEN
      RETURN jsonb_build_object('status', 'conflict');
    END IF;

    SELECT * INTO order_row
    FROM public.service_orders
    WHERE id = intent_row.service_order_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'manual_reconciliation');
    END IF;
    IF intent_row.state = 'completed' THEN
      IF order_row.payment_session_id IS NULL THEN
        RETURN jsonb_build_object('status', 'manual_reconciliation');
      END IF;
      RETURN jsonb_build_object(
        'status', 'completed',
        'service_order_id', order_row.id,
        'order_reference', intent_row.order_reference,
        'cashfree_order_id', order_row.cashfree_order_id,
        'payment_session_id', order_row.payment_session_id,
        'total_amount_paise', order_row.total_amount_paise,
        'currency', order_row.currency
      );
    END IF;

    IF intent_row.state IN ('manual_reconciliation', 'expired') AND NOT intent_row.provider_request_started THEN
      RETURN jsonb_build_object('status', intent_row.state);
    END IF;

    IF intent_row.intent_expires_at <= now() AND NOT intent_row.provider_request_started THEN
      UPDATE public.cashfree_checkout_intents
      SET state = 'expired', updated_at = now()
      WHERE id = intent_row.id;
      RETURN jsonb_build_object('status', 'expired');
    END IF;

    IF intent_row.lease_expires_at > now() THEN
      RETURN jsonb_build_object('status', 'busy');
    END IF;
  END IF;

  claim_action := CASE WHEN intent_row.provider_request_started THEN 'reconcile' ELSE 'create' END;
  new_claim_token := gen_random_uuid();
  UPDATE public.cashfree_checkout_intents
  SET state = 'creating',
      claim_token = new_claim_token,
      lease_expires_at = now() + interval '90 seconds',
      updated_at = now()
  WHERE id = intent_row.id
  RETURNING * INTO intent_row;

  RETURN jsonb_build_object(
    'status', 'claimed',
    'action', CASE WHEN intent_row.intent_expires_at <= now() THEN 'reconcile' ELSE claim_action END,
    'intent_id', intent_row.id,
    'service_order_id', intent_row.service_order_id,
    'order_reference', intent_row.order_reference,
    'provider_idempotency_key', intent_row.provider_idempotency_key,
    'claim_token', new_claim_token,
    'create_attempt_count', intent_row.create_attempt_count,
    'expires_at', intent_row.intent_expires_at,
    'total_amount_paise', order_row.total_amount_paise,
    'currency', order_row.currency,
    'customer_name', order_row.customer_name,
    'customer_email', order_row.customer_email,
    'customer_phone', order_row.customer_phone
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_cashfree_checkout_create(
  p_intent_id uuid,
  p_claim_token uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  intent_row public.cashfree_checkout_intents%ROWTYPE;
BEGIN
  SELECT * INTO intent_row
  FROM public.cashfree_checkout_intents
  WHERE id = p_intent_id
  FOR UPDATE;

  IF NOT FOUND OR intent_row.state <> 'creating' OR intent_row.claim_token <> p_claim_token OR
     intent_row.lease_expires_at <= now() OR intent_row.intent_expires_at <= now() OR
     intent_row.create_attempt_count >= 3 THEN
    RETURN false;
  END IF;

  UPDATE public.cashfree_checkout_intents
  SET create_attempt_count = create_attempt_count + 1,
      provider_request_started = true,
      updated_at = now()
  WHERE id = p_intent_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_cashfree_checkout_intent_ambiguous(
  p_intent_id uuid,
  p_claim_token uuid,
  p_failure_kind text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.cashfree_checkout_intents
  SET state = CASE
        WHEN p_failure_kind = 'manual_reconciliation_required' OR create_attempt_count >= 3
          THEN 'manual_reconciliation'
        ELSE 'ambiguous'
      END,
      claim_token = NULL,
      lease_expires_at = NULL,
      failure_kind = p_failure_kind,
      updated_at = now()
  WHERE id = p_intent_id
    AND state = 'creating'
    AND claim_token = p_claim_token
    AND p_failure_kind IN ('provider_outcome_unknown', 'manual_reconciliation_required');
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_cashfree_checkout_intent(
  p_intent_id uuid,
  p_claim_token uuid,
  p_cashfree_order_id text,
  p_payment_session_id text,
  p_total_amount_paise bigint,
  p_currency text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  intent_row public.cashfree_checkout_intents%ROWTYPE;
  order_row public.service_orders%ROWTYPE;
BEGIN
  SELECT * INTO intent_row
  FROM public.cashfree_checkout_intents
  WHERE id = p_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'missing');
  END IF;
  SELECT * INTO order_row
  FROM public.service_orders
  WHERE id = intent_row.service_order_id
  FOR UPDATE;

  IF intent_row.state = 'completed' AND order_row.payment_session_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'completed',
      'payment_session_id', order_row.payment_session_id
    );
  END IF;
  IF intent_row.state <> 'creating' OR intent_row.claim_token <> p_claim_token OR
     intent_row.lease_expires_at <= now() OR NOT FOUND OR
     NOT intent_row.provider_request_started OR
     order_row.provider <> 'cashfree' OR order_row.provider_mode <> 'test' OR
     order_row.provider_order_id <> intent_row.order_reference OR
     order_row.payment_status <> 'pending' OR
     order_row.total_amount_paise <> p_total_amount_paise OR
     p_currency IS DISTINCT FROM 'INR' OR order_row.currency <> 'INR' OR
     p_cashfree_order_id IS NULL OR p_cashfree_order_id !~ '^[A-Za-z0-9_-]{1,80}$' OR
     p_payment_session_id IS NULL OR length(p_payment_session_id) NOT BETWEEN 1 AND 4096 THEN
    RETURN jsonb_build_object('status', 'rejected');
  END IF;

  UPDATE public.service_orders
  SET cashfree_order_id = p_cashfree_order_id,
      payment_session_id = p_payment_session_id,
      updated_at = now()
  WHERE id = order_row.id;

  UPDATE public.cashfree_checkout_intents
  SET state = 'completed',
      cashfree_order_id = p_cashfree_order_id,
      claim_token = NULL,
      lease_expires_at = NULL,
      failure_kind = NULL,
      updated_at = now()
  WHERE id = intent_row.id;

  RETURN jsonb_build_object(
    'status', 'completed',
    'payment_session_id', p_payment_session_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_cashfree_checkout_intent(text, text, text, text, text, text, text, text, text, text, jsonb, bigint, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_cashfree_checkout_intent(text, text, text, text, text, text, text, text, text, text, jsonb, bigint, text, boolean)
  TO service_role;
REVOKE ALL ON FUNCTION public.prepare_cashfree_checkout_create(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_cashfree_checkout_create(uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.mark_cashfree_checkout_intent_ambiguous(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_cashfree_checkout_intent_ambiguous(uuid, uuid, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.complete_cashfree_checkout_intent(uuid, uuid, text, text, bigint, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_cashfree_checkout_intent(uuid, uuid, text, text, bigint, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.process_cashfree_webhook_event(
  p_event_fingerprint text,
  p_event_type text,
  p_provider_order_id text,
  p_cashfree_order_id text,
  p_provider_payment_id text,
  p_payment_status text,
  p_payment_amount_paise bigint,
  p_currency text,
  p_is_captured boolean
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  order_row public.service_orders%ROWTYPE;
  event_row_id uuid;
  attempt_status text;
BEGIN
  IF p_event_fingerprint IS NULL OR p_event_fingerprint !~ '^[0-9a-f]{64}$' OR
     p_event_type IS NULL OR length(p_event_type) NOT BETWEEN 1 AND 120 OR
     p_provider_order_id IS NULL OR length(p_provider_order_id) NOT BETWEEN 1 AND 80 OR
     p_cashfree_order_id IS NULL OR length(p_cashfree_order_id) NOT BETWEEN 1 AND 80 OR
     p_provider_payment_id IS NULL OR length(p_provider_payment_id) NOT BETWEEN 1 AND 80 OR
     p_payment_status IS NULL OR
     p_payment_status NOT IN ('SUCCESS', 'NOT_ATTEMPTED', 'FAILED', 'USER_DROPPED', 'VOID', 'CANCELLED', 'PENDING') OR
     p_payment_amount_paise IS NULL OR p_payment_amount_paise <= 0 OR
     p_currency IS DISTINCT FROM 'INR' OR
     p_is_captured IS DISTINCT FROM (p_payment_status = 'SUCCESS') THEN
    RETURN 'invalid_payment';
  END IF;

  INSERT INTO public.cashfree_webhook_events (
    event_fingerprint, event_type, provider_order_id, provider_payment_id
  ) VALUES (
    p_event_fingerprint, p_event_type, p_provider_order_id, p_provider_payment_id
  )
  ON CONFLICT (event_fingerprint) DO UPDATE
    SET received_at = now()
  RETURNING id INTO event_row_id;

  SELECT * INTO order_row
  FROM public.service_orders
  WHERE provider = 'cashfree'
    AND provider_order_id = p_provider_order_id
    AND cashfree_order_id = p_cashfree_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.cashfree_webhook_events
    SET processing_status = 'failed', processed_at = now()
    WHERE id = event_row_id;
    RETURN 'unmatched_order';
  END IF;

  UPDATE public.cashfree_webhook_events
  SET service_order_id = order_row.id
  WHERE id = event_row_id;

  IF order_row.currency <> 'INR' OR order_row.total_amount_paise <> p_payment_amount_paise THEN
    UPDATE public.cashfree_webhook_events
    SET processing_status = 'failed', processed_at = now()
    WHERE id = event_row_id;
    RETURN 'amount_mismatch';
  END IF;

  INSERT INTO public.cashfree_payment_attempts AS stored_attempt (
    service_order_id, provider_order_id, cashfree_order_id, provider_payment_id,
    payment_status, payment_amount_paise, currency
  ) VALUES (
    order_row.id, p_provider_order_id, p_cashfree_order_id, p_provider_payment_id,
    p_payment_status, p_payment_amount_paise, p_currency
  )
  ON CONFLICT (provider_payment_id) DO UPDATE
    SET payment_status = CASE
          WHEN stored_attempt.payment_status = 'SUCCESS' THEN 'SUCCESS'
          ELSE EXCLUDED.payment_status
        END,
        last_seen_at = now()
    WHERE stored_attempt.service_order_id = EXCLUDED.service_order_id
      AND stored_attempt.provider_order_id = EXCLUDED.provider_order_id
      AND stored_attempt.cashfree_order_id = EXCLUDED.cashfree_order_id
      AND stored_attempt.payment_amount_paise = EXCLUDED.payment_amount_paise
      AND stored_attempt.currency = EXCLUDED.currency
  RETURNING payment_status INTO attempt_status;

  IF NOT FOUND THEN
    UPDATE public.cashfree_webhook_events
    SET processing_status = 'failed', processed_at = now()
    WHERE id = event_row_id;
    RETURN 'payment_identifier_conflict';
  END IF;

  IF attempt_status <> 'SUCCESS' THEN
    UPDATE public.cashfree_webhook_events
    SET processing_status = 'processed', processed_at = now()
    WHERE id = event_row_id;
    RETURN 'recorded';
  END IF;

  IF order_row.payment_status = 'paid' THEN
    UPDATE public.cashfree_webhook_events
    SET processing_status = 'processed', processed_at = now()
    WHERE id = event_row_id;
    RETURN CASE WHEN order_row.provider_payment_id = p_provider_payment_id
      THEN 'already_paid'
      ELSE 'additional_successful_attempt'
    END;
  END IF;

  IF NOT public.confirm_service_order_payment(
    p_provider_order_id, p_provider_payment_id, p_payment_amount_paise
  ) THEN
    UPDATE public.cashfree_webhook_events
    SET processing_status = 'failed', processed_at = now()
    WHERE id = event_row_id;
    RETURN 'confirmation_rejected';
  END IF;

  UPDATE public.cashfree_webhook_events
  SET processing_status = 'processed', processed_at = now()
  WHERE id = event_row_id;
  RETURN 'paid';
END;
$$;

REVOKE ALL ON FUNCTION public.process_cashfree_webhook_event(text, text, text, text, text, text, bigint, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_cashfree_webhook_event(text, text, text, text, text, text, bigint, text, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.set_cashfree_test_gateway(
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
  IF NOT EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE id = p_actor_id
      AND status = 'active'
      AND role = 'owner'
      AND is_primary_owner = true
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
  SET cashfree_test_enabled = p_enable,
      updated_by = p_actor_id,
      updated_at = now()
  WHERE id = true;

  INSERT INTO public.service_store_payment_audit (
    actor_id, action, field_name, old_value_masked, new_value_masked, verification_result, activation_status
  ) VALUES (
    p_actor_id,
    CASE WHEN p_enable THEN 'cashfree_test_enabled' ELSE 'cashfree_test_disabled' END,
    'cashfree_test_gateway',
    CASE WHEN settings_row.cashfree_test_enabled THEN 'enabled' ELSE 'disabled' END,
    CASE WHEN p_enable THEN 'enabled' ELSE 'disabled' END,
    'sandbox_server_configuration_present',
    CASE WHEN p_enable THEN 'test_mode_enabled_no_real_settlement' ELSE 'disabled' END
  );
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_cashfree_test_gateway(uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_cashfree_test_gateway(uuid, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.cashfree_gateway_readiness()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  required_procedures text[] := ARRAY[
    'public.claim_cashfree_checkout_intent(text,text,text,text,text,text,text,text,text,text,jsonb,bigint,text,boolean)',
    'public.prepare_cashfree_checkout_create(uuid,uuid)',
    'public.mark_cashfree_checkout_intent_ambiguous(uuid,uuid,text)',
    'public.complete_cashfree_checkout_intent(uuid,uuid,text,text,bigint,text)',
    'public.process_cashfree_webhook_event(text,text,text,text,text,text,bigint,text,boolean)',
    'public.set_cashfree_test_gateway(uuid,boolean)',
    'public.confirm_service_order_payment(text,text,bigint)',
    'public.cashfree_gateway_readiness()'
  ];
  procedure_signature text;
  procedure_oid oid;
  anon_oid oid;
  authenticated_oid oid;
BEGIN
  SELECT oid INTO anon_oid FROM pg_catalog.pg_roles WHERE rolname = 'anon';
  SELECT oid INTO authenticated_oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated';
  IF anon_oid IS NULL OR authenticated_oid IS NULL OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RETURN false;
  END IF;

  IF to_regclass('public.service_orders') IS NULL OR
     to_regclass('public.service_store_payment_settings') IS NULL OR
     to_regclass('public.cashfree_checkout_intents') IS NULL OR
     to_regclass('public.cashfree_payment_attempts') IS NULL OR
     to_regclass('public.cashfree_webhook_events') IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.service_orders'::regclass
      AND attname IN ('provider', 'provider_mode', 'provider_order_id', 'provider_payment_id',
                      'payment_status', 'currency', 'total_amount_paise', 'total_amount_inr_paise',
                      'cashfree_order_id', 'payment_session_id', 'tracking_token_hash')
      AND NOT attisdropped
    GROUP BY attrelid
    HAVING count(*) = 11
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.service_store_payment_settings'::regclass
      AND attname = 'cashfree_test_enabled'
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.cashfree_checkout_intents'::regclass
      AND attname IN ('client_idempotency_hash', 'request_fingerprint', 'service_order_id',
                      'order_reference', 'provider_idempotency_key', 'state', 'claim_token',
                      'lease_expires_at', 'intent_expires_at', 'create_attempt_count',
                      'provider_request_started', 'cashfree_order_id')
      AND NOT attisdropped
    GROUP BY attrelid
    HAVING count(*) = 12
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.cashfree_payment_attempts'::regclass
      AND attname IN ('service_order_id', 'provider_order_id', 'cashfree_order_id',
                      'provider_payment_id', 'payment_status', 'payment_amount_paise', 'currency',
                      'last_seen_at')
      AND NOT attisdropped
    GROUP BY attrelid
    HAVING count(*) = 8
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.cashfree_webhook_events'::regclass
      AND attname IN ('service_order_id', 'event_fingerprint', 'event_type', 'provider_order_id',
                      'provider_payment_id', 'processing_status', 'received_at', 'processed_at')
      AND NOT attisdropped
    GROUP BY attrelid
    HAVING count(*) = 8
  ) THEN
    RETURN false;
  END IF;

  IF NOT has_table_privilege('service_role', 'public.service_orders', 'SELECT,INSERT,UPDATE') OR
     NOT has_table_privilege('service_role', 'public.service_store_payment_settings', 'SELECT,INSERT,UPDATE') OR
     NOT has_table_privilege('service_role', 'public.cashfree_checkout_intents', 'SELECT,INSERT,UPDATE') OR
     NOT has_table_privilege('service_role', 'public.cashfree_payment_attempts', 'SELECT,INSERT,UPDATE') OR
     NOT has_table_privilege('service_role', 'public.cashfree_webhook_events', 'SELECT,INSERT,UPDATE') OR
     NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.service_orders'::regclass) OR
     NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.service_store_payment_settings'::regclass) OR
     NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.cashfree_checkout_intents'::regclass) OR
     NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.cashfree_payment_attempts'::regclass) OR
     NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.cashfree_webhook_events'::regclass) THEN
    RETURN false;
  END IF;

  FOREACH procedure_signature IN ARRAY required_procedures LOOP
    procedure_oid := to_regprocedure(procedure_signature);
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

REVOKE ALL ON FUNCTION public.cashfree_gateway_readiness()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cashfree_gateway_readiness()
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
