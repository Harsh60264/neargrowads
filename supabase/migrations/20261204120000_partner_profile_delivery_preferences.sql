alter table public.partner_profiles
  add column state text,
  add column preferred_delivery_areas text[] not null default '{}'::text[];

alter table public.partner_profiles
  add constraint partner_profiles_state_india_check
    check (state is null or state in (
      'Andaman and Nicobar Islands',
      'Andhra Pradesh',
      'Arunachal Pradesh',
      'Assam',
      'Bihar',
      'Chandigarh',
      'Chhattisgarh',
      'Dadra and Nagar Haveli and Daman and Diu',
      'Goa',
      'Gujarat',
      'Haryana',
      'Himachal Pradesh',
      'Jammu and Kashmir',
      'Jharkhand',
      'Karnataka',
      'Kerala',
      'Ladakh',
      'Lakshadweep',
      'Madhya Pradesh',
      'Maharashtra',
      'Manipur',
      'Meghalaya',
      'Mizoram',
      'Nagaland',
      'National Capital Territory of Delhi',
      'Odisha',
      'Puducherry',
      'Punjab',
      'Rajasthan',
      'Sikkim',
      'Tamil Nadu',
      'Telangana',
      'Tripura',
      'Uttar Pradesh',
      'Uttarakhand',
      'West Bengal'
    )),
  add constraint partner_profiles_preferred_delivery_areas_check
    check (
      cardinality(preferred_delivery_areas) <= 2000
      and array_position(preferred_delivery_areas, null) is null
      and array_position(preferred_delivery_areas, '') is null
    );

create or replace function public.submit_independent_partner_proof(
  p_partner_profile_id uuid,
  p_photo_path text,
  p_business_name text,
  p_business_category text,
  p_delivery_address text,
  p_address_detail text,
  p_note text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision,
  p_captured_at timestamptz,
  p_address_source text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  proof_id uuid;
  current_balance bigint;
  reserved_count bigint;
begin
  perform 1 from public.partner_profiles
  where id = p_partner_profile_id and status = 'active' for update;
  if not found then raise exception 'Active partner profile not found'; end if;

  if p_photo_path is null or p_photo_path not like p_partner_profile_id::text || '/%' then
    raise exception 'The proof photo is not owned by this partner';
  end if;
  if char_length(coalesce(p_business_name, '')) > 120 or
    (p_business_name is not null and p_business_name <> btrim(p_business_name)) then
    raise exception 'The optional business name is invalid';
  end if;
  if char_length(coalesce(p_business_category, '')) > 80 or
    (p_business_category is not null and p_business_category <> btrim(p_business_category)) then
    raise exception 'The optional business category is invalid';
  end if;
  if p_delivery_address is null or p_delivery_address <> btrim(p_delivery_address) or
    char_length(p_delivery_address) not between 3 and 500 or
    char_length(coalesce(p_address_detail, '')) > 240 or
    (p_address_detail is not null and p_address_detail <> btrim(p_address_detail)) then
    raise exception 'Enter a valid delivery address';
  end if;
  if char_length(coalesce(p_note, '')) > 200 then raise exception 'The proof note is too long'; end if;
  if (p_latitude is null) <> (p_longitude is null) or
    (p_latitude is not null and
      (p_latitude not between -90 and 90 or p_longitude not between -180 and 180)) then
    raise exception 'The captured location is invalid';
  end if;
  if p_latitude is null then
    if p_accuracy_meters is not null or p_captured_at is not null or
      p_address_source is distinct from 'manual_no_gps' then
      raise exception 'Manual address submissions cannot include fabricated GPS evidence';
    end if;
  elsif p_accuracy_meters is null or p_accuracy_meters <= 0 or p_accuracy_meters > 50000 or
    p_captured_at is null or p_captured_at < now() - interval '30 minutes' or
    p_captured_at > now() + interval '1 minute' or
    p_address_source is null or p_address_source not in ('gps_reverse_geocoded', 'gps_manual') then
    raise exception 'The GPS evidence is invalid or too old';
  end if;

  select coalesce(sum(quantity), 0) into current_balance
  from public.partner_stock_movements where partner_profile_id = p_partner_profile_id;
  select count(*) into reserved_count
  from public.partner_proofs where partner_profile_id = p_partner_profile_id and status = 'pending';
  if current_balance - reserved_count < 1 then
    raise exception 'No unreserved WildCard stock is available';
  end if;

  insert into public.partner_proofs (
    assignment_id, campaign_id, site_id, partner_profile_id, photo_path, note,
    latitude, longitude, coins, business_name, business_category, delivery_address,
    address_detail, location_accuracy_meters, location_captured_at, location_address_source
  ) values (
    null, null, null, p_partner_profile_id, p_photo_path, coalesce(p_note, ''),
    p_latitude, p_longitude, 1000, coalesce(p_business_name, ''),
    coalesce(p_business_category, ''), p_delivery_address, coalesce(p_address_detail, ''),
    p_accuracy_meters, p_captured_at, p_address_source
  ) returning id into proof_id;

  insert into public.partner_coin_ledger (
    partner_profile_id, campaign_id, proof_id, entry_type, amount, status, reference, notes
  ) values (
    p_partner_profile_id, null, proof_id, 'earning', 1000, 'pending',
    coalesce(nullif(p_business_name, ''), 'Independent delivery'),
    'Independent WildCard delivery proof submitted; one card reserved pending review'
  );
  return proof_id;
end;
$$;

revoke all on function public.submit_independent_partner_proof(
  uuid, text, text, text, text, text, text, double precision, double precision,
  double precision, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.submit_independent_partner_proof(
  uuid, text, text, text, text, text, text, double precision, double precision,
  double precision, timestamptz, text
) to service_role;

create or replace function public.get_delivery_team_partners_by_state(
  p_admin_id uuid,
  p_state text,
  p_search text,
  p_status text,
  p_page integer,
  p_page_size integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
begin
  perform public.assert_delivery_team_admin(p_admin_id, 'view');
  if p_state is null or p_status is null or p_page is null or p_page_size is null or
    p_state not in (
      'all', 'unselected',
      'Andaman and Nicobar Islands',
      'Andhra Pradesh',
      'Arunachal Pradesh',
      'Assam',
      'Bihar',
      'Chandigarh',
      'Chhattisgarh',
      'Dadra and Nagar Haveli and Daman and Diu',
      'Goa',
      'Gujarat',
      'Haryana',
      'Himachal Pradesh',
      'Jammu and Kashmir',
      'Jharkhand',
      'Karnataka',
      'Kerala',
      'Ladakh',
      'Lakshadweep',
      'Madhya Pradesh',
      'Maharashtra',
      'Manipur',
      'Meghalaya',
      'Mizoram',
      'Nagaland',
      'National Capital Territory of Delhi',
      'Odisha',
      'Puducherry',
      'Punjab',
      'Rajasthan',
      'Sikkim',
      'Tamil Nadu',
      'Telangana',
      'Tripura',
      'Uttar Pradesh',
      'Uttarakhand',
      'West Bengal'
    ) or p_status not in ('all', 'active', 'pending', 'disabled') or
    p_page < 1 or p_page > 100000 or p_page_size < 1 or p_page_size > 100 then
    raise exception 'Invalid Delivery Team partner filters';
  end if;

  with filtered as (
    select p.*
    from public.partner_profiles p
    where (p_status = 'all' or p.status = p_status)
      and (p_state = 'all' or
        (p_state = 'unselected' and p.state is null) or p.state = p_state)
      and (
        coalesce(p_search, '') = '' or
        p.full_name ilike '%' || p_search || '%' or
        p.email ilike '%' || p_search || '%' or
        p.mobile_number ilike '%' || p_search || '%' or
        p.id::text ilike '%' || p_search || '%' or
        coalesce(p.state, '') ilike '%' || p_search || '%'
      )
  ),
  page_rows as (
    select p.*,
      count(*) over () as full_count,
      public.delivery_team_available_coins(p.id) as available_coins,
      coalesce((
        select sum(m.quantity) from public.partner_stock_movements m
        where m.partner_profile_id = p.id
      ), 0) as remaining_stock,
      (
        select count(*) from public.partner_campaign_requests r
        where r.partner_profile_id = p.id and r.status = 'pending'
      ) + (
        select count(*) from public.partner_damage_reports d
        where d.partner_profile_id = p.id and d.status = 'pending'
      ) + (
        select count(*) from public.partner_withdrawal_requests w
        where w.partner_profile_id = p.id and w.status = 'requested'
      ) as pending_requests,
      ca.id as assignment_id,
      c.id as campaign_id,
      c.name as campaign_name,
      c.area as campaign_area,
      c.status as campaign_status,
      greatest(
        p.last_login_at,
        (select max(pr.submitted_at) from public.partner_proofs pr where pr.partner_profile_id = p.id),
        (select max(sm.created_at) from public.partner_stock_movements sm where sm.partner_profile_id = p.id),
        (select max(cl.created_at) from public.partner_coin_ledger cl where cl.partner_profile_id = p.id),
        (select max(cr.created_at) from public.partner_campaign_requests cr where cr.partner_profile_id = p.id),
        (select max(dr.created_at) from public.partner_damage_reports dr where dr.partner_profile_id = p.id),
        (select max(wr.created_at) from public.partner_withdrawal_requests wr where wr.partner_profile_id = p.id)
      ) as last_activity
    from filtered p
    left join lateral (
      select a.id, a.campaign_id
      from public.partner_campaign_assignments a
      where a.partner_profile_id = p.id and a.active = true
      order by a.created_at desc
      limit 1
    ) ca on true
    left join public.partner_campaigns c on c.id = ca.campaign_id
    order by p.created_at desc, p.id
    limit p_page_size offset (p_page - 1) * p_page_size
  )
  select jsonb_build_object(
    'total', coalesce((select max(full_count) from page_rows), (
      select count(*) from filtered
    )),
    'partners', coalesce((
      select jsonb_agg(to_jsonb(r) - 'full_count' order by r.created_at desc, r.id)
      from page_rows r
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_delivery_team_partners_by_state(
  uuid, text, text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.get_delivery_team_partners_by_state(
  uuid, text, text, text, integer, integer
) to service_role;
