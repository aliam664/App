-- No browser access. License admin rights are separate from app entitlements.
alter table uhm.licenses add column display_name text not null default '' check(length(display_name)<=120),
 add column notes text not null default '' check(length(notes)<=4000),
 add column tags jsonb not null default '[]', add column archived boolean not null default false;
alter table uhm.challenges drop constraint challenges_purpose_check;
alter table uhm.challenges add constraint challenges_purpose_check check(purpose in ('activate','refresh','plan','report','admin','telemetry'));
create table uhm.admin_access (
 id uuid primary key references uhm.licenses(id),
 role text not null check(role in ('owner','license_manager','content_manager','support','viewer')),
 permissions jsonb not null default '[]', enabled boolean not null default true,
 version integer not null default 1, updated_at timestamptz not null default now()
);
create table uhm.telemetry_events (
 id uuid not null, license_id uuid not null references uhm.licenses(id),
 type text not null check(type in ('app_open','download_started','download_completed','download_failed','package_download_completed','install_started','install_completed','install_failed','app_error')),
 occurred_at timestamptz not null, received_at timestamptz not null default now(), session_id uuid not null,
 package_id uuid, version text, file_id uuid, file_name text, host text, bytes bigint, duration_ms bigint,
 error_code text, stage text, app_version text, resolved_at timestamptz, resolved_by text,
 primary key(license_id,id)
);
create index telemetry_license_time on uhm.telemetry_events(license_id,occurred_at desc);
create index telemetry_type_time on uhm.telemetry_events(type,occurred_at desc);
create table uhm.service_settings (
 id uuid primary key, maintenance boolean not null default false,
 activation_paused boolean not null default false, issuance_paused boolean not null default false,
 downloads_paused boolean not null default false, message text not null default '' check(length(message)<=500), updated_at timestamptz not null default now()
);
do $$ declare t text; begin
 foreach t in array array['admin_access','telemetry_events','service_settings'] loop
 execute format('alter table uhm.%I enable row level security',t);
 execute format('revoke all on uhm.%I from public,anon,authenticated',t);
 execute format('grant select,insert,update on uhm.%I to service_role',t);
 end loop;
end $$;
-- Serialize changes to protect the final license owner against concurrent demotions.
create function uhm.save_admin_access(p_access jsonb,p_actor text) returns void
language plpgsql security invoker set search_path='' as $$
declare old_row uhm.admin_access; next_row uhm.admin_access; begin
 perform pg_advisory_xact_lock(20261102);
 select * into old_row from uhm.admin_access where id=(p_access->>'id')::uuid for update;
 if old_row.enabled and old_row.role='owner' and ((p_access->>'enabled')::boolean=false or p_access->>'role'<>'owner')
 and not exists(select 1 from uhm.admin_access where id<>old_row.id and enabled and role='owner') then raise exception 'LAST_OWNER'; end if;
 insert into uhm.admin_access(id,role,permissions,enabled,version,updated_at)
 values((p_access->>'id')::uuid,p_access->>'role',p_access->'permissions',(p_access->>'enabled')::boolean,1,now())
 on conflict(id) do update set role=excluded.role,permissions=excluded.permissions,enabled=excluded.enabled,version=uhm.admin_access.version+1,updated_at=now()
 returning * into next_row;
 insert into uhm.audit_events(actor,action,target,detail) values(p_actor,'admin.access.changed',next_row.id::text,jsonb_build_object('before',to_jsonb(old_row),'after',to_jsonb(next_row))::text);
end $$;
revoke execute on function uhm.save_admin_access(jsonb,text) from public,anon,authenticated;
grant execute on function uhm.save_admin_access(jsonb,text) to service_role;
-- Aggregate at the database: don't transfer the entire event history into the browser.
create function uhm.dashboard_analytics(p_since timestamptz) returns jsonb
language sql stable security invoker set search_path='' as $$
 with e as (select * from uhm.telemetry_events where occurred_at>=p_since),
 totals as (select type,count(*) as count from e group by type),
 daily as (select to_char(occurred_at at time zone 'UTC','YYYY-MM-DD') as day,
 count(*) filter(where type='app_open') as opens,
 count(*) filter(where type='package_download_completed') as downloads,
 count(*) filter(where type='install_completed') as installs,
 count(*) filter(where type in ('download_failed','install_failed','app_error')) as errors
 from e group by day order by day),
 packages as (select package_id,count(*) filter(where type='package_download_completed') as downloads,
 count(*) filter(where type='install_completed') as installs,
 count(*) filter(where type in ('download_failed','install_failed')) as errors
 from e where package_id is not null group by package_id order by downloads desc limit 50)
 select jsonb_build_object('totals',coalesce((select jsonb_agg(totals) from totals),'[]'::jsonb),
 'daily',coalesce((select jsonb_agg(daily order by day) from daily),'[]'::jsonb),
 'packages',coalesce((select jsonb_agg(packages order by downloads desc) from packages),'[]'::jsonb));
$$;
revoke execute on function uhm.dashboard_analytics(timestamptz) from public,anon,authenticated;
grant execute on function uhm.dashboard_analytics(timestamptz) to service_role;

create or replace function uhm.activate_license(p_hash text, p_thumb text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare l uhm.licenses; begin
  select * into l from uhm.licenses where code_hash = p_hash for update;
  if not found or l.archived or l.status in ('suspended','revoked') or (l.expires_at is not null and l.expires_at <= now())
     or (l.device_thumbprint is not null and l.device_thumbprint <> p_thumb) then
    raise exception 'ACTIVATION_DENIED';
  end if;
  update uhm.licenses set
    activated_at = coalesce(activated_at, now()),
    expires_at = coalesce(expires_at, now() + make_interval(days => duration_days)),
    activation_count = activation_count + case when device_thumbprint is null then 1 else 0 end,
    device_thumbprint = p_thumb, status = 'active'
    where id = l.id returning * into l;
  insert into uhm.audit_events(actor, action, target) values ('device','license.activated',l.id::text);
  return to_jsonb(l);
end $$;

create index audit_target_time on uhm.audit_events(target,created_at desc,id desc);
create function uhm.license_event_stats(p_license uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('totals',coalesce((select jsonb_agg(t) from (select type,count(*) as count from uhm.telemetry_events where license_id=p_license group by type) t),'[]'::jsonb),
 'first_seen',(select min(occurred_at) from uhm.telemetry_events where license_id=p_license),
 'last_seen',(select max(occurred_at) from uhm.telemetry_events where license_id=p_license));
$$;
revoke execute on function uhm.license_event_stats(uuid) from public,anon,authenticated;
grant execute on function uhm.license_event_stats(uuid) to service_role;
create index telemetry_error_queue on uhm.telemetry_events(resolved_at,occurred_at desc,id desc)
 where type in ('download_failed','install_failed','app_error');
