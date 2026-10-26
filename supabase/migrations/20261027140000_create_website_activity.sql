create table if not exists public.website_activity (
  visitor_hash text primary key check (visitor_hash ~ '^[0-9a-f]{64}$'),
  current_path text not null check (char_length(current_path) between 1 and 180),
  device text not null check (device in ('mobile', 'desktop', 'tablet')),
  last_seen_at timestamptz not null default statement_timestamp()
);

create index if not exists website_activity_last_seen
  on public.website_activity (last_seen_at desc);

alter table public.website_activity enable row level security;
revoke all on table public.website_activity from public, anon, authenticated, service_role;

create or replace function public.record_website_activity(
  p_visitor_hash text,
  p_current_path text,
  p_device text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  changed_rows integer;
begin
  if p_visitor_hash is null
    or p_visitor_hash !~ '^[0-9a-f]{64}$'
    or p_current_path is null
    or char_length(p_current_path) not between 1 and 180
    or p_current_path like '/admin%'
    or p_device is null
    or p_device not in ('mobile', 'desktop', 'tablet') then
    raise exception 'Invalid website activity input';
  end if;

  insert into public.website_activity (visitor_hash, current_path, device, last_seen_at)
  values (p_visitor_hash, p_current_path, p_device, statement_timestamp())
  on conflict (visitor_hash) do update
    set current_path = excluded.current_path,
        device = excluded.device,
        last_seen_at = excluded.last_seen_at
    where public.website_activity.last_seen_at < statement_timestamp() - interval '5 seconds';

  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

revoke all on function public.record_website_activity(text, text, text) from public, anon, authenticated;
grant execute on function public.record_website_activity(text, text, text) to service_role;

create or replace function public.get_active_website_activity()
returns table (
  active_visitors bigint,
  active_pages jsonb,
  device_breakdown jsonb,
  last_activity_at timestamptz,
  generated_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with active as (
    select current_path, device, last_seen_at
    from public.website_activity
    where last_seen_at >= statement_timestamp() - interval '5 minutes'
  ),
  page_counts as (
    select current_path, count(*) as visitors
    from active
    group by current_path
    order by count(*) desc, current_path asc
    limit 10
  )
  select
    (select count(*) from active),
    coalesce((select jsonb_agg(jsonb_build_object('path', current_path, 'count', visitors)
      order by visitors desc, current_path asc) from page_counts), '[]'::jsonb),
    jsonb_build_object(
      'mobile', (select count(*) from active where device = 'mobile'),
      'desktop', (select count(*) from active where device = 'desktop'),
      'tablet', (select count(*) from active where device = 'tablet')
    ),
    (select max(last_seen_at) from active),
    statement_timestamp();
$$;

revoke all on function public.get_active_website_activity() from public, anon, authenticated;
grant execute on function public.get_active_website_activity() to service_role;

create or replace function public.prune_website_activity(p_batch_size integer default 500)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  removed_rows integer;
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 1000 then
    raise exception 'Invalid website activity cleanup batch size';
  end if;

  with expired as (
    select ctid
    from public.website_activity
    where last_seen_at < statement_timestamp() - interval '24 hours'
    order by last_seen_at
    limit p_batch_size
  )
  delete from public.website_activity as activity
  using expired
  where activity.ctid = expired.ctid;

  get diagnostics removed_rows = row_count;
  return removed_rows;
end;
$$;

revoke all on function public.prune_website_activity(integer) from public, anon, authenticated;
grant execute on function public.prune_website_activity(integer) to service_role;
