-- UHM application schema. Expose `uhm` to PostgREST ONLY with the grants below.
-- Browser roles have NO access; all business authorization runs in the Edge API.
create schema if not exists uhm;
revoke all on schema uhm from public, anon, authenticated;
grant usage on schema uhm to service_role;
alter default privileges in schema uhm revoke execute on functions from public;
alter default privileges in schema uhm revoke all on tables from anon, authenticated;

create table uhm.licenses (
  id uuid primary key default gen_random_uuid(), code_hash text unique not null,
  prefix text not null, tier text not null check (tier in ('normal','pro','vip')),
  status text not null default 'unused' check (status in ('unused','active','suspended','revoked')),
  duration_days integer not null check (duration_days between 1 and 3650),
  created_at timestamptz not null default now(), activated_at timestamptz,
  expires_at timestamptz, device_thumbprint text,
  entitlement_version integer not null default 1, activation_count integer not null default 0,
  check (status <> 'active' or (device_thumbprint is not null and expires_at is not null))
);
create index licenses_device on uhm.licenses(device_thumbprint) where device_thumbprint is not null;
create table uhm.packages (
  id uuid primary key, slug text unique not null, name text not null, description text not null,
  category text not null check (category in ('graphics','tracks','cars','tools')),
  tier text not null check (tier in ('normal','pro','vip')),
  image text not null, version text not null check (version ~ '^\d+\.\d+\.\d+$'),
  changelog text not null default '', dependencies jsonb not null default '[]',
  files jsonb not null default '[]', steps jsonb not null default '[]',
  status text not null check (status in ('draft','published','archived')), released_at timestamptz
);
create table uhm.package_releases (
  package_id uuid references uhm.packages(id), version text not null,
  manifest jsonb not null, published_at timestamptz not null default now(),
  primary key (package_id, version)
);
create table uhm.challenges (
  id uuid primary key, nonce text not null, thumbprint text not null,
  purpose text not null check (purpose in ('activate','refresh','plan','report')),
  expires_at timestamptz not null, consumed boolean not null default false
);
create index challenges_expiry on uhm.challenges(expires_at);
create table uhm.admin_memberships (
  id uuid primary key references auth.users(id),
  role text not null check (role in ('owner','license_manager','content_manager','support','viewer')),
  enabled boolean not null default true
);
create table uhm.audit_events (
  id uuid primary key default gen_random_uuid(), actor text not null, action text not null,
  target text not null, detail text not null default '', created_at timestamptz not null default now()
);
create index audit_events_time on uhm.audit_events(created_at desc);
create table uhm.install_reports (
  id uuid primary key, license_id uuid not null references uhm.licenses(id),
  package_id uuid not null references uhm.packages(id), version text not null,
  status text not null check (status in ('installed','failed')), created_at timestamptz not null default now()
);
create table uhm.rate_limits (key text primary key, count integer not null, reset_at timestamptz not null);

-- RLS is defense in depth. service_role bypasses it; never distribute that key.
do $$ declare t text; begin
  foreach t in array array['licenses','packages','package_releases','challenges','admin_memberships','audit_events','install_reports','rate_limits'] loop
    execute format('alter table uhm.%I enable row level security', t);
    execute format('revoke all on uhm.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update on uhm.%I to service_role', t);
  end loop;
end $$;
revoke update on uhm.audit_events, uhm.package_releases from service_role;

create function uhm.activate_license(p_hash text, p_thumb text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare l uhm.licenses; begin
  select * into l from uhm.licenses where code_hash = p_hash for update;
  if not found or l.status in ('suspended','revoked') or (l.expires_at is not null and l.expires_at <= now())
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

create function uhm.consume_challenge(p_id uuid, p_thumb text) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  update uhm.challenges set consumed = true
    where id = p_id and thumbprint = p_thumb and consumed = false and expires_at > now();
  return found;
end $$;

create function uhm.take_rate_limit(p_key text, p_limit integer, p_seconds integer) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare c integer; begin
  insert into uhm.rate_limits(key, count, reset_at) values (p_key,1,now() + make_interval(secs => p_seconds))
    on conflict (key) do update set
      count = case when uhm.rate_limits.reset_at <= now() then 1 else uhm.rate_limits.count + 1 end,
      reset_at = case when uhm.rate_limits.reset_at <= now() then now() + make_interval(secs => p_seconds) else uhm.rate_limits.reset_at end
    returning count into c;
  return c <= p_limit;
end $$;

create function uhm.mutate_license(p_id uuid, p_action text, p_actor text, p_days integer default 30) returns void
language plpgsql security invoker set search_path = '' as $$
declare l uhm.licenses; begin
  select * into l from uhm.licenses where id=p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if l.status = 'revoked' then raise exception 'INVALID_ACTION'; end if;
  if p_days < 1 or p_days > 365 then raise exception 'INVALID_ACTION'; end if;
  if p_action = 'suspend' then l.status := 'suspended';
  elsif p_action = 'revoke' then l.status := 'revoked';
  elsif p_action = 'resume' and l.status <> 'revoked' then l.status := case when l.device_thumbprint is null then 'unused' else 'active' end;
  elsif p_action = 'reset' and l.status <> 'revoked' then l.device_thumbprint := null; l.status := 'unused';
  elsif p_action = 'extend' and l.status <> 'revoked' then
    if l.expires_at is null then l.duration_days := l.duration_days + p_days;
    else l.expires_at := greatest(now(), l.expires_at) + make_interval(days => p_days); end if;
  else raise exception 'INVALID_ACTION'; end if;
  update uhm.licenses set status=l.status, device_thumbprint=l.device_thumbprint,
    duration_days=l.duration_days, expires_at=l.expires_at, entitlement_version=entitlement_version+1 where id=p_id;
  insert into uhm.audit_events(actor,action,target) values(p_actor,'license.'||p_action,p_id::text);
end $$;

create function uhm.snapshot_release() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.status = 'published' and (TG_OP='INSERT' or old.status <> 'published' or old.version <> new.version) then
    if jsonb_array_length(new.files)=0 or jsonb_array_length(new.steps)=0 then raise exception 'EMPTY_INSTALL_PLAN'; end if;
    insert into uhm.package_releases(package_id,version,manifest) values(new.id,new.version,to_jsonb(new));
  elsif TG_OP='UPDATE' and old.status='published' and new.status='published' and to_jsonb(new)<>to_jsonb(old) then
    raise exception 'RELEASE_IMMUTABLE';
  end if;
  return new;
end $$;
create trigger package_snapshot after insert or update on uhm.packages for each row execute function uhm.snapshot_release();

-- Mandatory operational maintenance. Schedule via pg_cron or your trusted scheduler.
create function uhm.cleanup_ephemeral() returns void
language plpgsql security invoker set search_path = '' as $$
begin
  delete from uhm.challenges where expires_at < now() - interval '1 hour';
  delete from uhm.rate_limits where reset_at < now() - interval '1 day';
end $$;
grant delete on uhm.challenges, uhm.rate_limits to service_role;
revoke execute on all functions in schema uhm from public, anon, authenticated;
grant execute on all functions in schema uhm to service_role;
