alter table public.admin_users
  add column if not exists archived_at timestamptz;

create or replace function public.cancel_admin_invitation(p_actor_id uuid, p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_row public.admin_users%rowtype;
  cancellation_id uuid;
  cancelled_at timestamptz := now();
begin
  if p_actor_id is null or p_target_id is null then
    return jsonb_build_object('status', 'rejected');
  end if;

  perform 1
  from public.admin_users
  where id = p_actor_id
    and role = 'owner'
    and status = 'active'
    and is_primary_owner
  for share;

  if not found then
    return jsonb_build_object('status', 'rejected');
  end if;

  select *
  into target_row
  from public.admin_users
  where id = p_target_id
  for update;

  if not found or target_row.role = 'owner' or target_row.is_primary_owner then
    return jsonb_build_object('status', 'rejected');
  end if;

  if target_row.status = 'disabled' then
    select id
    into cancellation_id
    from public.admin_audit_logs
    where target_id = p_target_id
      and action = 'admin.invitation.cancelled'
    order by created_at desc
    limit 1;

    if cancellation_id is not null then
      return jsonb_build_object('status', 'already_cancelled', 'auditId', cancellation_id);
    end if;

    return jsonb_build_object('status', 'rejected');
  end if;

  if target_row.status <> 'pending' then
    return jsonb_build_object('status', 'rejected');
  end if;

  update public.admin_users
  set status = 'disabled',
      username = null,
      permissions = '{}'::jsonb,
      invitation_generation = gen_random_uuid(),
      updated_at = cancelled_at
  where id = p_target_id;

  update public.admin_sessions
  set revoked_at = cancelled_at
  where user_id = p_target_id
    and revoked_at is null;

  insert into public.admin_audit_logs (actor_id, target_id, action, section, details, created_at)
  values (
    p_actor_id,
    p_target_id,
    'admin.invitation.cancelled',
    'settings',
    jsonb_build_object(
      'cancellationPolicy', 'disable_cms_access_keep_auth_identity_and_audit_history',
      'invitationGenerationRotated', true
    ),
    cancelled_at
  )
  returning id into cancellation_id;

  return jsonb_build_object(
    'status', 'cancelled',
    'auditId', cancellation_id,
    'cancelledAt', cancelled_at
  );
end;
$$;

create or replace function public.prepare_admin_invitation_recovery(
  p_actor_id uuid,
  p_target_id uuid,
  p_invitation_generation uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_row public.admin_users%rowtype;
  prepared_at timestamptz := now();
begin
  if p_actor_id is null or p_target_id is null or p_invitation_generation is null then
    return jsonb_build_object('status', 'rejected');
  end if;

  perform 1
  from public.admin_users
  where id = p_actor_id
    and role = 'owner'
    and status = 'active'
    and is_primary_owner
  for share;

  if not found then
    return jsonb_build_object('status', 'rejected');
  end if;

  select *
  into target_row
  from public.admin_users
  where id = p_target_id
  for update;

  if not found
    or target_row.is_primary_owner is distinct from false
    or (target_row.status is distinct from 'pending' and target_row.status is distinct from 'disabled') then
    return jsonb_build_object('status', 'rejected');
  end if;

  update public.admin_users
  set status = 'pending',
      username = case when target_row.status = 'disabled' then null else username end,
      permissions = case when target_row.status = 'disabled' then '{}'::jsonb else permissions end,
      must_change_password = true,
      invitation_generation = p_invitation_generation,
      archived_at = null,
      updated_at = prepared_at
  where id = p_target_id;

  update public.admin_sessions
  set revoked_at = prepared_at
  where user_id = p_target_id
    and revoked_at is null;

  insert into public.admin_audit_logs (actor_id, target_id, action, section, details, created_at)
  values (
    p_actor_id,
    p_target_id,
    'admin.invitation.reissued',
    'settings',
    jsonb_build_object(
      'previousStatus', target_row.status,
      'previouslyArchived', target_row.archived_at is not null,
      'permissionsCleared', target_row.status = 'disabled',
      'authIdentityRetained', true
    ),
    prepared_at
  );

  return jsonb_build_object('status', 'prepared', 'previousStatus', target_row.status);
end;
$$;

create or replace function public.archive_admin_account(p_actor_id uuid, p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_row public.admin_users%rowtype;
  archived_at_value timestamptz := now();
begin
  if p_actor_id is null or p_target_id is null then
    return jsonb_build_object('status', 'rejected');
  end if;

  perform 1
  from public.admin_users
  where id = p_actor_id
    and role = 'owner'
    and status = 'active'
    and is_primary_owner
  for share;

  if not found then
    return jsonb_build_object('status', 'rejected');
  end if;

  select *
  into target_row
  from public.admin_users
  where id = p_target_id
  for update;

  if not found
    or target_row.role = 'owner'
    or target_row.is_primary_owner
    or target_row.status is distinct from 'disabled' then
    return jsonb_build_object('status', 'rejected');
  end if;

  if target_row.archived_at is not null then
    return jsonb_build_object('status', 'already_archived', 'archivedAt', target_row.archived_at);
  end if;

  update public.admin_users
  set archived_at = archived_at_value,
      invitation_generation = gen_random_uuid(),
      updated_at = archived_at_value
  where id = p_target_id;

  update public.admin_sessions
  set revoked_at = archived_at_value
  where user_id = p_target_id
    and revoked_at is null;

  insert into public.admin_audit_logs (actor_id, target_id, action, section, details, created_at)
  values (
    p_actor_id,
    p_target_id,
    'admin.archived',
    'settings',
    jsonb_build_object(
      'archivePolicy', 'hide_disabled_record_keep_auth_identity_and_audit_history',
      'previousStatus', target_row.status,
      'previouslyArchived', target_row.archived_at is not null
    ),
    archived_at_value
  );

  return jsonb_build_object('status', 'archived', 'archivedAt', archived_at_value);
end;
$$;

revoke all on function public.cancel_admin_invitation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_admin_invitation(uuid, uuid) to service_role;
revoke all on function public.prepare_admin_invitation_recovery(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.prepare_admin_invitation_recovery(uuid, uuid, uuid) to service_role;
revoke all on function public.archive_admin_account(uuid, uuid) from public, anon, authenticated;
grant execute on function public.archive_admin_account(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
