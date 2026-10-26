alter table public.admin_users
  add column if not exists username text,
  add column if not exists last_login_at timestamptz,
  add column if not exists last_password_reset_at timestamptz,
  add column if not exists must_change_password boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'admin_users_username_format'
      and conrelid = 'public.admin_users'::regclass
  ) then
    alter table public.admin_users
      add constraint admin_users_username_format
      check (username is null or (username = lower(username) and username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'));
  end if;
end;
$$;

create unique index if not exists admin_users_username_unique
  on public.admin_users (username)
  where username is not null;

update public.admin_users
set permissions = '{
  "dashboard":{"view":true},
  "leads":{"view":true,"edit":true},
  "serviceStore":{"view":true},
  "content":{"view":true,"edit":true},
  "blogs":{"view":true,"create":true,"edit":true,"delete":true,"publish":true},
  "team":{"view":true,"create":true,"edit":true,"delete":true},
  "categories":{"view":true,"create":true,"edit":true,"delete":true},
  "settings":{"view":true}
}'::jsonb
where role = 'super_admin' and permissions = '{}'::jsonb;
