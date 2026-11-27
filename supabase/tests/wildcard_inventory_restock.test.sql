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
  v_independent_rejected_proof uuid;
  v_independent_approved_proof uuid;
  v_independent_damage_report uuid;
  v_first_geocode_slot timestamptz;
  v_second_geocode_slot timestamptz;
  v_available bigint;
  v_reserved bigint;
  v_delivery_count bigint;
  v_ledger_amount integer;
  v_withdrawal_id uuid;
  v_partner_list jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.partner_proofs
    WHERE partner_profile_id = 'a2000000-0000-4000-8000-000000000012'
      AND photo_path = 'a2000000-0000-4000-8000-000000000012/legacy-coordinate-proof.webp'
      AND latitude = 28.6139
      AND longitude = 77.2090
      AND location_accuracy_meters IS NULL
      AND location_captured_at IS NULL
      AND location_address_source = 'campaign_legacy'
  ) THEN
    RAISE EXCEPTION 'Existing campaign proof with legacy GPS coordinates was not preserved by independent-delivery migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.partner_profiles
    WHERE id = 'a2000000-0000-4000-8000-000000000012'
      AND state IS NULL
      AND preferred_delivery_areas = '{}'::text[]
  ) THEN
    RAISE EXCEPTION 'An existing partner without state details was not preserved with optional location preferences';
  END IF;
  IF has_table_privilege('anon', 'public.partner_profiles', 'SELECT') OR
     has_table_privilege('authenticated', 'public.partner_profiles', 'SELECT') OR
     has_table_privilege('anon', 'public.partner_profiles', 'UPDATE') OR
     has_table_privilege('authenticated', 'public.partner_profiles', 'UPDATE') THEN
    RAISE EXCEPTION 'Partner location profile fields are directly accessible to unauthenticated or authenticated database roles';
  END IF;

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
  UPDATE public.partner_profiles
  SET state = 'Punjab', preferred_delivery_areas = ARRAY['Tilak Nagar', 'Janakpuri']
  WHERE id = v_partner_id;

  BEGIN
    UPDATE public.partner_profiles SET state = 'California' WHERE id = v_partner_id;
    RAISE EXCEPTION 'TEST_SENTINEL: non-Indian state unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  IF has_function_privilege(
    'anon',
    'public.get_delivery_team_partners_by_state(uuid,text,text,text,integer,integer)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.get_delivery_team_partners_by_state(uuid,text,text,text,integer,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'State-filtered partner listing is not restricted to the service role';
  END IF;
  v_partner_list := public.get_delivery_team_partners_by_state(
    v_owner_id, 'Punjab', '', 'all', 1, 20
  );
  IF jsonb_array_length(v_partner_list -> 'partners') <> 1 OR
     NOT (v_partner_list -> 'partners' @> jsonb_build_array(jsonb_build_object(
       'id', v_partner_id::text,
       'state', 'Punjab',
       'preferred_delivery_areas', jsonb_build_array('Tilak Nagar', 'Janakpuri')
     ))) THEN
    RAISE EXCEPTION 'Owner state filter or partner location preferences were not returned correctly';
  END IF;
  v_partner_list := public.get_delivery_team_partners_by_state(
    v_owner_id, 'unselected', '', 'all', 1, 20
  );
  IF NOT (v_partner_list -> 'partners' @> jsonb_build_array(jsonb_build_object(
    'id', 'a2000000-0000-4000-8000-000000000012',
    'state', NULL,
    'preferred_delivery_areas', '[]'::jsonb
  ))) THEN
    RAISE EXCEPTION 'Admin could not filter legacy partners whose state is not set';
  END IF;
  BEGIN
    PERFORM public.get_delivery_team_partners_by_state(
      v_owner_id, 'California', '', 'all', 1, 20
    );
    RAISE EXCEPTION 'TEST_SENTINEL: non-Indian state filter unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEST_SENTINEL: non-Indian state filter unexpectedly succeeded' OR
       position('Invalid Delivery Team partner filters' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

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

  IF has_function_privilege(
    'authenticated',
    'public.submit_independent_partner_proof(uuid,text,text,text,text,text,text,double precision,double precision,double precision,timestamptz,text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.submit_independent_partner_proof(uuid,text,text,text,text,text,text,double precision,double precision,double precision,timestamptz,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.reserve_partner_reverse_geocode_slot()',
    'EXECUTE'
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Independent proof or reverse-geocode RPC grants are not correctly restricted';
  END IF;
  IF has_table_privilege('service_role', 'public.partner_reverse_geocode_rate_limit', 'SELECT') THEN
    RAISE EXCEPTION 'The reverse-geocode scheduling table must not be directly readable by the service role';
  END IF;

  PERFORM public.admin_manage_partner_stock(
    v_owner_id, v_no_campaign_partner_id, NULL, 'issued', 2, 'Independent delivery seed stock',
    'a1000000-0000-4000-8000-000000000114'
  );
  IF EXISTS (
    SELECT 1 FROM public.partner_campaign_assignments
    WHERE partner_profile_id = v_no_campaign_partner_id
  ) THEN
    RAISE EXCEPTION 'Independent delivery test partner unexpectedly has a campaign assignment';
  END IF;
  v_independent_rejected_proof := public.submit_independent_partner_proof(
    v_no_campaign_partner_id, v_no_campaign_partner_id::text || '/manual-no-gps.webp',
    '', '', 'Market Street, Noida', '', 'Manual address fallback',
    NULL, NULL, NULL, NULL, 'manual_no_gps'
  );
  SELECT
    (summary ->> 'available')::bigint,
    (summary ->> 'reserved')::bigint
  INTO v_available, v_reserved
  FROM (SELECT public.get_partner_inventory_summary(v_no_campaign_partner_id) AS summary) inventory;
  IF v_available <> 1 OR v_reserved <> 1 OR
     (SELECT assignment_id FROM public.partner_proofs WHERE id = v_independent_rejected_proof) IS NOT NULL OR
     (SELECT campaign_id FROM public.partner_proofs WHERE id = v_independent_rejected_proof) IS NOT NULL OR
     (SELECT site_id FROM public.partner_proofs WHERE id = v_independent_rejected_proof) IS NOT NULL OR
     (SELECT business_name FROM public.partner_proofs WHERE id = v_independent_rejected_proof) <> '' OR
     (SELECT business_category FROM public.partner_proofs WHERE id = v_independent_rejected_proof) <> '' OR
     (SELECT address_detail FROM public.partner_proofs WHERE id = v_independent_rejected_proof) <> '' OR
     (SELECT status FROM public.partner_coin_ledger WHERE proof_id = v_independent_rejected_proof) <> 'pending' OR
     (SELECT amount FROM public.partner_coin_ledger WHERE proof_id = v_independent_rejected_proof) <> 1000 THEN
    RAISE EXCEPTION 'Campaign-free manual proof did not reserve one physical card with exactly 1,000 pending coins';
  END IF;

  BEGIN
    PERFORM public.submit_independent_partner_proof(
      v_no_campaign_partner_id, v_no_campaign_partner_id::text || '/invalid-gps.webp',
      'Independent Shop', '', 'Market Street, Noida', '', '', 28.5, 77.3,
      50001, now(), 'gps_manual'
    );
    RAISE EXCEPTION 'TEST_SENTINEL: inaccurate GPS evidence unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEST_SENTINEL: inaccurate GPS evidence unexpectedly succeeded' OR
       position('GPS evidence is invalid or too old' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  PERFORM public.review_partner_proof(
    v_independent_rejected_proof, v_owner_id, 'rejected', 'Independent fixture rejected'
  );
  SELECT
    (summary ->> 'available')::bigint,
    (summary ->> 'reserved')::bigint
  INTO v_available, v_reserved
  FROM (SELECT public.get_partner_inventory_summary(v_no_campaign_partner_id) AS summary) inventory;
  IF v_available <> 2 OR v_reserved <> 0 OR
     (SELECT status FROM public.partner_coin_ledger WHERE proof_id = v_independent_rejected_proof) <> 'rejected' THEN
    RAISE EXCEPTION 'Rejected independent proof failed to release its card without coin credit';
  END IF;

  v_independent_approved_proof := public.submit_independent_partner_proof(
    v_no_campaign_partner_id, v_no_campaign_partner_id::text || '/gps-proof.webp',
    'Independent Shop', 'Retail', '12 Main Road, Sector 5, Noida, Uttar Pradesh, 201301, India',
    'Near the community center', 'GPS delivery fixture', 28.5, 77.3, 12.5, now(),
    'gps_reverse_geocoded'
  );
  IF (SELECT business_name FROM public.partner_proofs WHERE id = v_independent_approved_proof) <> 'Independent Shop' OR
     (SELECT delivery_address FROM public.partner_proofs WHERE id = v_independent_approved_proof) <>
       '12 Main Road, Sector 5, Noida, Uttar Pradesh, 201301, India' OR
     (SELECT address_detail FROM public.partner_proofs WHERE id = v_independent_approved_proof) <> 'Near the community center' OR
     (SELECT location_accuracy_meters FROM public.partner_proofs WHERE id = v_independent_approved_proof) <> 12.5 OR
     (SELECT location_captured_at FROM public.partner_proofs WHERE id = v_independent_approved_proof) IS NULL THEN
    RAISE EXCEPTION 'Independent business address or original GPS evidence was not persisted';
  END IF;
  PERFORM public.review_partner_proof(
    v_independent_approved_proof, v_owner_id, 'approved', 'Independent fixture approved'
  );
  PERFORM public.review_partner_proof(
    v_independent_approved_proof, v_owner_id, 'approved', 'Independent duplicate approval'
  );
  SELECT
    (summary ->> 'available')::bigint,
    (summary ->> 'reserved')::bigint,
    (summary ->> 'delivered')::bigint
  INTO v_available, v_reserved, v_delivery_count
  FROM (SELECT public.get_partner_inventory_summary(v_no_campaign_partner_id) AS summary) inventory;
  IF v_available <> 1 OR v_reserved <> 0 OR v_delivery_count <> 1 OR
     (SELECT amount FROM public.partner_coin_ledger WHERE proof_id = v_independent_approved_proof AND status = 'approved') <> 1000 OR
     (SELECT count(*) FROM public.partner_stock_movements WHERE proof_id = v_independent_approved_proof) <> 1 THEN
    RAISE EXCEPTION 'Independent proof approval failed to atomically consume one card and credit exactly 1,000 coins once';
  END IF;

  PERFORM public.admin_manage_partner_stock(
    v_owner_id, v_no_campaign_partner_id, NULL, 'adjusted', -1, 'Drain independent fixture stock',
    'a1000000-0000-4000-8000-000000000115'
  );
  BEGIN
    PERFORM public.submit_independent_partner_proof(
      v_no_campaign_partner_id, v_no_campaign_partner_id::text || '/no-stock-independent.webp',
      'Independent Shop', '', 'Market Street, Noida', '', '', NULL, NULL,
      NULL, NULL, 'manual_no_gps'
    );
    RAISE EXCEPTION 'TEST_SENTINEL: independent proof without stock unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEST_SENTINEL: independent proof without stock unexpectedly succeeded' OR
       position('No unreserved WildCard stock is available' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  PERFORM public.admin_manage_partner_stock(
    v_owner_id, v_no_campaign_partner_id, NULL, 'issued', 1, 'Damage fixture card',
    'a1000000-0000-4000-8000-000000000116'
  );
  INSERT INTO public.partner_damage_reports (
    assignment_id, partner_profile_id, card_id, issue_type, details
  ) VALUES (
    NULL, v_no_campaign_partner_id, 'DAMAGE-FIXTURE', 'damaged', 'Independent campaign-free report'
  ) RETURNING id INTO v_independent_damage_report;
  PERFORM public.review_partner_damage_report(
    v_independent_damage_report, v_owner_id, 'resolved'
  );
  IF (public.get_partner_inventory_summary(v_no_campaign_partner_id) ->> 'available')::bigint <> 0 OR
     (public.get_partner_inventory_summary(v_no_campaign_partner_id) ->> 'damaged')::bigint <> 1 THEN
    RAISE EXCEPTION 'Campaign-free damage review did not record the physical stock adjustment';
  END IF;

  v_first_geocode_slot := public.reserve_partner_reverse_geocode_slot();
  v_second_geocode_slot := public.reserve_partner_reverse_geocode_slot();
  IF v_second_geocode_slot - v_first_geocode_slot < interval '1100 milliseconds' THEN
    RAISE EXCEPTION 'Concurrent instances can reserve reverse-geocode requests faster than the provider limit';
  END IF;

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
