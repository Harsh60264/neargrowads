begin;

do $$
begin
  if current_database() !~ '^admin_delete_test_' then
    raise exception 'This destructive regression test is restricted to admin_delete_test_* databases';
  end if;
  if to_regprocedure('public.complete_admin_permanent_deletion(uuid,uuid,boolean,boolean)') is not null then
    raise exception 'Legacy caller-trusted completion RPC must not exist';
  end if;
end;
$$;

do $$
declare
  v_actor_id uuid := '91000000-0000-4000-8000-000000000001';
  v_target_id uuid := '91000000-0000-4000-8000-000000000002';
  v_competing_id uuid := '91000000-0000-4000-8000-000000000003';
  result jsonb;
begin
  insert into auth.users (id, email) values
    (v_actor_id, 'race-owner@example.test'),
    (v_target_id, 'race-archived@example.test');

  insert into public.admin_users (id, email, role, status, is_primary_owner, archived_at)
  values
    (v_actor_id, 'race-owner@example.test', 'owner', 'active', true, null),
    (v_target_id, 'race-archived@example.test', 'custom_admin', 'disabled', false, clock_timestamp());

  result := public.begin_admin_permanent_deletion(
    v_actor_id, v_target_id, 'race-archived@example.test', 'DELETE'
  );
  if result->>'status' <> 'auth_delete_pending' then
    raise exception 'Synthetic archived identity could not begin deletion: %', result;
  end if;

  delete from auth.users where id = v_target_id;
  if exists (select 1 from auth.users where id = v_target_id or lower(email) = 'race-archived@example.test') then
    raise exception 'The test must model the server-side Auth absence check before the race';
  end if;

  -- The server-side Auth absence check completed; a competing Auth insert races before the completion RPC.
  begin
    insert into auth.users (id, email)
    values (v_competing_id, 'race-archived@example.test');
    raise exception 'Competing Auth identity unexpectedly bypassed the deletion email reservation';
  exception
    when unique_violation then
      if sqlerrm not like '%reserved while archived administrator identity cleanup is pending%' then
        raise;
      end if;
  end;

  if exists (select 1 from auth.users where id = v_competing_id) then
    raise exception 'Competing Auth identity persisted while deletion was pending';
  end if;

  result := public.complete_admin_permanent_deletion(v_actor_id, v_target_id);
  if result->>'status' <> 'completed' then
    raise exception 'Deletion did not finalize after protected Auth absence: %', result;
  end if;
  if exists (
    select 1 from public.admin_permanent_deletion_email_reservations
    where email = 'race-archived@example.test'
  ) then
    raise exception 'Reservation was not released after cleanup was verified';
  end if;

  insert into auth.users (id, email)
  values (v_competing_id, 'race-archived@example.test');
  insert into public.admin_users (id, email, role, status, is_primary_owner, invited_by)
  values (v_competing_id, 'race-archived@example.test', 'custom_admin', 'pending', false, v_actor_id);

  if not exists (
    select 1 from public.admin_identity_history
    where id = v_target_id and deleted_at is not null
  ) then
    raise exception 'Historical identity was not retained';
  end if;
  if not exists (
    select 1 from public.admin_audit_logs as audit
    where audit.target_id = v_target_id
      and audit.actor_id = v_actor_id
      and audit.action = 'admin.permanently_deleted'
  ) then
    raise exception 'Deletion audit attribution was not retained';
  end if;
  if not exists (
    select 1 from public.admin_users
    where id = v_competing_id and email = 'race-archived@example.test'
  ) then
    raise exception 'Email was not reusable after verified cleanup';
  end if;

  raise notice 'email_reusable_only_after_cleanup: PASS';
end;
$$;

do $$
declare
  v_actor_id uuid := '91000000-0000-4000-8000-000000000001';
  v_target_id uuid := '91000000-0000-4000-8000-000000000004';
  result jsonb;
begin
  insert into auth.users (id, email)
  values ('91000000-0000-4000-8000-000000000005', 'direct-check@example.test');
  insert into public.admin_identity_history (id, email, role, is_primary_owner, created_at, deleted_at)
  values (v_target_id, 'direct-check@example.test', 'custom_admin', false, clock_timestamp(), clock_timestamp());
  insert into public.admin_permanent_deletion_jobs (target_id, actor_id, target_email, status)
  values (v_target_id, v_actor_id, 'direct-check@example.test', 'auth_delete_pending');
  insert into public.admin_permanent_deletion_email_reservations (email, target_id)
  values ('direct-check@example.test', v_target_id);

  result := public.complete_admin_permanent_deletion(v_actor_id, v_target_id);
  if result->>'status' <> 'auth_identity_present' then
    raise exception 'Completion trusted stale verification instead of checking auth.users: %', result;
  end if;
  if not exists (
    select 1 from public.admin_permanent_deletion_email_reservations
    where email = 'direct-check@example.test' and target_id = v_target_id
  ) then
    raise exception 'Direct Auth identity check did not retain the reservation';
  end if;
  if (select status from public.admin_permanent_deletion_jobs where target_id = v_target_id)
    <> 'auth_delete_pending' then
    raise exception 'Direct Auth identity check incorrectly completed the job';
  end if;
end;
$$;

do $$
declare
  v_actor_id uuid := '91000000-0000-4000-8000-000000000001';
  v_co_owner_id uuid := '91100000-0000-4000-8000-000000000001';
  v_active_id uuid := '91100000-0000-4000-8000-000000000002';
  v_transfer_id uuid := '91100000-0000-4000-8000-000000000003';
  result jsonb;
  candidate record;
begin
  insert into auth.users (id, email) values
    (v_co_owner_id, 'race-coowner@example.test'),
    (v_active_id, 'race-active@example.test'),
    (v_transfer_id, 'race-transfer@example.test');
  insert into public.admin_users (id, email, role, status, is_primary_owner, archived_at)
  values
    (v_co_owner_id, 'race-coowner@example.test', 'owner', 'active', false, null),
    (v_active_id, 'race-active@example.test', 'super_admin', 'active', false, null),
    (v_transfer_id, 'race-transfer@example.test', 'custom_admin', 'disabled', false, clock_timestamp());
  insert into public.admin_ownership_transfers (from_user_id, to_user_id, status)
  values (v_actor_id, v_transfer_id, 'cancelled');

  for candidate in
    select id, email
    from public.admin_users
    where id in (v_actor_id, v_co_owner_id, v_active_id, v_transfer_id)
  loop
    result := public.begin_admin_permanent_deletion(
      v_actor_id, candidate.id, candidate.email, 'DELETE'
    );
    if result->>'status' <> 'rejected' then
      raise exception 'Protected identity % was accepted for deletion: %', candidate.id, result;
    end if;
  end loop;

  if exists (
    select 1 from public.admin_permanent_deletion_jobs
    where target_id in (v_actor_id, v_co_owner_id, v_active_id, v_transfer_id)
  ) then
    raise exception 'A protected identity received a deletion job';
  end if;
end;
$$;

do $$
declare
  v_actor_id uuid := '91000000-0000-4000-8000-000000000001';
  v_target_id uuid := '91200000-0000-4000-8000-000000000002';
  v_session_id uuid := '91200000-0000-4000-8000-000000000003';
  v_retry_count integer;
  result jsonb;
begin
  insert into auth.users (id, email)
  values (v_target_id, 'retry-admin@example.test');
  insert into public.admin_users (
    id, email, role, status, is_primary_owner, username, permissions,
    must_change_password, temporary_password_expires_at, invitation_generation,
    archived_at
  ) values (
    v_target_id, 'retry-admin@example.test', 'custom_admin', 'disabled', false,
    'retry.admin', '{"blogs":{"view":true}}', true, clock_timestamp() + interval '1 hour',
    '91200000-0000-4000-8000-000000000004', clock_timestamp()
  );
  insert into public.admin_sessions (id, user_id, expires_at)
  values (v_session_id, v_target_id, clock_timestamp() + interval '1 hour');

  result := public.begin_admin_permanent_deletion(
    v_actor_id, v_target_id, 'retry-admin@example.test', 'DELETE'
  );
  if result->>'status' <> 'auth_delete_pending' then
    raise exception 'Retry fixture could not begin deletion: %', result;
  end if;
  if exists (
    select 1 from public.admin_sessions where id = v_session_id and revoked_at is null
  ) then
    raise exception 'CMS session was not revoked';
  end if;
  if exists (
    select 1 from public.admin_users
    where id = v_target_id
      and (username is not null or permissions <> '{}'::jsonb or must_change_password
        or temporary_password_expires_at is not null)
  ) then
    raise exception 'Invitation or temporary-password state was not invalidated';
  end if;

  result := public.complete_admin_permanent_deletion(v_actor_id, v_target_id);
  if result->>'status' <> 'auth_identity_present' then
    raise exception 'Partial Auth failure was not kept pending: %', result;
  end if;
  perform public.record_admin_permanent_deletion_failure(
    v_actor_id, v_target_id, 'auth_delete', 'synthetic_auth_timeout'
  );
  result := public.begin_admin_permanent_deletion(
    v_actor_id, v_target_id, 'retry-admin@example.test', 'DELETE'
  );
  if result->>'status' <> 'auth_delete_pending' then
    raise exception 'Retry was not idempotently resumed: %', result;
  end if;
  select attempt_count into v_retry_count
  from public.admin_permanent_deletion_jobs where target_id = v_target_id;
  if v_retry_count <> 2 then
    raise exception 'Retry counter mismatch: %', v_retry_count;
  end if;

  delete from auth.users where id = v_target_id;
  result := public.complete_admin_permanent_deletion(v_actor_id, v_target_id);
  if result->>'status' <> 'completed' then
    raise exception 'Deletion retry did not finalize: %', result;
  end if;
  result := public.complete_admin_permanent_deletion(v_actor_id, v_target_id);
  if result->>'status' <> 'completed' then
    raise exception 'Repeated completion was not idempotent: %', result;
  end if;
  if not exists (
    select 1 from public.admin_identity_history
    where id = v_target_id and deleted_at is not null
  ) then
    raise exception 'Retry deletion did not retain identity history';
  end if;
  if (
    select count(*) from public.admin_audit_logs
    where target_id = v_target_id and actor_id = v_actor_id
  ) <> 2 then
    raise exception 'Retry deletion audit history or actor attribution mismatch';
  end if;
  if exists (
    select 1 from public.admin_permanent_deletion_email_reservations
    where email = 'retry-admin@example.test'
  ) then
    raise exception 'Retry cleanup left email reservation after verified completion';
  end if;
end;
$$;

rollback;
