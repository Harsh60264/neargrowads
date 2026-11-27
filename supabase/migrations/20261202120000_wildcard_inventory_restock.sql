do $$
begin
  if exists (
    with stock as (
      select partner_profile_id, sum(quantity) as on_hand
      from public.partner_stock_movements group by partner_profile_id
    ),
    reservations as (
      select partner_profile_id, count(*) as reserved
      from public.partner_proofs where status = 'pending' group by partner_profile_id
    )
    select p.id
    from public.partner_profiles p
    left join stock on stock.partner_profile_id = p.id
    left join reservations on reservations.partner_profile_id = p.id
    where coalesce(stock.on_hand, 0) < coalesce(reservations.reserved, 0)
  ) then
    raise exception 'Existing pending proofs exceed recorded physical stock; reconcile reservations before installing WildCard inventory.';
  end if;
end;
$$;

alter table public.partner_campaign_requests
  alter column assignment_id drop not null,
  add column stock_quantity integer;

alter table public.partner_campaign_requests
  drop constraint if exists partner_campaign_requests_status_check,
  add constraint partner_campaign_requests_status_check
    check (status in ('pending', 'approved', 'fulfilled', 'rejected')),
  add constraint partner_campaign_requests_stock_quantity_check
    check (
      request_type <> 'additional_stock' or stock_quantity is null or
      stock_quantity between 1 and 100
    );

alter table public.partner_stock_movements
  alter column assignment_id drop not null,
  add column campaign_request_id uuid
    references public.partner_campaign_requests(id) on delete restrict,
  add column damage_report_id uuid
    references public.partner_damage_reports(id) on delete restrict;

alter table public.partner_stock_movements
  drop constraint if exists partner_stock_movements_movement_type_check,
  add constraint partner_stock_movements_movement_type_check
    check (movement_type in ('issued', 'restocked', 'distributed', 'adjusted', 'returned', 'damaged'));

create unique index partner_stock_movements_campaign_request_unique
  on public.partner_stock_movements (campaign_request_id)
  where campaign_request_id is not null;

create unique index partner_stock_movements_damage_report_unique
  on public.partner_stock_movements (damage_report_id)
  where damage_report_id is not null;

create or replace function public.get_partner_inventory_summary(
  p_partner_profile_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with movement_totals as (
    select
      coalesce(sum(quantity), 0)::bigint as on_hand,
      coalesce(sum(quantity) filter (
        where movement_type in ('issued', 'restocked', 'adjusted') and quantity > 0
      ), 0)::bigint as total_received,
      coalesce(sum(quantity) filter (where movement_type = 'issued' and quantity > 0), 0)::bigint as issued,
      coalesce(sum(quantity) filter (where movement_type = 'restocked' and quantity > 0), 0)::bigint as restocked,
      coalesce(sum(-quantity) filter (where movement_type = 'distributed' and quantity < 0), 0)::bigint as delivered,
      coalesce(sum(-quantity) filter (
        where (movement_type = 'damaged' or
          (movement_type = 'adjusted' and notes like 'Damage/loss:%')) and quantity < 0
      ), 0)::bigint as damaged,
      coalesce(sum(-quantity) filter (where movement_type = 'returned' and quantity < 0), 0)::bigint as returned
    from public.partner_stock_movements
    where partner_profile_id = p_partner_profile_id
  ),
  reservations as (
    select count(*)::bigint as reserved
    from public.partner_proofs
    where partner_profile_id = p_partner_profile_id and status = 'pending'
  )
  select jsonb_build_object(
    'totalReceived', movement_totals.total_received,
    'available', greatest(0::bigint, movement_totals.on_hand - reservations.reserved),
    'delivered', movement_totals.delivered,
    'reserved', reservations.reserved,
    'damaged', movement_totals.damaged,
    'returned', movement_totals.returned,
    'issued', movement_totals.issued,
    'restocked', movement_totals.restocked,
    'progressPercent', case
      when movement_totals.total_received > 0 then
        least(100, floor(movement_totals.delivered * 100.0 / movement_totals.total_received)::integer)
      else 0
    end
  )
  from movement_totals cross join reservations;
$$;

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
        and assignment_id = new.assignment_id and status = 'pending'
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

create trigger partner_stock_movements_inventory_guard
  before insert on public.partner_stock_movements
  for each row execute function public.enforce_partner_stock_movement();

create or replace function public.request_partner_restock(
  p_partner_profile_id uuid,
  p_quantity integer,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_id uuid;
  inventory jsonb;
begin
  perform 1 from public.partner_profiles
  where id = p_partner_profile_id and status = 'active' for update;
  if not found then raise exception 'Active partner profile not found'; end if;
  if p_quantity not between 1 and 100 or
    char_length(btrim(coalesce(p_reason, ''))) > 500 or
    (btrim(coalesce(p_reason, '')) <> '' and
      char_length(btrim(p_reason)) not between 3 and 500) then
    raise exception 'A restock quantity between 1 and 100 and a valid optional reason are required';
  end if;
  if exists (
    select 1 from public.partner_campaign_requests
    where partner_profile_id = p_partner_profile_id
      and request_type = 'additional_stock' and status = 'pending'
  ) then
    raise exception 'A restock request is already pending';
  end if;

  inventory := public.get_partner_inventory_summary(p_partner_profile_id);
  if (inventory ->> 'available')::bigint > 10 then
    raise exception 'Restock requests are available when stock reaches 10 cards or fewer';
  end if;

  insert into public.partner_campaign_requests (
    assignment_id, partner_profile_id, request_type, details, stock_quantity
  ) values (
    null, p_partner_profile_id, 'additional_stock',
    coalesce(nullif(btrim(p_reason), ''), 'Partner requested a restock of ' || p_quantity || ' WildCards'),
    p_quantity
  ) returning id into request_id;

  insert into public.delivery_team_activity (
    activity_type, partner_profile_id, partner_name, details, status
  )
  select 'WildCard restock requested', partner.id, partner.full_name,
    jsonb_build_object('requestId', request_id, 'quantity', p_quantity, 'reason', btrim(coalesce(p_reason, ''))),
    'pending'
  from public.partner_profiles partner where partner.id = p_partner_profile_id;

  return request_id;
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
  reserved_count bigint;
  movement_id uuid;
begin
  perform public.assert_delivery_team_admin(p_admin_id, 'edit');
  if p_movement_type not in ('issued', 'restocked', 'returned', 'adjusted', 'damaged') or
    p_quantity = 0 or abs(p_quantity::bigint) > 1000000 or p_idempotency_key is null or
    char_length(btrim(coalesce(p_notes, ''))) not between 3 and 500 or
    (p_movement_type in ('issued', 'restocked') and p_quantity < 1) or
    (p_movement_type in ('returned', 'damaged') and p_quantity > -1) then
    raise exception 'A valid stock movement, quantity, reason and idempotency key are required';
  end if;
  if p_movement_type in ('issued', 'restocked') and p_quantity > 100 then
    raise exception 'An issue or restock transaction cannot exceed 100 WildCards';
  end if;

  select * into partner from public.partner_profiles where id = p_partner_profile_id for update;
  if not found then raise exception 'Delivery partner not found'; end if;
  if p_assignment_id is not null then
    select * into assignment from public.partner_campaign_assignments
    where id = p_assignment_id and partner_profile_id = p_partner_profile_id for update;
    if not found then raise exception 'Campaign assignment does not belong to this partner'; end if;
  end if;

  select * into prior_movement from public.partner_stock_movements where idempotency_key = p_idempotency_key;
  if found then
    if prior_movement.partner_profile_id <> p_partner_profile_id or
      prior_movement.assignment_id is distinct from p_assignment_id or
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

  select coalesce(sum(quantity), 0) into previous_balance
  from public.partner_stock_movements where partner_profile_id = p_partner_profile_id;
  select count(*) into reserved_count
  from public.partner_proofs where partner_profile_id = p_partner_profile_id and status = 'pending';
  resulting_balance := previous_balance + p_quantity;
  if resulting_balance < reserved_count then
    raise exception 'This movement would make unreserved partner stock negative';
  end if;

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
    case p_movement_type
      when 'issued' then 'WildCard stock issued'
      when 'restocked' then 'WildCard stock restocked'
      when 'returned' then 'WildCard stock returned'
      when 'damaged' then 'WildCard stock marked damaged or lost'
      else 'WildCard stock adjusted'
    end,
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
  approved_quantity integer;
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

  if request.request_type = 'additional_stock' then
    if p_decision = 'approved' then
      approved_quantity := coalesce(request.stock_quantity, p_stock_quantity);
      if approved_quantity not between 1 and 100 or
        (request.stock_quantity is not null and p_stock_quantity <> request.stock_quantity) then
        raise exception 'The approved restock quantity must match the request and be between 1 and 100';
      end if;
      update public.partner_campaign_requests
      set stock_quantity = approved_quantity
      where id = request.id;
    end if;
  elsif p_stock_quantity <> 0 then
    raise exception 'Stock quantity is only valid for an additional stock request';
  end if;

  update public.partner_campaign_requests
  set status = p_decision, review_note = btrim(p_review_note),
      reviewed_at = now(), reviewed_by = p_admin_id
  where id = request.id;

  insert into public.delivery_team_activity (
    activity_type, actor_id, partner_profile_id, partner_name, details, status
  ) values (
    case
      when request.request_type = 'additional_stock' and p_decision = 'approved' then 'WildCard restock approved'
      when request.request_type = 'additional_stock' then 'WildCard restock rejected'
      when p_decision = 'approved' then 'Campaign request approved'
      else 'Campaign request rejected'
    end,
    p_admin_id, partner.id, partner.full_name,
    jsonb_build_object(
      'requestId', request.id, 'requestType', request.request_type,
      'stockQuantity', case when request.request_type = 'additional_stock' then approved_quantity else 0 end,
      'reviewNote', btrim(p_review_note)
    ),
    p_decision
  );
  return p_decision;
end;
$$;

create or replace function public.admin_handover_partner_restock(
  p_admin_id uuid,
  p_request_id uuid,
  p_review_note text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request public.partner_campaign_requests%rowtype;
  partner public.partner_profiles%rowtype;
  previous_balance bigint;
  resulting_balance bigint;
begin
  perform public.assert_delivery_team_admin(p_admin_id, 'edit');
  if char_length(btrim(coalesce(p_review_note, ''))) not between 3 and 500 then
    raise exception 'A handover confirmation note is required';
  end if;
  select * into request from public.partner_campaign_requests where id = p_request_id for update;
  if not found or request.request_type <> 'additional_stock' then
    raise exception 'Restock request not found';
  end if;
  if request.status = 'fulfilled' then return request.status; end if;
  if request.status <> 'approved' then raise exception 'Only an approved restock can be handed over'; end if;
  if request.stock_quantity not between 1 and 100 then
    raise exception 'The approved restock quantity is invalid';
  end if;

  select * into partner from public.partner_profiles where id = request.partner_profile_id for update;
  if not found then raise exception 'Delivery partner not found'; end if;
  select coalesce(sum(quantity), 0) into previous_balance
  from public.partner_stock_movements where partner_profile_id = partner.id;
  resulting_balance := previous_balance + request.stock_quantity;

  insert into public.partner_stock_movements (
    partner_profile_id, movement_type, quantity, notes, created_by,
    administrator_id, previous_balance, resulting_balance, campaign_request_id
  ) values (
    partner.id, 'restocked', request.stock_quantity, btrim(p_review_note), p_admin_id,
    p_admin_id, previous_balance, resulting_balance, request.id
  );

  update public.partner_campaign_requests
  set status = 'fulfilled', review_note = btrim(p_review_note),
      reviewed_at = now(), reviewed_by = p_admin_id
  where id = request.id and status = 'approved';

  insert into public.delivery_team_activity (
    activity_type, actor_id, partner_profile_id, partner_name, details, status
  ) values (
    'WildCard restock handed over', p_admin_id, partner.id, partner.full_name,
    jsonb_build_object(
      'requestId', request.id, 'quantity', request.stock_quantity,
      'previousBalance', previous_balance, 'resultingBalance', resulting_balance,
      'confirmation', btrim(p_review_note)
    ),
    'fulfilled'
  );
  return 'fulfilled';
end;
$$;

create or replace function public.apply_partner_proof_review(
  p_proof_id uuid,
  p_reviewer_id uuid,
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
  current_balance bigint;
  reserved_count bigint;
  changed_rows integer;
begin
  if p_decision not in ('approved', 'needs_correction', 'rejected') or
    char_length(coalesce(p_review_note, '')) > 500 or
    (p_decision <> 'approved' and char_length(btrim(coalesce(p_review_note, ''))) < 3) then
    raise exception 'A valid proof decision and review note are required';
  end if;
  select * into proof from public.partner_proofs where id = p_proof_id for update;
  if not found then raise exception 'Partner proof not found'; end if;
  if proof.status = p_decision then return proof.status; end if;
  if proof.status <> 'pending' then raise exception 'Partner proof has already been reviewed'; end if;
  select * into partner from public.partner_profiles where id = proof.partner_profile_id for update;
  if not found then raise exception 'Delivery partner not found'; end if;

  if p_decision = 'approved' then
    select coalesce(sum(quantity), 0) into current_balance
    from public.partner_stock_movements where partner_profile_id = partner.id;
    select count(*) into reserved_count
    from public.partner_proofs where partner_profile_id = partner.id and status = 'pending';
    if current_balance < reserved_count then
      raise exception 'A reserved WildCard is not backed by physical stock';
    end if;
    if exists (select 1 from public.partner_stock_movements where proof_id = proof.id) then
      raise exception 'This proof already has a stock movement';
    end if;

    insert into public.partner_stock_movements (
      assignment_id, partner_profile_id, movement_type, quantity, proof_id, notes,
      created_by, administrator_id, previous_balance, resulting_balance
    ) values (
      proof.assignment_id, partner.id, 'distributed', -1, proof.id,
      'Distributed for approved proof', p_reviewer_id, p_reviewer_id,
      current_balance, current_balance - 1
    );

    update public.partner_coin_ledger
    set amount = 1000, status = 'approved',
        notes = coalesce(nullif(btrim(p_review_note), ''), 'Proof approved; 1,000 NGA Coins credited')
    where proof_id = proof.id and entry_type = 'earning' and status = 'pending';
    get diagnostics changed_rows = row_count;
    if changed_rows <> 1 then raise exception 'The pending proof reward ledger entry could not be verified'; end if;

    update public.partner_proofs
    set coins = 1000, status = p_decision, review_note = btrim(coalesce(p_review_note, '')),
        reviewed_at = now(), reviewed_by = p_reviewer_id
    where id = proof.id;
  else
    update public.partner_coin_ledger
    set status = 'rejected',
        notes = coalesce(nullif(btrim(p_review_note), ''), 'Proof requires correction')
    where proof_id = proof.id and entry_type = 'earning' and status = 'pending';
    get diagnostics changed_rows = row_count;
    if changed_rows <> 1 then raise exception 'The pending proof reward ledger entry could not be verified'; end if;

    update public.partner_proofs
    set status = p_decision, review_note = btrim(coalesce(p_review_note, '')),
        reviewed_at = now(), reviewed_by = p_reviewer_id
    where id = proof.id;
  end if;

  insert into public.delivery_team_activity (
    activity_type, actor_id, partner_profile_id, partner_name, campaign_id, details, status
  ) values (
    case p_decision when 'approved' then 'Proof approved'
      when 'rejected' then 'Proof rejected' else 'Proof needs correction' end,
    p_reviewer_id, partner.id, partner.full_name, proof.campaign_id,
    jsonb_build_object(
      'proofId', proof.id, 'coins', case when p_decision = 'approved' then 1000 else 0 end,
      'reviewNote', btrim(coalesce(p_review_note, ''))
    ),
    p_decision
  );
  return p_decision;
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
begin
  perform public.assert_delivery_team_admin(p_admin_id, 'edit');
  return public.apply_partner_proof_review(p_proof_id, p_admin_id, p_decision, p_review_note);
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
begin
  if not exists (
    select 1 from public.admin_users
    where id = p_owner_id and is_primary_owner = true and status = 'active' and role = 'owner'
  ) then raise exception 'Only the active Primary Owner can review partner proofs'; end if;
  return public.apply_partner_proof_review(p_proof_id, p_owner_id, p_decision, p_review_note);
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
  partner public.partner_profiles%rowtype;
  approved_quantity integer;
begin
  if not exists (
    select 1 from public.admin_users
    where id = p_owner_id and is_primary_owner = true and status = 'active' and role = 'owner'
  ) then raise exception 'Only the active Primary Owner can review campaign requests'; end if;
  if p_decision not in ('approved', 'rejected') or
    char_length(btrim(coalesce(p_review_note, ''))) not between 3 and 500 then
    raise exception 'A valid campaign request decision and review note are required';
  end if;
  select * into request from public.partner_campaign_requests where id = p_request_id for update;
  if not found then raise exception 'Campaign request not found'; end if;
  if request.status = p_decision then return request.status; end if;
  if request.status <> 'pending' then raise exception 'Campaign request has already been reviewed'; end if;
  select * into partner from public.partner_profiles where id = request.partner_profile_id;

  if request.request_type = 'additional_stock' then
    if p_decision = 'approved' then
      approved_quantity := coalesce(request.stock_quantity, p_stock_quantity);
      if approved_quantity not between 1 and 100 or
        (request.stock_quantity is not null and p_stock_quantity <> request.stock_quantity) then
        raise exception 'The approved restock quantity must match the request and be between 1 and 100';
      end if;
      update public.partner_campaign_requests set stock_quantity = approved_quantity
      where id = request.id;
    end if;
  elsif p_stock_quantity <> 0 then
    raise exception 'Stock quantity is only valid for an additional stock request';
  end if;

  update public.partner_campaign_requests
  set status = p_decision, review_note = btrim(p_review_note),
      reviewed_at = now(), reviewed_by = p_owner_id
  where id = request.id;

  insert into public.delivery_team_activity (
    activity_type, actor_id, partner_profile_id, partner_name, details, status
  ) values (
    case when request.request_type = 'additional_stock' and p_decision = 'approved'
      then 'WildCard restock approved' else 'Campaign request reviewed' end,
    p_owner_id, partner.id, partner.full_name,
    jsonb_build_object(
      'requestId', request.id, 'requestType', request.request_type,
      'quantity', approved_quantity, 'reviewNote', btrim(p_review_note)
    ),
    p_decision
  );
  return p_decision;
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
  current_balance bigint;
  reserved_count bigint;
begin
  perform 1 from public.partner_profiles
  where id = p_partner_profile_id and status = 'active' for update;
  if not found then raise exception 'Active partner profile not found'; end if;

  select * into assignment
  from public.partner_campaign_assignments
  where id = p_assignment_id and partner_profile_id = p_partner_profile_id and active = true
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
    (p_latitude is not null and
      (p_latitude not between -90 and 90 or p_longitude not between -180 and 180)) then
    raise exception 'The captured location is invalid';
  end if;
  if char_length(coalesce(p_note, '')) > 200 then raise exception 'The proof note is too long'; end if;

  select coalesce(sum(quantity), 0) into current_balance
  from public.partner_stock_movements where partner_profile_id = p_partner_profile_id;
  select count(*) into reserved_count
  from public.partner_proofs where partner_profile_id = p_partner_profile_id and status = 'pending';
  if current_balance - reserved_count < 1 then
    raise exception 'No unreserved WildCard stock is available';
  end if;

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
    coalesce(p_note, ''), p_latitude, p_longitude, 1000
  ) returning id into proof_id;

  insert into public.partner_coin_ledger (
    partner_profile_id, campaign_id, proof_id, entry_type, amount, status, reference, notes
  ) values (
    p_partner_profile_id, campaign.id, proof_id, 'earning', 1000,
    'pending', campaign.name, 'Proof submitted; one WildCard reserved pending review'
  );
  return proof_id;
end;
$$;

create or replace function public.apply_partner_damage_report_review(
  p_report_id uuid,
  p_reviewer_id uuid,
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
  previous_balance bigint;
  reserved_count bigint;
  movement_kind text;
begin
  if p_decision not in ('resolved', 'rejected') or
    char_length(btrim(coalesce(p_review_note, ''))) not between 3 and 500 then
    raise exception 'A valid damage report outcome and review note are required';
  end if;
  select * into report from public.partner_damage_reports where id = p_report_id for update;
  if not found then raise exception 'Damage report not found'; end if;
  if report.status = p_decision then return report.status; end if;
  if report.status <> 'pending' then raise exception 'Damage report has already been reviewed'; end if;
  select * into partner from public.partner_profiles where id = report.partner_profile_id for update;
  if not found then raise exception 'Delivery partner not found'; end if;

  if p_decision = 'resolved' then
    select coalesce(sum(quantity), 0) into previous_balance
    from public.partner_stock_movements where partner_profile_id = partner.id;
    select count(*) into reserved_count
    from public.partner_proofs where partner_profile_id = partner.id and status = 'pending';
    if previous_balance - reserved_count < 1 then
      raise exception 'No unreserved partner stock remains to record this damage or loss';
    end if;
    movement_kind := case when report.issue_type = 'lost' then 'adjusted' else 'damaged' end;
    insert into public.partner_stock_movements (
      assignment_id, partner_profile_id, movement_type, quantity, notes,
      created_by, administrator_id, previous_balance, resulting_balance, damage_report_id
    ) values (
      report.assignment_id, partner.id, movement_kind, -1,
      'Damage/loss: ' || report.issue_type ||
        coalesce(' · ' || nullif(report.card_id, ''), '') ||
        ' · ' || btrim(p_review_note),
      p_reviewer_id, p_reviewer_id, previous_balance, previous_balance - 1, report.id
    );
  end if;

  update public.partner_damage_reports
  set status = p_decision, review_note = btrim(p_review_note),
      reviewed_at = now(), reviewed_by = p_reviewer_id
  where id = report.id;

  insert into public.delivery_team_activity (
    activity_type, actor_id, partner_profile_id, partner_name, details, status
  ) values (
    case when p_decision = 'resolved' then 'Damage or loss recorded' else 'Damage report rejected' end,
    p_reviewer_id, partner.id, partner.full_name,
    jsonb_build_object(
      'reportId', report.id, 'issueType', report.issue_type, 'cardId', report.card_id,
      'reviewNote', btrim(p_review_note)
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
begin
  perform public.assert_delivery_team_admin(p_admin_id, 'edit');
  return public.apply_partner_damage_report_review(p_report_id, p_admin_id, p_decision, p_review_note);
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
begin
  if not exists (
    select 1 from public.admin_users
    where id = p_owner_id and is_primary_owner = true and status = 'active' and role = 'owner'
  ) then raise exception 'Only the active Primary Owner can review damage reports'; end if;
  return public.apply_partner_damage_report_review(
    p_report_id,
    p_owner_id,
    p_decision,
    case when p_decision = 'resolved' then 'Damage or loss confirmed' else 'Damage report rejected by the owner' end
  );
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
  inventory jsonb;
begin
  perform public.assert_delivery_team_admin(p_admin_id, 'view');
  select * into partner_row from public.partner_profiles where id = p_partner_profile_id;
  if not found then raise exception 'Delivery partner not found'; end if;
  inventory := public.get_partner_inventory_summary(partner_row.id);

  select jsonb_build_object(
    'partner', to_jsonb(partner_row) || jsonb_build_object(
      'available_coins', public.delivery_team_available_coins(partner_row.id),
      'remaining_stock', (inventory ->> 'available')::bigint,
      'reserved_stock', (inventory ->> 'reserved')::bigint,
      'pending_requests',
        (select count(*) from public.partner_campaign_requests
          where partner_profile_id = partner_row.id and status in ('pending', 'approved')) +
        (select count(*) from public.partner_damage_reports
          where partner_profile_id = partner_row.id and status = 'pending') +
        (select count(*) from public.partner_withdrawal_requests
          where partner_profile_id = partner_row.id and status = 'requested')
    ),
    'coinSummary', public.get_partner_coin_summary(partner_row.id),
    'coinHistory', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at desc, l.id desc)
      from public.partner_coin_ledger l where l.partner_profile_id = partner_row.id
    ), '[]'::jsonb),
    'stockSummary', inventory,
    'stockHistory', coalesce((
      select jsonb_agg(
        to_jsonb(m) || jsonb_build_object('campaign_name', coalesce(c.name, 'Partner-wide inventory'))
        order by m.created_at desc, m.id desc
      )
      from public.partner_stock_movements m
      left join public.partner_campaign_assignments a on a.id = m.assignment_id
      left join public.partner_campaigns c on c.id = a.campaign_id
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
    select p.* from public.partner_profiles p
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
      (inventory.summary ->> 'available')::bigint as remaining_stock,
      (inventory.summary ->> 'reserved')::bigint as reserved_stock,
      (inventory.summary ->> 'totalReceived')::bigint as total_received_stock,
      (inventory.summary ->> 'delivered')::bigint as delivered_stock,
      (inventory.summary ->> 'damaged')::bigint as damaged_stock,
      (inventory.summary ->> 'returned')::bigint as returned_stock,
      (
        select count(*) from public.partner_campaign_requests r
        where r.partner_profile_id = p.id and r.status in ('pending', 'approved')
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
      select a.id, a.campaign_id from public.partner_campaign_assignments a
      where a.partner_profile_id = p.id and a.active = true
      order by a.created_at desc limit 1
    ) ca on true
    left join public.partner_campaigns c on c.id = ca.campaign_id
    cross join lateral (
      select public.get_partner_inventory_summary(p.id) as summary
    ) inventory
    order by p.created_at desc, p.id
    limit p_page_size offset (p_page - 1) * p_page_size
  )
  select jsonb_build_object(
    'total', coalesce((select max(full_count) from page_rows), (select count(*) from filtered)),
    'partners', coalesce((
      select jsonb_agg(to_jsonb(r) - 'full_count' order by r.created_at desc, r.id)
      from page_rows r
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_partner_inventory_summary(uuid) from public, anon, authenticated;
revoke all on function public.enforce_partner_stock_movement() from public, anon, authenticated;
revoke all on function public.request_partner_restock(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.admin_handover_partner_restock(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.apply_partner_proof_review(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.apply_partner_damage_report_review(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_delivery_team_partners(uuid, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.get_delivery_team_partner_detail(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_manage_partner_stock(uuid, uuid, uuid, text, integer, text, uuid) from public, anon, authenticated;
revoke all on function public.admin_review_partner_proof(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.review_partner_proof(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.review_partner_campaign_request(uuid, uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.submit_partner_proof(uuid, uuid, uuid, text, text, double precision, double precision) from public, anon, authenticated;
revoke all on function public.admin_review_partner_campaign_request(uuid, uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.admin_review_partner_damage_report(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.review_partner_damage_report(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.get_partner_inventory_summary(uuid) to service_role;
grant execute on function public.request_partner_restock(uuid, integer, text) to service_role;
grant execute on function public.admin_handover_partner_restock(uuid, uuid, text) to service_role;
grant execute on function public.admin_manage_partner_stock(uuid, uuid, uuid, text, integer, text, uuid) to service_role;
grant execute on function public.admin_review_partner_proof(uuid, uuid, text, text) to service_role;
grant execute on function public.review_partner_proof(uuid, uuid, text, text) to service_role;
grant execute on function public.review_partner_campaign_request(uuid, uuid, text, text, integer) to service_role;
grant execute on function public.submit_partner_proof(uuid, uuid, uuid, text, text, double precision, double precision) to service_role;
grant execute on function public.admin_review_partner_campaign_request(uuid, uuid, text, text, integer) to service_role;
grant execute on function public.admin_review_partner_damage_report(uuid, uuid, text, text) to service_role;
grant execute on function public.review_partner_damage_report(uuid, uuid, text) to service_role;
