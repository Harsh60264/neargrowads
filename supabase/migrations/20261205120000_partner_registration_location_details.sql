alter table public.partner_profiles
  add column registration_location_address text,
  add column registration_location_latitude double precision,
  add column registration_location_longitude double precision,
  add column registration_location_accuracy_meters double precision,
  add column registration_location_captured_at timestamptz,
  add column registration_location_address_source text,
  add column registration_location_components jsonb,
  add column current_location_address text,
  add column current_location_latitude double precision,
  add column current_location_longitude double precision,
  add column current_location_accuracy_meters double precision,
  add column current_location_captured_at timestamptz,
  add column current_location_address_source text,
  add column current_location_components jsonb,
  add constraint partner_profiles_registration_location_check check (
    (
      registration_location_address is null
      and registration_location_latitude is null
      and registration_location_longitude is null
      and registration_location_accuracy_meters is null
      and registration_location_captured_at is null
      and registration_location_address_source is null
      and registration_location_components is null
    ) or (
      registration_location_address is not null
      and registration_location_address = btrim(registration_location_address)
      and char_length(registration_location_address) between 3 and 500
      and registration_location_address_source is not null
      and registration_location_address_source in ('gps_reverse_geocoded', 'gps_manual', 'manual_no_gps')
      and (
        (
          registration_location_latitude is null
          and registration_location_longitude is null
          and registration_location_accuracy_meters is null
          and registration_location_captured_at is null
          and registration_location_address_source = 'manual_no_gps'
          and registration_location_components is null
        ) or (
          registration_location_latitude is not null
          and registration_location_longitude is not null
          and registration_location_accuracy_meters is not null
          and registration_location_captured_at is not null
          and registration_location_latitude between -90 and 90
          and registration_location_longitude between -180 and 180
          and registration_location_accuracy_meters > 0
          and registration_location_accuracy_meters <= 50000
          and (
            (registration_location_address_source = 'gps_reverse_geocoded'
              and registration_location_components is not null
              and jsonb_typeof(registration_location_components) = 'object')
            or (registration_location_address_source = 'gps_manual'
              and registration_location_components is null)
          )
        )
      )
    )
  ),
  add constraint partner_profiles_current_location_check check (
    (
      current_location_address is null
      and current_location_latitude is null
      and current_location_longitude is null
      and current_location_accuracy_meters is null
      and current_location_captured_at is null
      and current_location_address_source is null
      and current_location_components is null
    ) or (
      current_location_address is not null
      and current_location_address = btrim(current_location_address)
      and char_length(current_location_address) between 3 and 500
      and current_location_address_source is not null
      and current_location_address_source in ('gps_reverse_geocoded', 'gps_manual', 'manual_no_gps')
      and (
        (
          current_location_latitude is null
          and current_location_longitude is null
          and current_location_accuracy_meters is null
          and current_location_captured_at is null
          and current_location_address_source = 'manual_no_gps'
          and current_location_components is null
        ) or (
          current_location_latitude is not null
          and current_location_longitude is not null
          and current_location_accuracy_meters is not null
          and current_location_captured_at is not null
          and current_location_latitude between -90 and 90
          and current_location_longitude between -180 and 180
          and current_location_accuracy_meters > 0
          and current_location_accuracy_meters <= 50000
          and (
            (current_location_address_source = 'gps_reverse_geocoded'
              and current_location_components is not null
              and jsonb_typeof(current_location_components) = 'object')
            or (current_location_address_source = 'gps_manual'
              and current_location_components is null)
          )
        )
      )
    )
  );

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
    select p.*, u.email as authenticated_email
    from public.partner_profiles p
    join auth.users u on u.id = p.id
    where (p_status = 'all' or p.status = p_status)
      and (p_state = 'all' or
        (p_state = 'unselected' and p.state is null) or p.state = p_state)
      and (
        coalesce(p_search, '') = '' or
        p.full_name ilike '%' || p_search || '%' or
        coalesce(u.email, '') ilike '%' || p_search || '%' or
        p.mobile_number ilike '%' || p_search || '%' or
        p.id::text ilike '%' || p_search || '%' or
        coalesce(p.state, '') ilike '%' || p_search || '%' or
        exists (
          select 1
          from unnest(p.preferred_delivery_areas) as preferred_area(area)
          where preferred_area.area ilike '%' || p_search || '%'
        )
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
      select jsonb_agg(
        (to_jsonb(r) - 'full_count' - 'authenticated_email' - 'email')
          || jsonb_build_object('email', r.authenticated_email)
        order by r.created_at desc, r.id
      )
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
