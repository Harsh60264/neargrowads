begin;

create table if not exists public.admin_identity_history (
  id uuid primary key,
  email text not null,
  role text not null,
  is_primary_owner boolean not null default false,
  created_at timestamptz not null,
  deleted_at timestamptz
);

insert into public.admin_identity_history (id, email, role, is_primary_owner, created_at)
select id, email, role, is_primary_owner, created_at
from public.admin_users
on conflict (id) do update
set email = excluded.email,
    role = excluded.role,
    is_primary_owner = excluded.is_primary_owner,
    created_at = excluded.created_at,
    deleted_at = null;

alter table public.admin_identity_history enable row level security;
revoke all on public.admin_identity_history from public, anon, authenticated;
grant all on public.admin_identity_history to service_role;

create or replace function public.sync_admin_identity_history()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    update public.admin_identity_history
    set email = old.email,
        role = old.role,
        is_primary_owner = old.is_primary_owner,
        deleted_at = coalesce(deleted_at, clock_timestamp())
    where id = old.id;
    return old;
  end if;

  insert into public.admin_identity_history (id, email, role, is_primary_owner, created_at, deleted_at)
  values (new.id, new.email, new.role, new.is_primary_owner, new.created_at, null)
  on conflict (id) do update
  set email = excluded.email,
      role = excluded.role,
      is_primary_owner = excluded.is_primary_owner,
      created_at = excluded.created_at,
      deleted_at = null;
  return new;
end;
$$;

revoke all on function public.sync_admin_identity_history() from public, anon, authenticated;
do $$
declare
 existing_trigger pg_catalog.pg_trigger%rowtype;
begin
 select * into existing_trigger
 from pg_catalog.pg_trigger
 where tgrelid = 'public.admin_users'::regclass
   and tgname = 'admin_users_sync_identity_history'
   and not tgisinternal;

 if found then
   if existing_trigger.tgfoid <> 'public.sync_admin_identity_history()'::regprocedure
     or existing_trigger.tgtype <> 29
     or cardinality(existing_trigger.tgattr::smallint[]) <> 0
     or existing_trigger.tgenabled <> 'O'
     or existing_trigger.tgqual is not null
     or existing_trigger.tgnargs <> 0 then
     raise exception 'Existing trigger admin_users_sync_identity_history has an unexpected definition';
   end if;
 else
   execute 'create trigger admin_users_sync_identity_history
     after insert or update or delete on public.admin_users
     for each row execute function public.sync_admin_identity_history()';
 end if;
end;
$$;

do $$
declare
  foreign_key record;
  definition text;
begin
  for foreign_key in
    select constraint_row.oid, constraint_row.conrelid, constraint_row.conname,
      array_agg(attribute_row.attname order by key_column.ordinality) as local_columns
    from pg_constraint as constraint_row
    cross join lateral unnest(constraint_row.conkey) with ordinality as key_column(attnum, ordinality)
    join pg_attribute as attribute_row
      on attribute_row.attrelid = constraint_row.conrelid
      and attribute_row.attnum = key_column.attnum
    where constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.admin_users'::regclass
    group by constraint_row.oid, constraint_row.conrelid, constraint_row.conname
  loop
    if foreign_key.conrelid = 'public.admin_sessions'::regclass
      and foreign_key.local_columns = array['user_id']::name[] then
      continue;
    end if;

    definition := pg_get_constraintdef(foreign_key.oid);
    definition := replace(
      definition,
      'REFERENCES public.admin_users(id)',
      'REFERENCES public.admin_identity_history(id)'
    );
    definition := replace(
      definition,
      'REFERENCES admin_users(id)',
      'REFERENCES public.admin_identity_history(id)'
    );
    if definition = pg_get_constraintdef(foreign_key.oid) then
      raise exception 'Could not retarget administrator identity constraint %', foreign_key.conname;
    end if;

    execute format('alter table %s drop constraint %I', foreign_key.conrelid::regclass, foreign_key.conname);
    execute format(
      'alter table %s add constraint %I %s',
      foreign_key.conrelid::regclass,
      foreign_key.conname,
      definition
    );
  end loop;
end;
$$;

create table if not exists public.admin_permanent_deletion_jobs (
  target_id uuid primary key references public.admin_identity_history(id) on delete restrict,
  actor_id uuid not null references public.admin_identity_history(id) on delete restrict,
  target_email text not null,
  status text not null check (status in ('auth_delete_pending', 'completed')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  started_at timestamptz not null default now(),
  last_attempted_at timestamptz not null default now(),
  completed_at timestamptz,
  last_error_stage text,
  last_error_code text,
  constraint admin_permanent_deletion_email_lowercase check (target_email = lower(target_email)),
  constraint admin_permanent_deletion_completion_state check (
    (status = 'completed' and completed_at is not null)
    or (status = 'auth_delete_pending' and completed_at is null)
  )
);

create table if not exists public.admin_permanent_deletion_email_reservations (
  email text primary key,
  target_id uuid not null unique
    references public.admin_permanent_deletion_jobs(target_id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint admin_permanent_deletion_reservation_email_lowercase check (email = lower(email))
);

alter table public.admin_permanent_deletion_jobs enable row level security;
alter table public.admin_permanent_deletion_email_reservations enable row level security;
revoke all on public.admin_permanent_deletion_jobs, public.admin_permanent_deletion_email_reservations
  from public, anon, authenticated;
grant all on public.admin_permanent_deletion_jobs, public.admin_permanent_deletion_email_reservations
  to service_role;

create or replace function public.lock_admin_email_reservation(p_email text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_email is null then
    raise exception 'An email is required to acquire an administrator identity lock';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(lower(p_email), 0)
  );
end;
$$;

revoke all on function public.lock_admin_email_reservation(text) from public, anon, authenticated;

create or replace function public.guard_admin_email_reservation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  email_is_reserved boolean := false;
begin
  if tg_op = 'INSERT' then
    perform public.lock_admin_email_reservation(lower(new.email));
    select exists (
      select 1
      from public.admin_permanent_deletion_email_reservations as reservation
      where reservation.email = lower(new.email)
    ) into email_is_reserved;
  elsif tg_op = 'UPDATE' and new.email is distinct from old.email then
    perform public.lock_admin_email_reservation(lower(new.email));
    select exists (
      select 1
      from public.admin_permanent_deletion_email_reservations as reservation
      where reservation.email = lower(new.email)
    ) into email_is_reserved;
  end if;

  if email_is_reserved then
    raise exception using
      errcode = '23505',
      constraint = 'admin_permanent_deletion_email_reservations_pkey',
      message = 'This email is reserved while archived administrator identity cleanup is pending.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_admin_email_reservation() from public, anon, authenticated;
do $$
declare
  existing_trigger pg_catalog.pg_trigger%rowtype;
  email_attribute smallint;
begin
  select attnum into email_attribute
  from pg_catalog.pg_attribute
  where attrelid = 'public.admin_users'::regclass
    and attname = 'email'
    and not attisdropped;

  select * into existing_trigger
  from pg_catalog.pg_trigger
  where tgrelid = 'public.admin_users'::regclass
    and tgname = 'admin_users_guard_reserved_email'
    and not tgisinternal;

  if found then
    if existing_trigger.tgfoid <> 'public.guard_admin_email_reservation()'::regprocedure
      or existing_trigger.tgtype <> 23
      or cardinality(existing_trigger.tgattr::smallint[]) <> 1
      or not existing_trigger.tgattr::smallint[] @> array[email_attribute]::smallint[]
      or existing_trigger.tgenabled <> 'O'
      or existing_trigger.tgqual is not null
      or existing_trigger.tgnargs <> 0 then
      raise exception 'Existing trigger admin_users_guard_reserved_email has an unexpected definition';
    end if;
  else
    execute 'create trigger admin_users_guard_reserved_email
      before insert or update of email on public.admin_users
      for each row execute function public.guard_admin_email_reservation()';
  end if;
end;
$$;

create or replace function public.guard_auth_email_reservation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.email is not null then
    if tg_op = 'INSERT' then
      perform public.lock_admin_email_reservation(lower(new.email));
      perform 1
      from public.admin_permanent_deletion_email_reservations as reservation
      where reservation.email = lower(new.email)
      for key share;
    elsif tg_op = 'UPDATE' and new.email is distinct from old.email then
      perform public.lock_admin_email_reservation(lower(new.email));
      perform 1
      from public.admin_permanent_deletion_email_reservations as reservation
      where reservation.email = lower(new.email)
      for key share;
    end if;

    if found then
      raise exception using
        errcode = '23505',
        constraint = 'admin_permanent_deletion_email_reservations_pkey',
        message = 'This email is reserved while archived administrator identity cleanup is pending.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_auth_email_reservation() from public, anon, authenticated;
do $$
declare
  existing_trigger pg_catalog.pg_trigger%rowtype;
  email_attribute smallint;
begin
  select attnum into email_attribute
  from pg_catalog.pg_attribute
  where attrelid = 'auth.users'::regclass
    and attname = 'email'
    and not attisdropped;

  if email_attribute is null then
    raise exception 'auth.users.email is required for archived administrator email reservations';
  end if;

  select * into existing_trigger
  from pg_catalog.pg_trigger
  where tgrelid = 'auth.users'::regclass
    and tgname = 'auth_users_guard_reserved_email'
    and not tgisinternal;

  if found then
    if existing_trigger.tgfoid <> 'public.guard_auth_email_reservation()'::regprocedure
      or existing_trigger.tgtype <> 23
      or cardinality(existing_trigger.tgattr::smallint[]) <> 1
      or not existing_trigger.tgattr::smallint[] @> array[email_attribute]::smallint[]
      or existing_trigger.tgenabled <> 'O'
      or existing_trigger.tgqual is not null
      or existing_trigger.tgnargs <> 0 then
      raise exception 'Existing trigger auth_users_guard_reserved_email has an unexpected definition';
    end if;
  else
    execute 'create trigger auth_users_guard_reserved_email
      before insert or update of email on auth.users
      for each row execute function public.guard_auth_email_reservation()';
  end if;
end;
$$;

create or replace function public.guard_admin_permanent_deletion_in_progress()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1
    from public.admin_permanent_deletion_jobs as job
    where job.target_id = old.id
      and job.status = 'auth_delete_pending'
  ) and (
    new.email is distinct from old.email
    or new.role is distinct from old.role
    or new.is_primary_owner is distinct from old.is_primary_owner
    or new.username is distinct from old.username
    or new.permissions is distinct from old.permissions
    or new.status <> 'disabled'
    or new.archived_at is null
    or new.must_change_password is distinct from old.must_change_password
    or new.temporary_password_expires_at is distinct from old.temporary_password_expires_at
    or new.temporary_password_used_at is distinct from old.temporary_password_used_at
    or new.invitation_generation is distinct from old.invitation_generation
  ) then
    raise exception using
      errcode = '55000',
      message = 'Administrator identity changes are blocked while permanent deletion is pending.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_admin_permanent_deletion_in_progress() from public, anon, authenticated;
do $$
declare
  existing_trigger pg_catalog.pg_trigger%rowtype;
begin
  select * into existing_trigger
  from pg_catalog.pg_trigger
  where tgrelid = 'public.admin_users'::regclass
    and tgname = 'admin_users_guard_pending_permanent_deletion'
    and not tgisinternal;

  if found then
    if existing_trigger.tgfoid <> 'public.guard_admin_permanent_deletion_in_progress()'::regprocedure
      or existing_trigger.tgtype <> 19
      or cardinality(existing_trigger.tgattr::smallint[]) <> 0
      or existing_trigger.tgenabled <> 'O'
      or existing_trigger.tgqual is not null
      or existing_trigger.tgnargs <> 0 then
      raise exception 'Existing trigger admin_users_guard_pending_permanent_deletion has an unexpected definition';
    end if;
  else
    execute 'create trigger admin_users_guard_pending_permanent_deletion
      before update on public.admin_users
      for each row execute function public.guard_admin_permanent_deletion_in_progress()';
  end if;
end;
$$;

create or replace function public.get_admin_permanent_deletion_state(p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  eligible_ids jsonb;
  pending_jobs jsonb;
begin
  if not exists (
    select 1 from public.admin_users
    where id = p_actor_id and role = 'owner' and status = 'active' and is_primary_owner
  ) then
    raise exception 'Primary Owner authorization required';
  end if;

  select coalesce(jsonb_agg(candidate.id order by candidate.email), '[]'::jsonb)
  into eligible_ids
  from public.admin_users as candidate
  where candidate.id <> p_actor_id
    and candidate.role <> 'owner'
    and candidate.is_primary_owner is false
    and candidate.status = 'disabled'
    and (
      candidate.archived_at is not null
      or exists (
        select 1 from public.admin_audit_logs as audit
        where audit.target_id = candidate.id and audit.action = 'admin.removed'
      )
    )
    and not exists (
      select 1 from public.admin_ownership_transfers as transfer
      where transfer.from_user_id = candidate.id or transfer.to_user_id = candidate.id
    )
    and not exists (
      select 1 from public.admin_permanent_deletion_jobs as job
      where job.target_id = candidate.id
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'targetId', job.target_id,
    'email', job.target_email,
    'status', job.status,
    'startedAt', job.started_at,
    'lastAttemptedAt', job.last_attempted_at,
    'attemptCount', job.attempt_count,
    'lastErrorStage', job.last_error_stage,
    'lastErrorCode', job.last_error_code
  ) order by job.last_attempted_at desc), '[]'::jsonb)
  into pending_jobs
  from public.admin_permanent_deletion_jobs as job
  where job.status = 'auth_delete_pending';

  return jsonb_build_object('eligibleUserIds', eligible_ids, 'pendingDeletions', pending_jobs);
end;
$$;

create or replace function public.begin_admin_permanent_deletion(
  p_actor_id uuid,
  p_target_id uuid,
  p_target_email text,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_row public.admin_users%rowtype;
  target_row public.admin_users%rowtype;
  existing_job public.admin_permanent_deletion_jobs%rowtype;
  started_at_value timestamptz := clock_timestamp();
begin
  if p_actor_id is null or p_target_id is null or p_confirmation is distinct from 'DELETE'
    or p_target_email is null or p_target_email <> lower(trim(p_target_email)) then
    return jsonb_build_object('status', 'rejected');
  end if;

  select * into actor_row
  from public.admin_users
  where id = p_actor_id and role = 'owner' and status = 'active' and is_primary_owner
  for share;
  if not found or p_actor_id = p_target_id then
    return jsonb_build_object('status', 'rejected');
  end if;

  select * into existing_job
  from public.admin_permanent_deletion_jobs
  where target_id = p_target_id
  for update;
  if found then
    if existing_job.target_email <> p_target_email then
      return jsonb_build_object('status', 'rejected');
    end if;
    if existing_job.status = 'completed' then
      return jsonb_build_object('status', 'already_completed', 'email', existing_job.target_email);
    end if;
    update public.admin_permanent_deletion_jobs
    set attempt_count = attempt_count + 1,
        last_attempted_at = started_at_value,
        last_error_stage = null,
        last_error_code = null
    where target_id = p_target_id;
    return jsonb_build_object('status', 'auth_delete_pending', 'email', existing_job.target_email);
  end if;

  select * into target_row
  from public.admin_users
  where id = p_target_id
  for update;
  if not found
    or target_row.email <> p_target_email
    or target_row.role = 'owner'
    or target_row.is_primary_owner
    or target_row.status <> 'disabled'
    or (target_row.archived_at is null and not exists (
      select 1 from public.admin_audit_logs
      where target_id = p_target_id and action = 'admin.removed'
    ))
    or exists (
      select 1 from public.admin_ownership_transfers
      where from_user_id = p_target_id or to_user_id = p_target_id
    ) then
    return jsonb_build_object('status', 'rejected');
  end if;

  select * into existing_job
  from public.admin_permanent_deletion_jobs
  where target_id = p_target_id
  for update;
  if found then
    if existing_job.target_email <> p_target_email then
      return jsonb_build_object('status', 'rejected');
    end if;
    if existing_job.status = 'completed' then
      return jsonb_build_object('status', 'already_completed', 'email', existing_job.target_email);
    end if;
    update public.admin_permanent_deletion_jobs
    set attempt_count = attempt_count + 1,
        last_attempted_at = started_at_value,
        last_error_stage = null,
        last_error_code = null
    where target_id = p_target_id;
    return jsonb_build_object('status', 'auth_delete_pending', 'email', existing_job.target_email);
  end if;

  perform public.lock_admin_email_reservation(target_row.email);

  if exists (
    select 1 from public.admin_permanent_deletion_email_reservations
    where email = target_row.email
  ) then
    return jsonb_build_object('status', 'email_reserved');
  end if;

  update public.admin_users
  set status = 'disabled',
      username = null,
      permissions = '{}'::jsonb,
      archived_at = coalesce(archived_at, started_at_value),
      must_change_password = false,
      temporary_password_expires_at = null,
      temporary_password_used_at = null,
      invitation_generation = gen_random_uuid(),
      updated_at = started_at_value
  where id = target_row.id;

  insert into public.admin_permanent_deletion_jobs (
    target_id, actor_id, target_email, status, attempt_count, started_at, last_attempted_at
  ) values (
    target_row.id, actor_row.id, target_row.email, 'auth_delete_pending', 1, started_at_value, started_at_value
  );
  insert into public.admin_permanent_deletion_email_reservations (email, target_id)
  values (target_row.email, target_row.id);

  update public.admin_sessions
  set revoked_at = started_at_value
  where user_id = target_row.id and revoked_at is null;

  insert into public.admin_audit_logs (actor_id, target_id, action, section, details, created_at)
  values (
    actor_row.id,
    target_row.id,
    'admin.permanent_deletion.started',
    'settings',
    jsonb_build_object(
      'email', target_row.email,
      'identityId', target_row.id,
      'authIdentityCleanup', 'pending',
      'cmsSessionsRevoked', true,
      'invitationInvalidated', true
    ),
    started_at_value
  );

  return jsonb_build_object('status', 'auth_delete_pending', 'email', target_row.email);
end;
$$;

create or replace function public.record_admin_permanent_deletion_failure(
  p_actor_id uuid,
  p_target_id uuid,
  p_stage text,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.admin_users
    where id = p_actor_id and role = 'owner' and status = 'active' and is_primary_owner
  ) then
    raise exception 'Primary Owner authorization required';
  end if;
  if p_stage not in ('auth_lookup', 'auth_delete', 'auth_verification', 'database_finalization') then
    raise exception 'Invalid permanent-deletion stage';
  end if;
  update public.admin_permanent_deletion_jobs
  set last_error_stage = p_stage,
      last_error_code = left(coalesce(p_error_code, 'unknown'), 80)
  where target_id = p_target_id and status = 'auth_delete_pending';
end;
$$;

create or replace function public.complete_admin_permanent_deletion(
  p_actor_id uuid,
  p_target_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_row public.admin_users%rowtype;
  job_row public.admin_permanent_deletion_jobs%rowtype;
  reserved_email text;
  completed_at_value timestamptz := clock_timestamp();
begin
  select * into actor_row
  from public.admin_users
  where id = p_actor_id and role = 'owner' and status = 'active' and is_primary_owner
  for share;
  if not found then
    return jsonb_build_object('status', 'rejected');
  end if;

  select * into job_row
  from public.admin_permanent_deletion_jobs
  where target_id = p_target_id
  for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if job_row.status = 'completed' then
    return jsonb_build_object('status', 'completed', 'email', job_row.target_email);
  end if;

  perform public.lock_admin_email_reservation(job_row.target_email);

  select reservation.email into reserved_email
  from public.admin_permanent_deletion_email_reservations as reservation
  where reservation.target_id = p_target_id
    and reservation.email = job_row.target_email
  for update;
  if not found then
    return jsonb_build_object('status', 'reservation_missing');
  end if;

  if exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = p_target_id
      or lower(auth_user.email) = job_row.target_email
  ) then
    return jsonb_build_object('status', 'auth_identity_present');
  end if;

  delete from public.admin_users
  where id = p_target_id
    and email = job_row.target_email
    and status = 'disabled'
    and archived_at is not null;
  if exists (select 1 from public.admin_users where id = p_target_id)
    or exists (select 1 from public.admin_users where email = job_row.target_email) then
    return jsonb_build_object('status', 'cleanup_unverified');
  end if;

  delete from public.admin_permanent_deletion_email_reservations
  where target_id = p_target_id and email = job_row.target_email;
  if not found then
    return jsonb_build_object('status', 'reservation_missing');
  end if;

  update public.admin_permanent_deletion_jobs
  set status = 'completed',
      completed_at = completed_at_value,
      last_attempted_at = completed_at_value,
      last_error_stage = null,
      last_error_code = null
  where target_id = p_target_id;

  insert into public.admin_audit_logs (actor_id, target_id, action, section, details, created_at)
  values (
    actor_row.id,
    p_target_id,
    'admin.permanently_deleted',
    'settings',
    jsonb_build_object(
      'email', job_row.target_email,
      'identityId', p_target_id,
      'authIdentityAbsent', true,
      'emailReusable', true,
      'originalActorId', job_row.actor_id
    ),
    completed_at_value
  );

  return jsonb_build_object('status', 'completed', 'email', job_row.target_email);
end;
$$;

revoke all on function public.get_admin_permanent_deletion_state(uuid) from public, anon, authenticated;
grant execute on function public.get_admin_permanent_deletion_state(uuid) to service_role;
revoke all on function public.begin_admin_permanent_deletion(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.begin_admin_permanent_deletion(uuid, uuid, text, text) to service_role;
revoke all on function public.record_admin_permanent_deletion_failure(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_admin_permanent_deletion_failure(uuid, uuid, text, text) to service_role;
drop function if exists public.complete_admin_permanent_deletion(uuid, uuid, boolean, boolean);
revoke all on function public.complete_admin_permanent_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_admin_permanent_deletion(uuid, uuid) to service_role;

commit;

notify pgrst, 'reload schema';
