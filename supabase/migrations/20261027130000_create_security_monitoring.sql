create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  severity text not null default 'low' check (severity in ('low', 'medium', 'high', 'critical')),
  actor_id uuid references public.admin_users(id) on delete set null,
  subject_hash text,
  route text,
  status_code smallint check (status_code is null or status_code between 100 and 599),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists security_events_occurred_at
  on public.security_events (occurred_at desc, id desc);
create index if not exists security_events_type_time
  on public.security_events (event_type, occurred_at desc);
create index if not exists security_events_subject_time
  on public.security_events (subject_hash, occurred_at desc) where subject_hash is not null;

create or replace view public.security_monitoring_feed as
select
  id,
  event_type,
  severity,
  actor_id,
  route,
  status_code,
  details,
  occurred_at
from public.security_events
union all
select
  audit.id,
  'audit.' || audit.action,
  'low',
  audit.actor_id,
  audit.section,
  null::smallint,
  case
    when audit.action = 'leads.export.generated' then
      jsonb_build_object('recordCount', audit.details -> 'recordCount')
    else '{}'::jsonb
  end,
  audit.created_at
from public.admin_audit_logs audit
where audit.section in ('security', 'ownership')
   or audit.action like 'admin.%'
   or audit.action = 'leads.export.generated';

revoke all on public.security_monitoring_feed from public, anon, authenticated;
grant select on public.security_monitoring_feed to service_role;

create table if not exists public.security_alerts (
  id uuid primary key default gen_random_uuid(),
  rule_id text not null,
  fingerprint text not null,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'new' check (status in ('new', 'investigating', 'resolved')),
  title text not null,
  summary text not null,
  event_ids uuid[] not null default '{}',
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  acknowledged_by uuid references public.admin_users(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_by uuid references public.admin_users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rule_id, fingerprint)
);

create index if not exists security_alerts_recent
  on public.security_alerts (status, last_seen_at desc);

create table if not exists public.security_detection_rules (
  id text primary key check (id = 'default'),
  settings jsonb not null,
  updated_by uuid references public.admin_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.security_events enable row level security;
alter table public.security_alerts enable row level security;
alter table public.security_detection_rules enable row level security;

revoke all on public.security_events, public.security_alerts, public.security_detection_rules from anon, authenticated;
revoke all on public.security_events, public.security_alerts, public.security_detection_rules from service_role;
grant select, insert on public.security_events to service_role;
grant select, insert, update on public.security_alerts to service_role;
grant select, insert, update on public.security_detection_rules to service_role;

create or replace function public.prevent_security_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and current_setting('app.security_retention', true) = 'on' then
    return old;
  end if;
  raise exception 'Security events are append-only';
end;
$$;

drop trigger if exists security_events_immutable on public.security_events;
create trigger security_events_immutable
before update or delete on public.security_events
for each row execute function public.prevent_security_event_mutation();
revoke all on function public.prevent_security_event_mutation() from public, anon, authenticated;

create or replace function public.prune_expired_security_events(p_retention_days integer default 180, p_batch_size integer default 500)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  if p_retention_days < 90 or p_retention_days > 730 or p_batch_size < 1 or p_batch_size > 2000 then
    raise exception 'Invalid security event retention bounds';
  end if;
  perform set_config('app.security_retention', 'on', true);
  with expired as (
    select ctid
    from public.security_events security_event
    where security_event.occurred_at < now() - make_interval(days => p_retention_days)
      and not exists (
        select 1
        from public.security_alerts alert
        where alert.status in ('new', 'investigating')
          and security_event.id = any(alert.event_ids)
      )
    order by occurred_at asc
    limit p_batch_size
    for update skip locked
  )
  delete from public.security_events event
  using expired
  where event.ctid = expired.ctid;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace function public.update_security_alert_status(p_alert_id uuid, p_status text, p_actor_id uuid)
returns public.security_alerts
language plpgsql
security definer
set search_path = public
as $$
declare
  alert_row public.security_alerts%rowtype;
  next_row public.security_alerts%rowtype;
  event_name text;
begin
  if p_status not in ('investigating', 'resolved') then
    raise exception 'Invalid security alert status';
  end if;
  select * into alert_row
  from public.security_alerts
  where id = p_alert_id
  for update;
  if not found or alert_row.status = 'resolved' then
    return null;
  end if;
  event_name := case when p_status = 'resolved' then 'security.alert.resolved' else 'security.alert.acknowledged' end;
  update public.security_alerts
  set status = p_status,
      acknowledged_by = coalesce(acknowledged_by, p_actor_id),
      acknowledged_at = coalesce(acknowledged_at, now()),
      resolved_by = case when p_status = 'resolved' then p_actor_id else null end,
      resolved_at = case when p_status = 'resolved' then now() else null end,
      updated_at = now()
  where id = p_alert_id
  returning * into next_row;
  insert into public.security_events (event_type, severity, actor_id, route, details)
  values (event_name, alert_row.severity, p_actor_id, 'security-monitoring',
    jsonb_build_object('alertId', p_alert_id, 'ruleId', alert_row.rule_id));
  return next_row;
end;
$$;

create or replace function public.save_security_detection_rules(p_settings jsonb, p_actor_id uuid)
returns table(settings jsonb, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.security_detection_rules
  set settings = p_settings, updated_by = p_actor_id, updated_at = now()
  where id = 'default';
  if not found then
    raise exception 'Security detection rules are not initialized';
  end if;
  insert into public.admin_audit_logs (actor_id, action, section, details)
  values (p_actor_id, 'security.monitoring.rules.updated', 'security', p_settings);
  return query
  select rule.settings, rule.updated_at
  from public.security_detection_rules rule
  where rule.id = 'default';
end;
$$;

revoke all on function public.prune_expired_security_events(integer, integer) from public, anon, authenticated;
revoke all on function public.update_security_alert_status(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.save_security_detection_rules(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.prune_expired_security_events(integer, integer) to service_role;
grant execute on function public.update_security_alert_status(uuid, text, uuid) to service_role;
grant execute on function public.save_security_detection_rules(jsonb, uuid) to service_role;

insert into public.security_detection_rules (id, settings)
values ('default', '{"windowMinutes":15,"failedLogins":5,"unauthorizedRequests":15,"restrictedDenials":5,"bulkLeadExportRecords":100,"alertNonOwnerPrivilegeChanges":true}'::jsonb)
on conflict (id) do nothing;

comment on table public.security_events is
  'Append-only administrative security telemetry. Do not persist credentials or personal contact details.';
comment on table public.security_alerts is
  'Persistent detection indicators; their acknowledgement and resolution are additionally recorded in security_events.';
comment on table public.security_detection_rules is
  'Owner-managed bounded detection thresholds, accessed only through the authenticated server.';
