create table public.delivery_team_settings (
  id boolean primary key default true check (id),
  low_stock_threshold integer not null default 5 check (low_stock_threshold between 1 and 100000),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.delivery_team_settings (id, low_stock_threshold)
values (true, 5)
on conflict (id) do nothing;

alter table public.delivery_team_settings enable row level security;
revoke all on public.delivery_team_settings from public, anon, authenticated;
grant all on public.delivery_team_settings to service_role;
create policy delivery_team_settings_no_direct_access
  on public.delivery_team_settings for all to anon, authenticated
  using (false) with check (false);

create table public.delivery_team_activity (
  id uuid primary key default gen_random_uuid(),
  activity_type text not null,
  actor_id uuid,
  partner_profile_id uuid,
  partner_name text not null default '',
  campaign_id uuid,
  details jsonb not null default '{}'::jsonb,
  status text not null default '',
  created_at timestamptz not null default now()
);

create index delivery_team_activity_recent
  on public.delivery_team_activity (created_at desc);
create index delivery_team_activity_partner_recent
  on public.delivery_team_activity (partner_profile_id, created_at desc);

alter table public.delivery_team_activity enable row level security;
revoke all on public.delivery_team_activity from public, anon, authenticated;
grant all on public.delivery_team_activity to service_role;
create policy delivery_team_activity_no_direct_access
  on public.delivery_team_activity for all to anon, authenticated
  using (false) with check (false);

alter table public.partner_coin_ledger
  drop constraint if exists partner_coin_ledger_entry_type_check,
  drop constraint if exists partner_coin_ledger_check;

alter table public.partner_coin_ledger
  add column administrator_id uuid,
  add column admin_previous_balance bigint,
  add column admin_resulting_balance bigint,
  add column admin_reset boolean not null default false,
  add column idempotency_key uuid;

alter table public.partner_coin_ledger
  add constraint partner_coin_ledger_entry_type_check
    check (entry_type in ('earning', 'withdrawal', 'adjustment')),
  add constraint partner_coin_ledger_entry_integrity_check
    check (
      (entry_type = 'earning' and amount > 0 and proof_id is not null and withdrawal_request_id is null) or
      (entry_type = 'withdrawal' and amount < 0 and proof_id is null and withdrawal_request_id is not null) or
      (entry_type = 'adjustment' and amount <> 0 and proof_id is null and withdrawal_request_id is null and
        administrator_id is not null and admin_previous_balance is not null and admin_resulting_balance is not null)
    ),
  add constraint partner_coin_ledger_admin_balance_check
    check (
      (entry_type <> 'adjustment') or
      (admin_previous_balance >= 0 and admin_resulting_balance >= 0 and
        admin_resulting_balance = admin_previous_balance + amount)
    ),
  add constraint partner_coin_ledger_admin_reset_check
    check (not admin_reset or (entry_type = 'adjustment' and amount < 0));

create unique index partner_coin_ledger_idempotency_unique
  on public.partner_coin_ledger (idempotency_key)
  where idempotency_key is not null;

alter table public.partner_stock_movements
  add column administrator_id uuid,
  add column previous_balance bigint,
  add column resulting_balance bigint,
  add column idempotency_key uuid;

alter table public.partner_stock_movements
  add constraint partner_stock_movements_admin_balance_check
    check (
      ((previous_balance is null and resulting_balance is null) or
        (administrator_id is not null and previous_balance is not null and
          resulting_balance is not null and previous_balance >= 0 and
          resulting_balance >= 0 and resulting_balance = previous_balance + quantity)) and
      (idempotency_key is null or administrator_id is not null)
    );

alter table public.partner_damage_reports
  add column review_note text not null default '';

create unique index partner_stock_movements_idempotency_unique
  on public.partner_stock_movements (idempotency_key)
  where idempotency_key is not null;

create or replace function public.assert_delivery_team_admin(
  p_admin_id uuid,
  p_action text
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  allowed boolean;
begin
  if p_action not in ('view', 'create', 'edit') then
    raise exception 'Invalid Delivery Team permission action';
  end if;

  select exists (
    select 1
    from public.admin_users a
    where a.id = p_admin_id
      and a.status = 'active'
      and (
        a.role = 'owner' or
        (
          a.permissions -> 'deliveryTeam' ->> 'view' = 'true'
          and case p_action
            when 'view' then a.permissions -> 'deliveryTeam' ->> 'view' = 'true'
            when 'create' then a.permissions -> 'deliveryTeam' ->> 'create' = 'true'
            when 'edit' then a.permissions -> 'deliveryTeam' ->> 'edit' = 'true'
            else false
          end
        )
      )
  ) into allowed;

  if not allowed then
    raise exception 'Administrator is not authorized for this Delivery Team action';
  end if;
end;
$$;

create or replace function public.delivery_team_available_coins(
  p_partner_profile_id uuid
)
returns bigint
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(sum(l.amount), 0)::bigint
  from public.partner_coin_ledger l
  where l.partner_profile_id = p_partner_profile_id
    and (
      (l.entry_type = 'earning' and l.status in ('approved', 'settled')) or
      (l.entry_type = 'adjustment' and l.status = 'approved') or
      (l.entry_type = 'withdrawal' and l.status in ('requested', 'settled'))
    );
$$;

create or replace function public.get_partner_coin_summary(
  p_partner_profile_id uuid
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
  select jsonb_build_object(
    'balance', public.delivery_team_available_coins(p_partner_profile_id),
    'totalEarned', coalesce(sum(l.amount) filter (
      where l.entry_type = 'earning' and l.status in ('approved', 'settled')
    ), 0),
    'totalWithdrawn', coalesce(-sum(l.amount) filter (
      where l.entry_type = 'withdrawal' and l.status = 'settled'
    ), 0),
    'pendingApproval', coalesce(sum(l.amount) filter (
      where l.entry_type = 'earning' and l.status = 'pending'
    ), 0)
  ) into result
  from public.partner_coin_ledger l
  where l.partner_profile_id = p_partner_profile_id;

  return coalesce(result, jsonb_build_object(
    'balance', 0, 'totalEarned', 0, 'totalWithdrawn', 0, 'pendingApproval', 0
  ));
end;
$$;

create or replace function public.get_delivery_team_overview(
  p_admin_id uuid
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

  with partner_balances as (
    select p.id, public.delivery_team_available_coins(p.id) as coins
    from public.partner_profiles p
  ),
  today_events as (
    select submitted_at as created_at from public.partner_proofs
      where submitted_at >= date_trunc('day', now())
    union all
    select reviewed_at from public.partner_proofs
      where reviewed_at >= date_trunc('day', now())
    union all
    select created_at from public.partner_campaign_requests
      where created_at >= date_trunc('day', now())
    union all
    select reviewed_at from public.partner_campaign_requests
      where reviewed_at >= date_trunc('day', now())
    union all
    select created_at from public.partner_damage_reports
      where created_at >= date_trunc('day', now())
    union all
    select reviewed_at from public.partner_damage_reports
      where reviewed_at >= date_trunc('day', now())
    union all
    select created_at from public.partner_withdrawal_requests
      where created_at >= date_trunc('day', now())
    union all
    select reviewed_at from public.partner_withdrawal_requests
      where reviewed_at >= date_trunc('day', now())
    union all
    select created_at from public.partner_stock_movements
      where created_at >= date_trunc('day', now())
    union all
    select created_at from public.partner_coin_ledger
      where created_at >= date_trunc('day', now())
    union all
    select created_at from public.delivery_team_activity
      where created_at >= date_trunc('day', now())
  )
  select jsonb_build_object(
    'totalPartners', (select count(*) from public.partner_profiles),
    'activePartners', (select count(*) from public.partner_profiles where status = 'active'),
    'totalAvailableCoins', coalesce((select sum(coins) from partner_balances), 0),
    'totalIssuedStock', coalesce((
      select sum(quantity) from public.partner_stock_movements
      where movement_type = 'issued' and quantity > 0
    ), 0),
    'pendingRequests',
      (select count(*) from public.partner_campaign_requests where status = 'pending') +
      (select count(*) from public.partner_damage_reports where status = 'pending') +
      (select count(*) from public.partner_withdrawal_requests where status = 'requested'),
    'pendingProofs', (select count(*) from public.partner_proofs where status = 'pending'),
    'todaysActivity', (select count(*) from today_events),
    'lowStockThreshold', coalesce((
      select low_stock_threshold from public.delivery_team_settings where id = true
    ), 5)
  ) into result;

  return result;
end;
$$;

create or replace function public.get_delivery_team_partners(
  p_admin_id uuid,
  p_search text default '',
  p_status text default 'all',
  p_page integer default 1,
  p_page_size integer default 20
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
  if p_status not in ('all', 'active', 'pending', 'disabled') or
    p_page < 1 or p_page > 100000 or p_page_size < 1 or p_page_size > 100 then
    raise exception 'Invalid Delivery Team partner filters';
  end if;

  with filtered as (
    select p.*
    from public.partner_profiles p
    where (p_status = 'all' or p.status = p_status)
      and (
        coalesce(p_search, '') = '' or
        p.full_name ilike '%' || p_search || '%' or
        p.email ilike '%' || p_search || '%' or
        p.mobile_number ilike '%' || p_search || '%' or
        p.id::text ilike '%' || p_search || '%'
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

create or replace function public.get_delivery_team_partner_detail(
  p_admin_id uuid,
  p_partner_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
  partner_row public.partner_profiles%rowtype;
  stock_summary jsonb;
begin
  perform public.assert_delivery_team_admin(p_admin_id, 'view');
  select * into partner_row from public.partner_profiles where id = p_partner_profile_id;
  if not found then raise exception 'Delivery partner not found'; end if;

  select jsonb_build_object(
    'available', coalesce(sum(m.quantity), 0),
    'issued', coalesce(sum(m.quantity) filter (where m.movement_type = 'issued' and m.quantity > 0), 0),
    'distributed', coalesce(-sum(m.quantity) filter (where m.movement_type = 'distributed' and m.quantity < 0), 0),
    'damaged', coalesce(-sum(m.quantity) filter (where m.movement_type = 'adjusted' and m.notes like 'Damage/loss:%' and m.quantity < 0), 0),
    'returned', coalesce(-sum(m.quantity) filter (where m.movement_type = 'returned' and m.quantity < 0), 0)
  ) into stock_summary
  from public.partner_stock_movements m
  where m.partner_profile_id = p_partner_profile_id;

  select jsonb_build_object(
    'partner', to_jsonb(partner_row) || jsonb_build_object(
      'available_coins', public.delivery_team_available_coins(partner_row.id),
      'remaining_stock', coalesce((select sum(quantity) from public.partner_stock_movements where partner_profile_id = partner_row.id), 0),
      'pending_requests',
        (select count(*) from public.partner_campaign_requests where partner_profile_id = partner_row.id and status = 'pending') +
        (select count(*) from public.partner_damage_reports where partner_profile_id = partner_row.id and status = 'pending') +
        (select count(*) from public.partner_withdrawal_requests where partner_profile_id = partner_row.id and status = 'requested')
    ),
    'coinSummary', public.get_partner_coin_summary(partner_row.id),
    'coinHistory', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at desc, l.id desc)
      from public.partner_coin_ledger l where l.partner_profile_id = partner_row.id
    ), '[]'::jsonb),
    'stockSummary', stock_summary,
    'stockHistory', coalesce((
      select jsonb_agg(
        to_jsonb(m) || jsonb_build_object('campaign_name', c.name)
        order by m.created_at desc, m.id desc
      )
      from public.partner_stock_movements m
      join public.partner_campaign_assignments a on a.id = m.assignment_id
      join public.partner_campaigns c on c.id = a.campaign_id
      where m.partner_profile_id = partner_row.id
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'campaign_id', c.id,
        'campaign_name', c.name,
        'campaign_status', c.status,
        'area', c.area
      ) order by a.created_at desc)
      from public.partner_campaign_assignments a
      join public.partner_campaigns c on c.id = a.campaign_id
      where a.partner_profile_id = partner_row.id
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.get_delivery_team_campaigns(
  p_admin_id uuid
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
  select coalesce(jsonb_agg(
    to_jsonb(c) || jsonb_build_object(
      'assigned_partners',
      (select count(*) from public.partner_campaign_assignments a where a.campaign_id = c.id)
    ) order by c.created_at desc
  ), '[]'::jsonb)
  into result
  from public.partner_campaigns c;
  return result;
end;
$$;

create or replace function public.admin_adjust_partner_coins(
  p_admin_id uuid,
  p_partner_profile_id uuid,
  p_amount integer,
  p_reason text,
  p_idempotency_key uuid,
  p_is_reset boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  partner public.partner_profiles%rowtype;
  prior_entry public.partner_coin_ledger%rowtype;
  previous_balance bigint;
  resulting_balance bigint;
  ledger_id uuid;
begin
  perform public.assert_delivery_team_admin(p_admin_id, 'edit');
  if p_amount = 0 or abs(p_amount::bigint) > 100000000 or
    char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 or
    p_idempotency_key is null or p_is_reset is null then
    raise exception 'A valid adjustment amount, reason and idempotency key are required';
  end if;

  select * into partner from public.partner_profiles where id = p_partner_profile_id for update;
  if not found then raise exception 'Delivery partner not found'; end if;
  select * into prior_entry from public.partner_coin_ledger where idempotency_key = p_idempotency_key;
  if found then
    if prior_entry.entry_type <> 'adjustment' or
      prior_entry.partner_profile_id <> p_partner_profile_id or
      prior_entry.amount <> p_amount or prior_entry.notes <> btrim(p_reason) or
      prior_entry.administrator_id is distinct from p_admin_id or
      prior_entry.admin_reset is distinct from p_is_reset then
      raise exception 'Idempotency key was already used for a different coin adjustment';
    end if;
    return jsonb_build_object(
      'ledgerId', prior_entry.id,
      'previousBalance', prior_entry.admin_previous_balance,
      'resultingBalance', prior_entry.admin_resulting_balance,
      'replayed', true
    );
  end if;

  previous_balance := public.delivery_team_available_coins(p_partner_profile_id);
  if p_is_reset is true and p_amount <> -previous_balance then
    raise exception 'A reset must exactly offset the current available coin balance';
  end if;
  resulting_balance := previous_balance + p_amount;
  if resulting_balance < 0 then raise exception 'An adjustment cannot make the available coin balance negative'; end if;

  insert into public.partner_coin_ledger (
    partner_profile_id, entry_type, amount, status, reference, notes,
    administrator_id, admin_previous_balance, admin_resulting_balance,
    admin_reset, idempotency_key
  ) values (
    p_partner_profile_id, 'adjustment', p_amount, 'approved', 'Manual administrator adjustment',
    btrim(p_reason), p_admin_id, previous_balance, resulting_balance,
    p_is_reset, p_idempotency_key
  ) returning id into ledger_id;

  insert into public.delivery_team_activity (
    activity_type, actor_id, partner_profile_id, partner_name, details, status
  ) values (
    case when p_is_reset then 'NGA Coins reset'
      when p_amount > 0 then 'NGA Coins increased' else 'NGA Coins decreased' end,
    p_admin_id, partner.id, partner.full_name,
    jsonb_build_object(
      'amount', p_amount, 'previousBalance', previous_balance,
      'resultingBalance', resulting_balance, 'reason', btrim(p_reason),
      'ledgerId', ledger_id, 'isReset', p_is_reset
    ),
    'recorded'
  );

  return jsonb_build_object(
    'ledgerId', ledger_id,
    'previousBalance', previous_balance,
    'resultingBalance', resulting_balance,
    'replayed', false
  );
end;
$$;

create or replace function public.admin_manage_partner_stock(
  p_admin_id uuid,
  p_partner_profile_id uuid,
  p_assignment_id uuid,
  p_movement_type text,
  p_quantity integer,
  p_notes text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  partner public.partner_profiles%rowtype;
  assignment public.partner_campaign_assignments%rowtype;
  prior_movement public.partner_stock_movements%rowtype;
  previous_balance bigint;
  resulting_balance bigint;
  movement_id uuid;
begin
  perform public.assert_delivery_team_admin(p_admin_id, 'edit');
  if p_movement_type not in ('issued', 'returned', 'adjusted') or
    p_quantity = 0 or abs(p_quantity::bigint) > 1000000 or p_idempotency_key is null or
    char_length(btrim(coalesce(p_notes, ''))) not between 3 and 500 or
    (p_movement_type = 'issued' and p_quantity < 1) or
    (p_movement_type = 'returned' and p_quantity > -1) then
    raise exception 'A valid stock movement, quantity, reason and idempotency key are required';
  end if;

  select * into partner from public.partner_profiles where id = p_partner_profile_id;
  if not found then raise exception 'Delivery partner not found'; end if;
  select * into assignment from public.partner_campaign_assignments
    where id = p_assignment_id and partner_profile_id = p_partner_profile_id for update;
  if not found then raise exception 'Campaign assignment does not belong to this partner'; end if;

  select * into prior_movement from public.partner_stock_movements where idempotency_key = p_idempotency_key;
  if found then
    if prior_movement.partner_profile_id <> p_partner_profile_id or
      prior_movement.assignment_id <> p_assignment_id or
      prior_movement.movement_type <> p_movement_type or
      prior_movement.quantity <> p_quantity or prior_movement.notes <> btrim(p_notes) or
      prior_movement.administrator_id is distinct from p_admin_id then
      raise exception 'Idempotency key was already used for a different stock movement';
    end if;
    return jsonb_build_object(
      'movementId', prior_movement.id,
      'previousBalance', prior_movement.previous_balance,
      'resultingBalance', prior_movement.resulting_balance,
      'replayed', true
    );
  end if;

  select coalesce(sum(m.quantity), 0) into previous_balance
  from public.partner_stock_movements m
  where m.assignment_id = p_assignment_id;
  resulting_balance := previous_balance + p_quantity;
  if resulting_balance < 0 then raise exception 'This stock movement would create a negative partner stock balance'; end if;

  insert into public.partner_stock_movements (
    assignment_id, partner_profile_id, movement_type, quantity, notes,
    created_by, administrator_id, previous_balance, resulting_balance, idempotency_key
  ) values (
    p_assignment_id, p_partner_profile_id, p_movement_type, p_quantity, btrim(p_notes),
    p_admin_id, p_admin_id, previous_balance, resulting_balance, p_idempotency_key
  ) returning id into movement_id;

  insert into public.delivery_team_activity (
    activity_type, actor_id, partner_profile_id, partner_name, campaign_id, details, status
  ) values (
    case p_movement_type when 'issued' then 'WildCard stock issued'
      when 'returned' then 'WildCard stock returned' else 'WildCard stock adjusted' end,
    p_admin_id, partner.id, partner.full_name, assignment.campaign_id,
    jsonb_build_object(
      'quantity', p_quantity, 'previousBalance', previous_balance,
      'resultingBalance', resulting_balance, 'reason', btrim(p_notes),
      'movementId', movement_id
    ),
    'recorded'
  );

  return jsonb_build_object(
    'movementId', movement_id,
    'previousBalance', previous_balance,
    'resultingBalance', resulting_balance,
    'replayed', false
  );
end;
$$;

create or replace function public.admin_create_partner_campaign_assignment(
  p_admin_id uuid,
  p_partner_profile_id uuid,
  p_name text,
  p_description text,
  p_area text,
  p_start_date date,
  p_end_date date,
  p_daily_target integer,
  p_coins_per_proof integer,
  p_initial_stock integer,
  p_sites jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  campaign_id uuid;
  assignment_id uuid;
  partner public.partner_profiles%rowtype;
  site jsonb;
begin
  perform public.assert_delivery_team_admin(p_admin_id, 'create');
  select * into partner from public.partner_profiles where id = p_partner_profile_id and status = 'active';
  if not found then raise exception 'An active delivery partner is required'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 120 or
    char_length(btrim(coalesce(p_area, ''))) not between 2 and 160 or
    char_length(coalesce(p_description, '')) > 1000 or
    p_start_date is null or p_end_date is null or p_end_date < p_start_date or
    p_daily_target is null or p_daily_target not between 1 and 1000 or
    p_coins_per_proof is null or p_coins_per_proof not between 1 and 1000000 or
    p_initial_stock is null or p_initial_stock not between 0 and 1000000 or
    p_sites is null or jsonb_typeof(p_sites) <> 'array' or
    jsonb_array_length(p_sites) not between 1 and 100 then
    raise exception 'Valid campaign dates, target, reward, stock and at least one shop are required';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_sites) as site(value)
    where jsonb_typeof(site.value) <> 'object' or
      char_length(btrim(coalesce(site.value ->> 'name', ''))) not between 2 and 120 or
      char_length(btrim(coalesce(site.value ->> 'address', ''))) not between 2 and 240
  ) then raise exception 'Campaign shop details are invalid'; end if;

  insert into public.partner_campaigns (
    name, description, area, start_date, end_date, daily_target, coins_per_proof
  ) values (
    btrim(p_name), coalesce(p_description, ''), btrim(p_area), p_start_date,
    p_end_date, p_daily_target, p_coins_per_proof
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
      assignment_id, partner_profile_id, movement_type, quantity, notes,
      created_by, administrator_id, previous_balance, resulting_balance
    ) values (
      assignment_id, partner.id, 'issued', p_initial_stock,
      'Initial campaign stock', p_admin_id, p_admin_id, 0, p_initial_stock
    );
  end if;

  insert into public.delivery_team_activity (
    activity_type, actor_id, partner_profile_id, partner_name, campaign_id, details, status
  ) values (
    'Campaign assigned', p_admin_id, partner.id, partner.full_name, campaign_id,
    jsonb_build_object(
      'campaignName', btrim(p_name), 'area', btrim(p_area),
      'dailyTarget', p_daily_target, 'initialStock', p_initial_stock,
      'assignmentId', assignment_id
    ),
    'active'
  );
  return assignment_id;
end;
$$;

create or replace function public.admin_update_partner_campaign_status(
  p_admin_id uuid,
  p_campaign_id uuid,
  p_status text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  campaign public.partner_campaigns%rowtype;
begin
  perform public.assert_delivery_team_admin(p_admin_id, 'edit');
  if p_status not in ('active', 'paused', 'completed') then
    raise exception 'Invalid WildCard campaign status';
  end if;
  select * into campaign from public.partner_campaigns where id = p_campaign_id for update;
  if not found then raise exception 'WildCard campaign not found'; end if;
  if campaign.status = 'completed' and p_status <> 'completed' then
    raise exception 'A completed campaign cannot be resumed';
  end if;
  update public.partner_campaigns set status = p_status where id = campaign.id;
  insert into public.delivery_team_activity (
    activity_type, actor_id, campaign_id, details, status
  ) values (
    case p_status when 'paused' then 'Campaign paused'
      when 'completed' then 'Campaign completed' else 'Campaign resumed' end,
    p_admin_id, campaign.id,
    jsonb_build_object('campaignName', campaign.name, 'previousStatus', campaign.status, 'status', p_status),
    p_status
  );
  return p_status;
end;
$$;

create or replace function public.admin_set_delivery_team_low_stock_threshold(
  p_admin_id uuid,
  p_threshold integer
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.assert_delivery_team_admin(p_admin_id, 'edit');
  if p_threshold not between 1 and 100000 then
    raise exception 'Low-stock threshold must be between 1 and 100000 physical cards';
  end if;
  insert into public.delivery_team_settings (id, low_stock_threshold, updated_at, updated_by)
  values (true, p_threshold, now(), p_admin_id)
  on conflict (id) do update
    set low_stock_threshold = excluded.low_stock_threshold,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;
  return p_threshold;
end;
$$;

create or replace function public.admin_review_partner_proof(
  p_admin_id uuid,
  p_proof_id uuid,
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
  partner public.partner_profiles%rowtype;
  available_stock bigint;
  changed_rows integer;
begin
  perform public.assert_delivery_team_admin(p_admin_id, 'edit');
  if p_decision not in ('approved', 'needs_correction', 'rejected') or
    char_length(coalesce(p_review_note, '')) > 500 or
    (p_decision <> 'approved' and char_length(btrim(coalesce(p_review_note, ''))) < 3) then
    raise exception 'A valid proof decision and review note are required';
  end if;
  select * into proof from public.partner_proofs where id = p_proof_id for update;
  if not found then raise exception 'Partner proof not found'; end if;
  if proof.status = p_decision then return proof.status; end if;
  if proof.status <> 'pending' then raise exception 'Partner proof has already been reviewed'; end if;
  select * into partner from public.partner_profiles where id = proof.partner_profile_id;

  if p_decision = 'approved' then
    perform 1 from public.partner_campaign_assignments where id = proof.assignment_id for update;
    select coalesce(sum(quantity), 0) into available_stock
    from public.partner_stock_movements where assignment_id = proof.assignment_id;
    if available_stock < 1 then raise exception 'No campaign stock is available to approve this proof'; end if;
    insert into public.partner_stock_movements (
      assignment_id, partner_profile_id, movement_type, quantity, proof_id,
      notes, created_by, administrator_id, previous_balance, resulting_balance
    ) values (
      proof.assignment_id, proof.partner_profile_id, 'distributed', -1, proof.id,
      'Distributed for approved proof', p_admin_id, p_admin_id, available_stock, available_stock - 1
    ) on conflict (proof_id) where proof_id is not null do nothing;
    update public.partner_coin_ledger
      set status = 'approved',
          notes = coalesce(nullif(btrim(p_review_note), ''), 'Proof approved')
      where proof_id = proof.id and entry_type = 'earning' and status = 'pending';
    get diagnostics changed_rows = row_count;
    if changed_rows <> 1 then raise exception 'The pending proof reward ledger entry could not be verified'; end if;
  else
    update public.partner_coin_ledger
      set status = 'rejected',
          notes = btrim(p_review_note)
      where proof_id = proof.id and entry_type = 'earning' and status = 'pending';
    get diagnostics changed_rows = row_count;
    if changed_rows <> 1 then raise exception 'The pending proof reward ledger entry could not be verified'; end if;
  end if;

  update public.partner_proofs
    set status = p_decision, review_note = btrim(coalesce(p_review_note, '')),
        reviewed_at = now(), reviewed_by = p_admin_id
    where id = proof.id;

  insert into public.delivery_team_activity (
    activity_type, actor_id, partner_profile_id, partner_name, campaign_id, details, status
  ) values (
    case p_decision when 'approved' then 'Proof approved'
      when 'rejected' then 'Proof rejected' else 'Proof needs correction' end,
    p_admin_id, partner.id, partner.full_name, proof.campaign_id,
    jsonb_build_object('proofId', proof.id, 'coins', proof.coins, 'reviewNote', btrim(coalesce(p_review_note, ''))),
    p_decision
  );
  return p_decision;
end;
$$;

create or replace function public.admin_review_partner_campaign_request(
  p_admin_id uuid,
  p_request_id uuid,
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
  partner public.partner_profiles%rowtype;
  available_stock bigint;
begin
  perform public.assert_delivery_team_admin(p_admin_id, 'edit');
  if p_decision not in ('approved', 'rejected') or
    char_length(btrim(coalesce(p_review_note, ''))) not between 3 and 500 then
    raise exception 'A valid campaign request decision and review reason are required';
  end if;
  select * into request from public.partner_campaign_requests where id = p_request_id for update;
  if not found then raise exception 'Campaign request not found'; end if;
  if request.status = p_decision then return request.status; end if;
  if request.status <> 'pending' then raise exception 'Campaign request has already been reviewed'; end if;
  select * into partner from public.partner_profiles where id = request.partner_profile_id;

  if p_decision = 'approved' then
    if request.request_type = 'additional_stock' then
      if p_stock_quantity not between 1 and 1000000 then
        raise exception 'A valid physical stock quantity is required to approve this request';
      end if;
      perform 1 from public.partner_campaign_assignments where id = request.assignment_id for update;
      select coalesce(sum(quantity), 0) into available_stock
        from public.partner_stock_movements where assignment_id = request.assignment_id;
      insert into public.partner_stock_movements (
        assignment_id, partner_profile_id, movement_type, quantity, notes,
        created_by, administrator_id, previous_balance, resulting_balance
      ) values (
        request.assignment_id, request.partner_profile_id, 'issued', p_stock_quantity,
        coalesce(nullif(btrim(p_review_note), ''), 'Additional stock request approved'),
        p_admin_id, p_admin_id, available_stock, available_stock + p_stock_quantity
      );
    elsif p_stock_quantity <> 0 then
      raise exception 'Stock quantity is only valid for an additional stock request';
    end if;
  end if;

  update public.partner_campaign_requests
  set status = p_decision, review_note = btrim(coalesce(p_review_note, '')),
      reviewed_at = now(), reviewed_by = p_admin_id
  where id = request.id;

  insert into public.delivery_team_activity (
    activity_type, actor_id, partner_profile_id, partner_name, details, status
  ) values (
    case
      when request.request_type = 'additional_stock' and p_decision = 'approved' then 'Stock request approved'
      when request.request_type = 'additional_stock' then 'Stock request rejected'
      when p_decision = 'approved' then 'Campaign request approved'
      else 'Campaign request rejected'
    end,
    p_admin_id, partner.id, partner.full_name,
    jsonb_build_object(
      'requestId', request.id, 'requestType', request.request_type,
      'stockQuantity', case when request.request_type = 'additional_stock' and p_decision = 'approved' then p_stock_quantity else 0 end,
      'reviewNote', btrim(coalesce(p_review_note, ''))
    ),
    p_decision
  );
  return p_decision;
end;
$$;

create or replace function public.admin_review_partner_damage_report(
  p_admin_id uuid,
  p_report_id uuid,
  p_decision text,
  p_review_note text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report public.partner_damage_reports%rowtype;
  partner public.partner_profiles%rowtype;
  available_stock bigint;
begin
  perform public.assert_delivery_team_admin(p_admin_id, 'edit');
  if p_decision not in ('resolved', 'rejected') or
    char_length(btrim(coalesce(p_review_note, ''))) not between 3 and 500 then
    raise exception 'A valid damage report decision and review reason are required';
  end if;
  select * into report from public.partner_damage_reports where id = p_report_id for update;
  if not found then raise exception 'Damage report not found'; end if;
  if report.status = p_decision then return report.status; end if;
  if report.status <> 'pending' then raise exception 'Damage report has already been reviewed'; end if;
  select * into partner from public.partner_profiles where id = report.partner_profile_id;

  if p_decision = 'resolved' then
    perform 1 from public.partner_campaign_assignments where id = report.assignment_id for update;
    select coalesce(sum(quantity), 0) into available_stock
      from public.partner_stock_movements where assignment_id = report.assignment_id;
    if available_stock < 1 then raise exception 'No partner stock remains to record this damaged or lost card'; end if;
    insert into public.partner_stock_movements (
      assignment_id, partner_profile_id, movement_type, quantity, notes,
      created_by, administrator_id, previous_balance, resulting_balance
    ) values (
      report.assignment_id, report.partner_profile_id, 'adjusted', -1,
      'Damage/loss: ' || report.issue_type || coalesce(' · ' || nullif(report.card_id, ''), ''),
      p_admin_id, p_admin_id, available_stock, available_stock - 1
    );
  end if;

  update public.partner_damage_reports
  set status = p_decision, review_note = btrim(p_review_note),
      reviewed_at = now(), reviewed_by = p_admin_id
  where id = report.id;

  insert into public.delivery_team_activity (
    activity_type, actor_id, partner_profile_id, partner_name, details, status
  ) values (
    case when p_decision = 'resolved' then 'Damage reported' else 'Damage report rejected' end,
    p_admin_id, partner.id, partner.full_name,
    jsonb_build_object(
      'reportId', report.id, 'issueType', report.issue_type, 'cardId', report.card_id,
      'reviewNote', btrim(p_review_note)
    ),
    p_decision
  );
  return p_decision;
end;
$$;

create or replace function public.admin_review_partner_withdrawal(
  p_admin_id uuid,
  p_request_id uuid,
  p_decision text,
  p_reference text,
  p_review_note text,
  p_payout_confirmed boolean
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  withdrawal public.partner_withdrawal_requests%rowtype;
  partner public.partner_profiles%rowtype;
  ledger_status text;
begin
  perform public.assert_delivery_team_admin(p_admin_id, 'edit');
  if p_decision not in ('settled', 'rejected') or
    char_length(coalesce(p_reference, '')) > 120 or
    char_length(btrim(coalesce(p_review_note, ''))) not between 3 and 500 then
    raise exception 'A valid withdrawal decision, reference and review reason are required';
  end if;
  if p_decision = 'settled' and (p_payout_confirmed is not true or char_length(btrim(coalesce(p_reference, ''))) < 3) then
    raise exception 'Confirm the external payout and provide its reference before recording settlement';
  end if;
  select * into withdrawal
    from public.partner_withdrawal_requests where id = p_request_id for update;
  if not found then raise exception 'Withdrawal request not found'; end if;
  if withdrawal.status = p_decision then return withdrawal.status; end if;
  if withdrawal.status <> 'requested' then raise exception 'Withdrawal request has already been reviewed'; end if;
  select * into partner from public.partner_profiles where id = withdrawal.partner_profile_id;

  update public.partner_withdrawal_requests
  set status = p_decision, reference = btrim(coalesce(p_reference, '')),
      review_note = btrim(coalesce(p_review_note, '')), reviewed_at = now(), reviewed_by = p_admin_id
  where id = withdrawal.id;
  ledger_status := case when p_decision = 'settled' then 'settled' else 'rejected' end;
  update public.partner_coin_ledger
  set status = ledger_status,
      reference = coalesce(nullif(btrim(p_reference), ''), reference),
      notes = coalesce(nullif(btrim(p_review_note), ''), notes)
  where withdrawal_request_id = withdrawal.id and entry_type = 'withdrawal';

  insert into public.delivery_team_activity (
    activity_type, actor_id, partner_profile_id, partner_name, details, status
  ) values (
    case when p_decision = 'settled' then 'Withdrawal status updated' else 'Withdrawal rejected' end,
    p_admin_id, partner.id, partner.full_name,
    jsonb_build_object(
      'requestId', withdrawal.id, 'amount', withdrawal.amount,
      'reference', btrim(coalesce(p_reference, '')), 'reviewNote', btrim(coalesce(p_review_note, '')),
      'externallyConfirmed', p_decision = 'settled' and p_payout_confirmed
    ),
    p_decision
  );
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

  available_coins := public.delivery_team_available_coins(p_partner_profile_id);
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

revoke all on function public.assert_delivery_team_admin(uuid, text) from public, anon, authenticated;
revoke all on function public.delivery_team_available_coins(uuid) from public, anon, authenticated;
revoke all on function public.get_partner_coin_summary(uuid) from public, anon, authenticated;
revoke all on function public.get_delivery_team_overview(uuid) from public, anon, authenticated;
revoke all on function public.get_delivery_team_partners(uuid, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.get_delivery_team_partner_detail(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_delivery_team_campaigns(uuid) from public, anon, authenticated;
revoke all on function public.admin_adjust_partner_coins(uuid, uuid, integer, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.admin_manage_partner_stock(uuid, uuid, uuid, text, integer, text, uuid) from public, anon, authenticated;
revoke all on function public.admin_create_partner_campaign_assignment(uuid, uuid, text, text, text, date, date, integer, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.admin_update_partner_campaign_status(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_set_delivery_team_low_stock_threshold(uuid, integer) from public, anon, authenticated;
revoke all on function public.admin_review_partner_proof(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_review_partner_campaign_request(uuid, uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.admin_review_partner_damage_report(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_review_partner_withdrawal(uuid, uuid, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.request_partner_withdrawal(uuid, integer) from public, anon, authenticated;

grant execute on function public.assert_delivery_team_admin(uuid, text) to service_role;
grant execute on function public.delivery_team_available_coins(uuid) to service_role;
grant execute on function public.get_partner_coin_summary(uuid) to service_role;
grant execute on function public.get_delivery_team_overview(uuid) to service_role;
grant execute on function public.get_delivery_team_partners(uuid, text, text, integer, integer) to service_role;
grant execute on function public.get_delivery_team_partner_detail(uuid, uuid) to service_role;
grant execute on function public.get_delivery_team_campaigns(uuid) to service_role;
grant execute on function public.admin_adjust_partner_coins(uuid, uuid, integer, text, uuid, boolean) to service_role;
grant execute on function public.admin_manage_partner_stock(uuid, uuid, uuid, text, integer, text, uuid) to service_role;
grant execute on function public.admin_create_partner_campaign_assignment(uuid, uuid, text, text, text, date, date, integer, integer, integer, jsonb) to service_role;
grant execute on function public.admin_update_partner_campaign_status(uuid, uuid, text) to service_role;
grant execute on function public.admin_set_delivery_team_low_stock_threshold(uuid, integer) to service_role;
grant execute on function public.admin_review_partner_proof(uuid, uuid, text, text) to service_role;
grant execute on function public.admin_review_partner_campaign_request(uuid, uuid, text, text, integer) to service_role;
grant execute on function public.admin_review_partner_damage_report(uuid, uuid, text, text) to service_role;
grant execute on function public.admin_review_partner_withdrawal(uuid, uuid, text, text, text, boolean) to service_role;
grant execute on function public.request_partner_withdrawal(uuid, integer) to service_role;
