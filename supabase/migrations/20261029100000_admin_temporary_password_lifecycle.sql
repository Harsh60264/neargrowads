alter table public.admin_users
  add column if not exists temporary_password_expires_at timestamptz,
  add column if not exists temporary_password_used_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_users_temporary_password_requires_change'
      and conrelid = 'public.admin_users'::regclass
  ) then
    alter table public.admin_users
      add constraint admin_users_temporary_password_requires_change
      check (temporary_password_expires_at is null or must_change_password);
  end if;
end;
$$;

create or replace function public.consume_admin_temporary_password_login(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_row public.admin_users%rowtype;
  consumed_at timestamptz := now();
begin
  if p_user_id is null then
    return jsonb_build_object('status', 'rejected');
  end if;

  select *
  into target_row
  from public.admin_users
  where id = p_user_id
  for update;

  if not found
    or target_row.status is distinct from 'active'
    or target_row.archived_at is not null
    or target_row.is_primary_owner is distinct from false
    or target_row.must_change_password is distinct from true
    or target_row.temporary_password_expires_at is null then
    return jsonb_build_object('status', 'rejected');
  end if;

  if target_row.temporary_password_expires_at <= consumed_at then
    return jsonb_build_object('status', 'expired');
  end if;

  if target_row.temporary_password_used_at is not null then
    return jsonb_build_object('status', 'already_used');
  end if;

  update public.admin_users
  set temporary_password_used_at = consumed_at,
      updated_at = consumed_at
  where id = p_user_id;

  return jsonb_build_object('status', 'consumed');
end;
$$;

revoke all on function public.consume_admin_temporary_password_login(uuid) from public, anon, authenticated;
grant execute on function public.consume_admin_temporary_password_login(uuid) to service_role;

notify pgrst, 'reload schema';
