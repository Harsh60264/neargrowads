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

  if not found or target_row.is_primary_owner is distinct from false then
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

revoke all on function public.cancel_admin_invitation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_admin_invitation(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
