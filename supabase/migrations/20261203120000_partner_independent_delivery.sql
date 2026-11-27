alter table public.partner_proofs
  alter column assignment_id drop not null,
  alter column campaign_id drop not null,
  alter column site_id drop not null,
  add column business_name text not null default '',
  add column business_category text not null default '',
  add column delivery_address text not null default '',
  add column address_detail text not null default '',
  add column location_accuracy_meters double precision,
  add column location_captured_at timestamptz,
  add column location_address_source text not null default 'campaign_legacy';

alter table public.partner_proofs
  add constraint partner_proofs_business_name_check
    check (business_name = btrim(business_name) and char_length(business_name) <= 120),
  add constraint partner_proofs_business_category_check
    check (business_category = btrim(business_category) and char_length(business_category) <= 80),
  add constraint partner_proofs_delivery_address_check
    check (delivery_address = btrim(delivery_address) and char_length(delivery_address) <= 500),
  add constraint partner_proofs_address_detail_check
    check (address_detail = btrim(address_detail) and char_length(address_detail) <= 240),
  add constraint partner_proofs_location_accuracy_check
    check (location_accuracy_meters is null or
      (location_accuracy_meters > 0 and location_accuracy_meters <= 50000)),
  add constraint partner_proofs_location_source_check
    check (location_address_source in (
      'campaign_legacy', 'gps_reverse_geocoded', 'gps_manual', 'manual_no_gps'
    )),
  add constraint partner_proofs_gps_evidence_check
    check (
      (latitude is null and longitude is null and location_accuracy_meters is null and
        location_captured_at is null and location_address_source in ('campaign_legacy', 'manual_no_gps'))
      or
      (latitude is not null and longitude is not null and location_accuracy_meters is null and
        location_captured_at is null and location_address_source = 'campaign_legacy')
      or
      (latitude is not null and longitude is not null and location_accuracy_meters is not null and
        location_captured_at is not null and location_address_source in ('gps_reverse_geocoded', 'gps_manual'))
    );

alter table public.partner_damage_reports
  alter column assignment_id drop not null;

create or replace function public.enforce_partner_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_balance bigint;
  reserved_count bigint;
  assignment_partner_id uuid;
begin
  perform 1 from public.partner_profiles where id = new.partner_profile_id for update;
  if not found then raise exception 'Delivery partner not found'; end if;

  if new.assignment_id is not null then
    select partner_profile_id into assignment_partner_id
    from public.partner_campaign_assignments where id = new.assignment_id;
    if assignment_partner_id is distinct from new.partner_profile_id then
      raise exception 'Campaign assignment does not belong to this partner';
    end if;
  end if;

  if new.movement_type in ('issued', 'restocked') and new.quantity not between 1 and 100 then
    raise exception 'An issue or restock transaction must contain between 1 and 100 WildCards';
  end if;
  if new.movement_type = 'distributed' and
    (new.quantity <> -1 or new.proof_id is null or not exists (
      select 1 from public.partner_proofs
      where id = new.proof_id and partner_profile_id = new.partner_profile_id
        and assignment_id is not distinct from new.assignment_id and status = 'pending'
    )) then
    raise exception 'A delivery movement must consume one reserved pending proof';
  end if;
  if new.movement_type = 'damaged' and new.quantity >= 0 then
    raise exception 'A damage movement must remove physical stock';
  end if;

  select coalesce(sum(quantity), 0) into current_balance
  from public.partner_stock_movements where partner_profile_id = new.partner_profile_id;
  select count(*) into reserved_count
  from public.partner_proofs
  where partner_profile_id = new.partner_profile_id and status = 'pending';

  if new.quantity < 0 then
    if new.movement_type = 'distributed' then
      if current_balance < reserved_count then
        raise exception 'A reserved WildCard is not backed by physical stock';
      end if;
    elsif current_balance + new.quantity < reserved_count then
      raise exception 'This movement would consume stock reserved for pending proofs';
    end if;
  end if;
  return new;
end;
$$;

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
  if p_business_name is null or p_business_name <> btrim(p_business_name) or
    char_length(p_business_name) not between 2 and 120 then
    raise exception 'Enter a valid business name';
  end if;
  if char_length(coalesce(p_business_category, '')) > 80 or
    (p_business_category is not null and p_business_category <> btrim(p_business_category)) then
    raise exception 'The business category is invalid';
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
    p_latitude, p_longitude, 1000, p_business_name, coalesce(p_business_category, ''),
    p_delivery_address, coalesce(p_address_detail, ''), p_accuracy_meters, p_captured_at,
    p_address_source
  ) returning id into proof_id;

  insert into public.partner_coin_ledger (
    partner_profile_id, campaign_id, proof_id, entry_type, amount, status, reference, notes
  ) values (
    p_partner_profile_id, null, proof_id, 'earning', 1000, 'pending',
    p_business_name, 'Independent WildCard delivery proof submitted; one card reserved pending review'
  );
  return proof_id;
end;
$$;

create table public.partner_reverse_geocode_rate_limit (
  singleton boolean primary key default true check (singleton),
  next_request_at timestamptz not null default clock_timestamp()
);

insert into public.partner_reverse_geocode_rate_limit (singleton)
values (true);

alter table public.partner_reverse_geocode_rate_limit enable row level security;
revoke all on public.partner_reverse_geocode_rate_limit from public, anon, authenticated, service_role;

create or replace function public.reserve_partner_reverse_geocode_slot()
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  reserved_at timestamptz;
begin
  select greatest(clock_timestamp(), next_request_at)
    into reserved_at
    from public.partner_reverse_geocode_rate_limit
    where singleton = true
    for update;
  update public.partner_reverse_geocode_rate_limit
    set next_request_at = reserved_at + interval '1100 milliseconds'
    where singleton = true;
  return reserved_at;
end;
$$;

revoke all on function public.reserve_partner_reverse_geocode_slot() from public, anon, authenticated;
grant execute on function public.reserve_partner_reverse_geocode_slot() to service_role;

revoke all on function public.submit_independent_partner_proof(
  uuid, text, text, text, text, text, text, double precision, double precision,
  double precision, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.submit_independent_partner_proof(
  uuid, text, text, text, text, text, text, double precision, double precision,
  double precision, timestamptz, text
) to service_role;
