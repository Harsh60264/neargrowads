BEGIN;

DO $guard$
BEGIN
  IF current_database() !~ '^wildcard_inventory_test_' OR
     inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN
    RAISE EXCEPTION 'WildCard inventory regression tests require the disposable loopback test database';
  END IF;
END;
$guard$;

DO $tests$
DECLARE
  v_owner_id constant uuid := 'a1000000-0000-4000-8000-000000000001';
  v_restricted_admin_id constant uuid := 'a1000000-0000-4000-8000-000000000002';
  v_partner_id constant uuid := 'a1000000-0000-4000-8000-000000000011';
  v_no_campaign_partner_id constant uuid := 'a1000000-0000-4000-8000-000000000012';
  v_concurrent_partner_id constant uuid := 'a1000000-0000-4000-8000-000000000013';
  v_campaign_id uuid;
  v_assignment_id uuid;
  v_concurrent_assignment_id uuid;
  v_site_id uuid;
  v_request_id uuid;
  v_proof_id uuid;
  v_synthetic_proof_id uuid;
  v_available bigint;
  v_reserved bigint;
  v_delivery_count bigint;
  v_ledger_amount integer;
  v_withdrawal_id uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_owner_id, 'inventory-owner@example.test'),
    (v_restricted_admin_id, 'inventory-restricted@example.test'),
    (v_partner_id, 'inventory-partner@example.test'),
    (v_no_campaign_partner_id, 'inventory-no-campaign@example.test'),
    (v_concurrent_partner_id, 'inventory-concurrent@example.test');

  INSERT INTO public.admin_users (id, email, role, status, is_primary_owner, permissions) VALUES
    (v_owner_id, 'inventory-owner@example.test', 'owner', 'active', true, '{}'::jsonb),
    (v_restricted_admin_id, 'inventory-restricted@example.test', 'custom_admin', 'active', false,
      '{"deliveryTeam":{"view":true,"edit":false}}'::jsonb);

  INSERT INTO public.partner_profiles (id, email, full_name, mobile_number, status) VALUES
    (v_partner_id, 'inventory-partner@example.test', 'Inventory Fixture', '+10000000001', 'active'),
    (v_no_campaign_partner_id, 'inventory-no-campaign@example.test', 'No Campaign Fixture', '+10000000002', 'active'),
    (v_concurrent_partner_id, 'inventory-concurrent@example.test', 'Concurrent Fixture', '+10000000003', 'active');

  INSERT INTO public.partner_campaigns (
    name, description, area, start_date, end_date, daily_target, coins_per_proof
  ) VALUES (
    'Inventory regression fixture', '', 'Fixture area', current_date, current_date + 7, 100, 37
  ) RETURNING id INTO v_campaign_id;
  INSERT INTO public.partner_campaign_assignments (
    campaign_id, partner_profile_id, daily_target
  ) VALUES (v_campaign_id, v_partner_id, 100)
  RETURNING id INTO v_assignment_id;
  INSERT INTO public.partner_campaign_assignments (
    campaign_id, partner_profile_id, daily_target
  ) VALUES (v_campaign_id, v_concurrent_partner_id, 100)
  RETURNING id INTO v_concurrent_assignment_id;
  INSERT INTO public.partner_campaign_sites (campaign_id, name, address)
  VALUES (v_campaign_id, 'Fixture shop', 'Fixture address')
  RETURNING id INTO v_site_id;

  IF has_function_privilege(
    'anon',
    'public.admin_manage_partner_stock(uuid,uuid,uuid,text,integer,text,uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.admin_manage_partner_stock(uuid,uuid,uuid,text,integer,text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Stock RPC execute grants are not restricted to the service role';
  END IF;

  PERFORM public.admin_manage_partner_stock(
    v_owner_id, v_partner_id, NULL, 'issued', 10, 'Synthetic initial handover',
    'a1000000-0000-4000-8000-000000000101'
  );
  SELECT (public.get_partner_inventory_summary(v_partner_id) ->> 'available')::bigint
  INTO v_available;
  IF v_available <> 10 THEN RAISE EXCEPTION 'Partner-wide stock issue failed: %', v_available; END IF;

  BEGIN
    PERFORM public.admin_manage_partner_stock(
      v_owner_id, v_partner_id, NULL, 'issued', 101, 'Over-limit issue',
      'a1000000-0000-4000-8000-000000000102'
    );
    RAISE EXCEPTION 'TEST_SENTINEL: oversized issue unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEST_SENTINEL: oversized issue unexpectedly succeeded' OR
       position('cannot exceed 100 WildCards' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_manage_partner_stock(
      v_owner_id, v_partner_id, NULL, 'restocked', 101, 'Over-limit restock',
      'a1000000-0000-4000-8000-000000000103'
    );
    RAISE EXCEPTION 'TEST_SENTINEL: oversized restock unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEST_SENTINEL: oversized restock unexpectedly succeeded' OR
       position('cannot exceed 100 WildCards' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  PERFORM public.admin_manage_partner_stock(
    v_owner_id, v_partner_id, NULL, 'adjusted', 2, 'Authorized stock increase',
    'a1000000-0000-4000-8000-000000000104'
  );
  PERFORM public.admin_manage_partner_stock(
    v_owner_id, v_partner_id, NULL, 'adjusted', -2, 'Authorized stock decrease',
    'a1000000-0000-4000-8000-000000000105'
  );
  BEGIN
    PERFORM public.admin_manage_partner_stock(
      v_owner_id, v_partner_id, NULL, 'adjusted', -11, 'Excess stock decrease',
      'a1000000-0000-4000-8000-000000000106'
    );
    RAISE EXCEPTION 'TEST_SENTINEL: negative stock unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEST_SENTINEL: negative stock unexpectedly succeeded' OR
       position('unreserved partner stock negative' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_manage_partner_stock(
      v_restricted_admin_id, v_partner_id, NULL, 'issued', 1, 'Unauthorized stock issue',
      'a1000000-0000-4000-8000-000000000107'
    );
    RAISE EXCEPTION 'TEST_SENTINEL: unauthorized stock issue unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEST_SENTINEL: unauthorized stock issue unexpectedly succeeded' OR
       position('not authorized' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.request_partner_restock(v_partner_id, 101, '');
    RAISE EXCEPTION 'TEST_SENTINEL: oversized partner restock request unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEST_SENTINEL: oversized partner restock request unexpectedly succeeded' OR
       position('between 1 and 100' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  v_request_id := public.request_partner_restock(v_partner_id, 100, 'Synthetic low-stock request');
  SELECT (public.get_partner_inventory_summary(v_partner_id) ->> 'available')::bigint
  INTO v_available;
  IF v_available <> 10 THEN RAISE EXCEPTION 'Approval request must not issue stock before handover'; END IF;

  BEGIN
    PERFORM public.request_partner_restock(v_partner_id, 10, '');
    RAISE EXCEPTION 'TEST_SENTINEL: duplicate pending restock unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEST_SENTINEL: duplicate pending restock unexpectedly succeeded' OR
       position('already pending' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.admin_review_partner_campaign_request(
      v_owner_id, v_request_id, 'approved', 'Approve requested quantity', 99
    );
    RAISE EXCEPTION 'TEST_SENTINEL: mismatched restock approval unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEST_SENTINEL: mismatched restock approval unexpectedly succeeded' OR
       position('must match the request' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  PERFORM public.admin_review_partner_campaign_request(
    v_owner_id, v_request_id, 'approved', 'Approve requested quantity', 100
  );
  SELECT (public.get_partner_inventory_summary(v_partner_id) ->> 'available')::bigint
  INTO v_available;
  IF v_available <> 10 OR
     (SELECT status FROM public.partner_campaign_requests WHERE id = v_request_id) <> 'approved' THEN
    RAISE EXCEPTION 'Restock approval must not issue stock before physical handover';
  END IF;
  PERFORM public.admin_handover_partner_restock(v_owner_id, v_request_id, 'Fixture handover confirmed');
  PERFORM public.admin_handover_partner_restock(v_owner_id, v_request_id, 'Fixture duplicate handover');
  SELECT (public.get_partner_inventory_summary(v_partner_id) ->> 'available')::bigint
  INTO v_available;
  IF v_available <> 110 OR
     (SELECT count(*) FROM public.partner_stock_movements WHERE campaign_request_id = v_request_id) <> 1 OR
     (SELECT status FROM public.partner_campaign_requests WHERE id = v_request_id) <> 'fulfilled' THEN
    RAISE EXCEPTION 'Restock handover was not idempotent or did not record stock once';
  END IF;

  PERFORM public.admin_manage_partner_stock(
    v_owner_id, v_partner_id, NULL, 'adjusted', -105, 'Drain fixture stock',
    'a1000000-0000-4000-8000-000000000108'
  );
  v_request_id := public.request_partner_restock(v_partner_id, 8, '');
  PERFORM public.admin_review_partner_campaign_request(
    v_owner_id, v_request_id, 'rejected', 'Fixture request rejected', 0
  );
  SELECT (public.get_partner_inventory_summary(v_partner_id) ->> 'available')::bigint
  INTO v_available;
  IF v_available <> 5 OR
     (SELECT status FROM public.partner_campaign_requests WHERE id = v_request_id) <> 'rejected' THEN
    RAISE EXCEPTION 'Rejected restock changed stock or did not retain its status';
  END IF;

  PERFORM public.admin_manage_partner_stock(
    v_owner_id, v_partner_id, v_assignment_id, 'issued', 5, 'Campaign proof-test stock',
    'a1000000-0000-4000-8000-000000000109'
  );
  v_proof_id := public.submit_partner_proof(
    v_partner_id, v_assignment_id, v_site_id, v_partner_id::text || '/proof.webp',
    'Synthetic proof fixture', NULL, NULL
  );
  SELECT
    (summary ->> 'available')::bigint,
    (summary ->> 'reserved')::bigint
  INTO v_available, v_reserved
  FROM (SELECT public.get_partner_inventory_summary(v_partner_id) AS summary) inventory;
  IF v_available <> 9 OR v_reserved <> 1 OR
     (SELECT amount FROM public.partner_coin_ledger WHERE partner_coin_ledger.proof_id = v_proof_id AND entry_type = 'earning') <> 1000 OR
     (SELECT status FROM public.partner_coin_ledger WHERE partner_coin_ledger.proof_id = v_proof_id AND entry_type = 'earning') <> 'pending' THEN
    RAISE EXCEPTION 'Proof submission did not reserve one card with a pending 1,000-coin reward';
  END IF;

  BEGIN
    PERFORM public.admin_manage_partner_stock(
      v_owner_id, v_partner_id, NULL, 'adjusted', -10, 'Attempt to consume reserved card',
      'a1000000-0000-4000-8000-000000000110'
    );
    RAISE EXCEPTION 'TEST_SENTINEL: reserved stock decrease unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEST_SENTINEL: reserved stock decrease unexpectedly succeeded' OR
       position('unreserved partner stock negative' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  PERFORM public.review_partner_proof(v_proof_id, v_owner_id, 'approved', 'Fixture proof approved');
  PERFORM public.review_partner_proof(v_proof_id, v_owner_id, 'approved', 'Fixture duplicate approval');
  SELECT
    (summary ->> 'available')::bigint,
    (summary ->> 'reserved')::bigint,
    (summary ->> 'delivered')::bigint
  INTO v_available, v_reserved, v_delivery_count
  FROM (SELECT public.get_partner_inventory_summary(v_partner_id) AS summary) inventory;
  SELECT amount INTO v_ledger_amount FROM public.partner_coin_ledger
  WHERE public.partner_coin_ledger.proof_id = v_proof_id AND entry_type = 'earning' AND status = 'approved';
  IF v_available <> 9 OR v_reserved <> 0 OR v_delivery_count <> 1 OR v_ledger_amount <> 1000 OR
     (SELECT count(*) FROM public.partner_stock_movements WHERE partner_stock_movements.proof_id = v_proof_id) <> 1 THEN
    RAISE EXCEPTION 'Proof approval was not atomic, exactly 1,000 coins, or idempotent';
  END IF;

  v_proof_id := public.submit_partner_proof(
    v_partner_id, v_assignment_id, v_site_id, v_partner_id::text || '/rejected-proof.webp',
    'Synthetic rejected proof fixture', NULL, NULL
  );
  PERFORM public.review_partner_proof(v_proof_id, v_owner_id, 'rejected', 'Fixture proof rejected');
  SELECT
    (summary ->> 'available')::bigint,
    (summary ->> 'reserved')::bigint
  INTO v_available, v_reserved
  FROM (SELECT public.get_partner_inventory_summary(v_partner_id) AS summary) inventory;
  IF v_available <> 9 OR v_reserved <> 0 OR
     EXISTS (SELECT 1 FROM public.partner_coin_ledger
       WHERE public.partner_coin_ledger.proof_id = v_proof_id AND entry_type = 'earning' AND status = 'approved') OR
     (SELECT status FROM public.partner_coin_ledger
       WHERE public.partner_coin_ledger.proof_id = v_proof_id AND entry_type = 'earning') <> 'rejected' THEN
    RAISE EXCEPTION 'Rejected proof did not release its card without a reward';
  END IF;

  PERFORM public.admin_manage_partner_stock(
    v_owner_id, v_partner_id, NULL, 'adjusted', -9, 'Drain proof-test stock',
    'a1000000-0000-4000-8000-000000000111'
  );
  BEGIN
    PERFORM public.submit_partner_proof(
      v_partner_id, v_assignment_id, v_site_id, v_partner_id::text || '/no-stock.webp',
      'Synthetic no-stock proof fixture', NULL, NULL
    );
    RAISE EXCEPTION 'TEST_SENTINEL: proof submission without stock unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEST_SENTINEL: proof submission without stock unexpectedly succeeded' OR
       position('No unreserved WildCard stock is available' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  INSERT INTO public.partner_proofs (
    assignment_id, campaign_id, site_id, partner_profile_id, photo_path, coins,
    status, reviewed_at, reviewed_by
  ) VALUES (
    v_assignment_id, v_campaign_id, v_site_id, v_partner_id,
    v_partner_id::text || '/withdrawal-earnings-fixture.webp', 100000,
    'approved', now(), v_owner_id
  ) RETURNING id INTO v_synthetic_proof_id;
  INSERT INTO public.partner_coin_ledger (
    partner_profile_id, campaign_id, proof_id, entry_type, amount, status
  ) VALUES (v_partner_id, v_campaign_id, v_synthetic_proof_id, 'earning', 100000, 'approved');

  BEGIN
    PERFORM public.request_partner_withdrawal(v_partner_id, 99999);
    RAISE EXCEPTION 'TEST_SENTINEL: below-minimum withdrawal unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEST_SENTINEL: below-minimum withdrawal unexpectedly succeeded' OR
       position('minimum withdrawal is 100000' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
  v_withdrawal_id := public.request_partner_withdrawal(v_partner_id, 100000);
  IF (SELECT amount FROM public.partner_withdrawal_requests WHERE id = v_withdrawal_id) <> 100000 THEN
    RAISE EXCEPTION 'The 100,000 NGA Coin withdrawal threshold was not preserved';
  END IF;

  PERFORM public.admin_manage_partner_stock(
    v_owner_id, v_concurrent_partner_id, NULL, 'issued', 10, 'Concurrent test seed stock',
    'a1000000-0000-4000-8000-000000000112'
  );
  PERFORM public.admin_manage_partner_stock(
    v_owner_id, v_concurrent_partner_id, v_concurrent_assignment_id, 'issued', 1,
    'Concurrent proof seed stock', 'a1000000-0000-4000-8000-000000000113'
  );
  v_proof_id := public.submit_partner_proof(
    v_concurrent_partner_id, v_concurrent_assignment_id, v_site_id,
    v_concurrent_partner_id::text || '/concurrent-proof.webp',
    'Concurrent approval fixture', NULL, NULL
  );

  RAISE NOTICE 'wildcard_inventory_transactional_tests: PASS';
END;
$tests$;

COMMIT;
