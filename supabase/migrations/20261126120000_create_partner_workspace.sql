create table public.partner_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = btrim(name) and char_length(name) between 2 and 120),
  description text not null default '',
  area text not null check (area = btrim(area) and char_length(area) between 2 and 160),
  start_date date not null,
  end_date date not null,
  daily_target integer not null check (daily_target between 1 and 1000),
  coins_per_proof integer not null check (coins_per_proof between 1 and 1000000),
  map_center_latitude double precision,
  map_center_longitude double precision,
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  check ((map_center_latitude is null and map_center_longitude is null) or
    (map_center_latitude between -90 and 90 and map_center_longitude between -180 and 180))
);

create table public.partner_campaign_assignments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.partner_campaigns(id) on delete cascade,
  partner_profile_id uuid not null references public.partner_profiles(id) on delete cascade,
  daily_target integer not null check (daily_target between 1 and 1000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (campaign_id, partner_profile_id)
);

create index partner_campaign_assignments_partner_active
  on public.partner_campaign_assignments (partner_profile_id, active, created_at desc);

create table public.partner_campaign_sites (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.partner_campaigns(id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 2 and 120),
  address text not null check (address = btrim(address) and char_length(address) between 2 and 240),
  created_at timestamptz not null default now()
);

create index partner_campaign_sites_campaign
  on public.partner_campaign_sites (campaign_id, name);

create table public.partner_campaign_requests (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.partner_campaign_assignments(id) on delete cascade,
  partner_profile_id uuid not null references public.partner_profiles(id) on delete cascade,
  request_type text not null check (request_type in ('additional_stock', 'update_locality', 'material_clarification')),
  details text not null check (char_length(details) between 3 and 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text not null default '',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.admin_users(id) on delete set null
);

create index partner_campaign_requests_partner
  on public.partner_campaign_requests (partner_profile_id, created_at desc);

create table public.partner_damage_reports (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.partner_campaign_assignments(id) on delete cascade,
  partner_profile_id uuid not null references public.partner_profiles(id) on delete cascade,
  card_id text not null default '' check (char_length(card_id) <= 80),
  issue_type text not null check (issue_type in ('damaged', 'lost', 'unusable', 'other')),
  details text not null default '' check (char_length(details) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'resolved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.admin_users(id) on delete set null
);

create index partner_damage_reports_partner
  on public.partner_damage_reports (partner_profile_id, created_at desc);

create table public.partner_proofs (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.partner_campaign_assignments(id) on delete restrict,
  campaign_id uuid not null references public.partner_campaigns(id) on delete restrict,
  site_id uuid not null references public.partner_campaign_sites(id) on delete restrict,
  partner_profile_id uuid not null references public.partner_profiles(id) on delete cascade,
  photo_path text not null check (photo_path <> '' and photo_path = btrim(photo_path)),
  note text not null default '' check (char_length(note) <= 200),
  latitude double precision,
  longitude double precision,
  coins integer not null check (coins between 1 and 1000000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'needs_correction', 'rejected')),
  review_note text not null default '',
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.admin_users(id) on delete set null,
  check ((latitude is null and longitude is null) or
    (latitude between -90 and 90 and longitude between -180 and 180))
);

create index partner_proofs_partner_recent
  on public.partner_proofs (partner_profile_id, submitted_at desc);
create index partner_proofs_review_queue
  on public.partner_proofs (status, submitted_at)
  where status = 'pending';

create table public.partner_stock_movements (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.partner_campaign_assignments(id) on delete restrict,
  partner_profile_id uuid not null references public.partner_profiles(id) on delete cascade,
  movement_type text not null check (movement_type in ('issued', 'distributed', 'adjusted', 'returned')),
  quantity integer not null check (quantity <> 0),
  proof_id uuid references public.partner_proofs(id) on delete restrict,
  notes text not null default '' check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid references public.admin_users(id) on delete set null,
  check ((movement_type = 'distributed' and quantity < 0 and proof_id is not null) or
    (movement_type <> 'distributed' and proof_id is null))
);

create unique index partner_stock_movements_proof_unique
  on public.partner_stock_movements (proof_id)
  where proof_id is not null;
create index partner_stock_movements_partner_recent
  on public.partner_stock_movements (partner_profile_id, created_at desc);

create table public.partner_withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  partner_profile_id uuid not null references public.partner_profiles(id) on delete cascade,
  amount integer not null check (amount >= 100000),
  status text not null default 'requested' check (status in ('requested', 'settled', 'rejected')),
  reference text not null default '',
  review_note text not null default '',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.admin_users(id) on delete set null
);

create index partner_withdrawal_requests_partner
  on public.partner_withdrawal_requests (partner_profile_id, created_at desc);

create table public.partner_coin_ledger (
  id uuid primary key default gen_random_uuid(),
  partner_profile_id uuid not null references public.partner_profiles(id) on delete cascade,
  campaign_id uuid references public.partner_campaigns(id) on delete set null,
  proof_id uuid references public.partner_proofs(id) on delete restrict,
  withdrawal_request_id uuid references public.partner_withdrawal_requests(id) on delete restrict,
  entry_type text not null check (entry_type in ('earning', 'withdrawal')),
  amount integer not null check (amount <> 0),
  status text not null check (status in ('pending', 'approved', 'rejected', 'requested', 'settled')),
  reference text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  check ((entry_type = 'earning' and amount > 0 and proof_id is not null and withdrawal_request_id is null) or
    (entry_type = 'withdrawal' and amount < 0 and proof_id is null and withdrawal_request_id is not null))
);

create unique index partner_coin_ledger_proof_unique
  on public.partner_coin_ledger (proof_id)
  where proof_id is not null;
create unique index partner_coin_ledger_withdrawal_unique
  on public.partner_coin_ledger (withdrawal_request_id)
  where withdrawal_request_id is not null;
create index partner_coin_ledger_partner_recent
  on public.partner_coin_ledger (partner_profile_id, created_at desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'partner_campaigns',
    'partner_campaign_assignments',
    'partner_campaign_sites',
    'partner_campaign_requests',
    'partner_damage_reports',
    'partner_proofs',
    'partner_stock_movements',
    'partner_withdrawal_requests',
    'partner_coin_ledger'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (false) with check (false)',
      table_name || '_no_direct_access',
      table_name
    );
  end loop;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('partner-proofs', 'partner-proofs', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function public.create_partner_campaign_assignment(
  p_partner_profile_id uuid,
  p_name text,
  p_description text,
  p_area text,
  p_start_date date,
  p_end_date date,
  p_daily_target integer,
  p_coins_per_proof integer,
  p_initial_stock integer,
  p_map_center_latitude double precision,
  p_map_center_longitude double precision,
  p_sites jsonb,
  p_owner_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  campaign_id uuid;
  assignment_id uuid;
  site jsonb;
begin
  if not exists (
    select 1 from public.admin_users
    where id = p_owner_id and is_primary_owner = true and status = 'active' and role = 'owner'
  ) then
    raise exception 'Only the active Primary Owner can assign a partner campaign';
  end if;
  if not exists (
    select 1 from public.partner_profiles
    where id = p_partner_profile_id and status = 'active'
  ) then
    raise exception 'An active partner profile is required';
  end if;
  if p_initial_stock < 0 or p_initial_stock > 1000000 or p_sites is null or
    jsonb_typeof(p_sites) <> 'array' or jsonb_array_length(p_sites) = 0 then
    raise exception 'Valid initial stock and at least one campaign site are required';
  end if;
  if (p_map_center_latitude is null) <> (p_map_center_longitude is null) or
    (p_map_center_latitude is not null and
      (p_map_center_latitude not between -90 and 90 or p_map_center_longitude not between -180 and 180)) then
    raise exception 'The campaign map coordinates are invalid';
  end if;

  insert into public.partner_campaigns (
    name, description, area, start_date, end_date, daily_target, coins_per_proof,
    map_center_latitude, map_center_longitude
  ) values (
    btrim(p_name), coalesce(p_description, ''), btrim(p_area),
    p_start_date, p_end_date, p_daily_target, p_coins_per_proof,
    p_map_center_latitude, p_map_center_longitude
  ) returning id into campaign_id;

  insert into public.partner_campaign_assignments (
    campaign_id, partner_profile_id, daily_target
  ) values (campaign_id, p_partner_profile_id, p_daily_target)
  returning id into assignment_id;

  for site in select value from jsonb_array_elements(p_sites)
  loop
    insert into public.partner_campaign_sites (campaign_id, name, address)
    values (campaign_id, btrim(site ->> 'name'), btrim(site ->> 'address'));
  end loop;

  if p_initial_stock > 0 then
    insert into public.partner_stock_movements (
      assignment_id, partner_profile_id, movement_type, quantity, notes, created_by
    ) values (
      assignment_id, p_partner_profile_id, 'issued', p_initial_stock,
      'Initial campaign stock', p_owner_id
    );
  end if;
  return assignment_id;
end;
$$;

create or replace function public.submit_partner_proof(
  p_partner_profile_id uuid,
  p_assignment_id uuid,
  p_site_id uuid,
  p_photo_path text,
  p_note text,
  p_latitude double precision,
  p_longitude double precision
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  assignment public.partner_campaign_assignments%rowtype;
  campaign public.partner_campaigns%rowtype;
  proof_id uuid;
  today_count integer;
begin
  select * into assignment
  from public.partner_campaign_assignments
  where id = p_assignment_id
    and partner_profile_id = p_partner_profile_id
    and active = true
  for update;
  if not found then raise exception 'Active campaign assignment not found'; end if;

  select * into campaign from public.partner_campaigns
  where id = assignment.campaign_id and status = 'active';
  if not found or current_date not between campaign.start_date and campaign.end_date then
    raise exception 'Campaign is not active today';
  end if;
  if not exists (
    select 1 from public.partner_campaign_sites
    where id = p_site_id and campaign_id = campaign.id
  ) then raise exception 'The selected shop is not part of this campaign'; end if;
  if p_photo_path not like p_partner_profile_id::text || '/%' then
    raise exception 'The proof photo is not owned by this partner';
  end if;
  if (p_latitude is null) <> (p_longitude is null) or
    (p_latitude is not null and (p_latitude not between -90 and 90 or p_longitude not between -180 and 180)) then
    raise exception 'The captured location is invalid';
  end if;
  if char_length(coalesce(p_note, '')) > 200 then raise exception 'The proof note is too long'; end if;

  select count(*) into today_count
  from public.partner_proofs
  where assignment_id = assignment.id
    and submitted_at >= date_trunc('day', now())
    and submitted_at < date_trunc('day', now()) + interval '1 day';
  if today_count >= assignment.daily_target then raise exception 'Daily proof target reached'; end if;

  insert into public.partner_proofs (
    assignment_id, campaign_id, site_id, partner_profile_id, photo_path, note,
    latitude, longitude, coins
  ) values (
    assignment.id, campaign.id, p_site_id, p_partner_profile_id, p_photo_path,
    coalesce(p_note, ''), p_latitude, p_longitude, campaign.coins_per_proof
  ) returning id into proof_id;

  insert into public.partner_coin_ledger (
    partner_profile_id, campaign_id, proof_id, entry_type, amount, status, reference, notes
  ) values (
    p_partner_profile_id, campaign.id, proof_id, 'earning', campaign.coins_per_proof,
    'pending', campaign.name, 'Proof submitted; awaiting owner review'
  );
  return proof_id;
end;
$$;

create or replace function public.review_partner_proof(
  p_proof_id uuid,
  p_owner_id uuid,
  p_decision text,
  p_review_note text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  proof public.partner_proofs%rowtype;
  available_stock bigint;
begin
  if not exists (
    select 1 from public.admin_users
    where id = p_owner_id and is_primary_owner = true and status = 'active' and role = 'owner'
  ) then raise exception 'Only the active Primary Owner can review partner proofs'; end if;
  if p_decision not in ('approved', 'needs_correction', 'rejected') then
    raise exception 'Invalid partner proof review decision';
  end if;
  select * into proof from public.partner_proofs where id = p_proof_id for update;
  if not found then raise exception 'Partner proof not found'; end if;
  if proof.status = p_decision then return proof.status; end if;
  if proof.status <> 'pending' then raise exception 'Partner proof has already been reviewed'; end if;

  if p_decision = 'approved' then
    perform 1
    from public.partner_campaign_assignments
    where id = proof.assignment_id
    for update;
    select coalesce(sum(quantity), 0) into available_stock
    from public.partner_stock_movements
    where assignment_id = proof.assignment_id;
    if available_stock < 1 then raise exception 'No campaign stock is available to approve this proof'; end if;
    insert into public.partner_stock_movements (
      assignment_id, partner_profile_id, movement_type, quantity, proof_id, notes, created_by
    ) values (
      proof.assignment_id, proof.partner_profile_id, 'distributed', -1, proof.id,
      'Distributed for approved proof', p_owner_id
    ) on conflict (proof_id) where proof_id is not null do nothing;
    update public.partner_coin_ledger
    set status = 'approved', notes = coalesce(nullif(p_review_note, ''), 'Proof approved')
    where proof_id = proof.id and entry_type = 'earning' and status = 'pending';
  else
    update public.partner_coin_ledger
    set status = 'rejected', notes = coalesce(nullif(p_review_note, ''), 'Proof requires correction')
    where proof_id = proof.id and entry_type = 'earning' and status = 'pending';
  end if;

  update public.partner_proofs
  set status = p_decision,
      review_note = coalesce(p_review_note, ''),
      reviewed_at = now(),
      reviewed_by = p_owner_id
  where id = proof.id;
  return p_decision;
end;
$$;

create or replace function public.request_partner_withdrawal(
  p_partner_profile_id uuid,
  p_amount integer
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_id uuid;
  available_coins bigint;
begin
  perform 1 from public.partner_profiles
  where id = p_partner_profile_id and status = 'active'
  for update;
  if not found then raise exception 'Active partner profile not found'; end if;
  if p_amount < 100000 then raise exception 'The minimum withdrawal is 100000 NGA Coins'; end if;

  select coalesce(sum(amount), 0) into available_coins
  from public.partner_coin_ledger
  where partner_profile_id = p_partner_profile_id
    and ((entry_type = 'earning' and status = 'approved') or
      (entry_type = 'withdrawal' and status in ('requested', 'settled')));
  if p_amount > available_coins then raise exception 'Insufficient available NGA Coins'; end if;

  insert into public.partner_withdrawal_requests (partner_profile_id, amount)
  values (p_partner_profile_id, p_amount)
  returning id into request_id;
  insert into public.partner_coin_ledger (
    partner_profile_id, withdrawal_request_id, entry_type, amount, status, reference, notes
  ) values (
    p_partner_profile_id, request_id, 'withdrawal', -p_amount, 'requested',
    'Withdrawal ' || request_id::text, 'Withdrawal request awaiting owner review'
  );
  return request_id;
end;
$$;

create or replace function public.review_partner_withdrawal(
  p_request_id uuid,
  p_owner_id uuid,
  p_decision text,
  p_reference text,
  p_review_note text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  withdrawal public.partner_withdrawal_requests%rowtype;
  ledger_status text;
begin
  if not exists (
    select 1 from public.admin_users
    where id = p_owner_id and is_primary_owner = true and status = 'active' and role = 'owner'
  ) then raise exception 'Only the active Primary Owner can settle partner withdrawals'; end if;
  if p_decision not in ('settled', 'rejected') then raise exception 'Invalid withdrawal decision'; end if;
  select * into withdrawal
  from public.partner_withdrawal_requests
  where id = p_request_id
  for update;
  if not found then raise exception 'Withdrawal request not found'; end if;
  if withdrawal.status = p_decision then return withdrawal.status; end if;
  if withdrawal.status <> 'requested' then raise exception 'Withdrawal request has already been reviewed'; end if;

  update public.partner_withdrawal_requests
  set status = p_decision,
      reference = coalesce(p_reference, ''),
      review_note = coalesce(p_review_note, ''),
      reviewed_at = now(),
      reviewed_by = p_owner_id
  where id = withdrawal.id;
  ledger_status := case when p_decision = 'settled' then 'settled' else 'rejected' end;
  update public.partner_coin_ledger
  set status = ledger_status,
      reference = coalesce(nullif(p_reference, ''), reference),
      notes = coalesce(nullif(p_review_note, ''), notes)
  where withdrawal_request_id = withdrawal.id and entry_type = 'withdrawal';
  return p_decision;
end;
$$;

create or replace function public.review_partner_campaign_request(
  p_request_id uuid,
  p_owner_id uuid,
  p_decision text,
  p_review_note text,
  p_stock_quantity integer
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request public.partner_campaign_requests%rowtype;
begin
  if not exists (
    select 1 from public.admin_users
    where id = p_owner_id and is_primary_owner = true and status = 'active' and role = 'owner'
  ) then raise exception 'Only the active Primary Owner can review campaign requests'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'Invalid campaign request decision'; end if;
  select * into request from public.partner_campaign_requests where id = p_request_id for update;
  if not found then raise exception 'Campaign request not found'; end if;
  if request.status = p_decision then return request.status; end if;
  if request.status <> 'pending' then raise exception 'Campaign request has already been reviewed'; end if;
  if p_decision = 'approved' and request.request_type = 'additional_stock' then
    if p_stock_quantity < 1 or p_stock_quantity > 1000000 then
      raise exception 'A valid stock quantity is required to approve this request';
    end if;
    insert into public.partner_stock_movements (
      assignment_id, partner_profile_id, movement_type, quantity, notes, created_by
    ) values (
      request.assignment_id, request.partner_profile_id, 'issued', p_stock_quantity,
      coalesce(nullif(p_review_note, ''), 'Additional stock request approved'), p_owner_id
    );
  end if;
  update public.partner_campaign_requests
  set status = p_decision, review_note = coalesce(p_review_note, ''),
      reviewed_at = now(), reviewed_by = p_owner_id
  where id = request.id;
  return p_decision;
end;
$$;

create or replace function public.review_partner_damage_report(
  p_report_id uuid,
  p_owner_id uuid,
  p_decision text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report public.partner_damage_reports%rowtype;
begin
  if not exists (
    select 1 from public.admin_users
    where id = p_owner_id and is_primary_owner = true and status = 'active' and role = 'owner'
  ) then raise exception 'Only the active Primary Owner can review damage reports'; end if;
  if p_decision not in ('resolved', 'rejected') then raise exception 'Invalid damage report decision'; end if;
  select * into report from public.partner_damage_reports where id = p_report_id for update;
  if not found then raise exception 'Damage report not found'; end if;
  if report.status = p_decision then return report.status; end if;
  if report.status <> 'pending' then raise exception 'Damage report has already been reviewed'; end if;
  update public.partner_damage_reports
  set status = p_decision, reviewed_at = now(), reviewed_by = p_owner_id
  where id = report.id;
  return p_decision;
end;
$$;

revoke all on function public.create_partner_campaign_assignment(uuid, text, text, text, date, date, integer, integer, integer, double precision, double precision, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.submit_partner_proof(uuid, uuid, uuid, text, text, double precision, double precision)
  from public, anon, authenticated;
revoke all on function public.review_partner_proof(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.request_partner_withdrawal(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.review_partner_withdrawal(uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.review_partner_campaign_request(uuid, uuid, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.review_partner_damage_report(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.create_partner_campaign_assignment(uuid, text, text, text, date, date, integer, integer, integer, double precision, double precision, jsonb, uuid)
  to service_role;
grant execute on function public.submit_partner_proof(uuid, uuid, uuid, text, text, double precision, double precision)
  to service_role;
grant execute on function public.review_partner_proof(uuid, uuid, text, text)
  to service_role;
grant execute on function public.request_partner_withdrawal(uuid, integer)
  to service_role;
grant execute on function public.review_partner_withdrawal(uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.review_partner_campaign_request(uuid, uuid, text, text, integer)
  to service_role;
grant execute on function public.review_partner_damage_report(uuid, uuid, text)
  to service_role;
