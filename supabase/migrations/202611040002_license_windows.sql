-- Optional calendar windows; NULL retains first-activation duration semantics.
alter table uhm.licenses add column starts_at timestamptz;
alter table uhm.licenses add constraint license_window_order check(starts_at is null or expires_at is null or expires_at>starts_at);
create or replace function uhm.activate_license(p_hash text, p_thumb text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare l uhm.licenses; begin
  select * into l from uhm.licenses where code_hash = p_hash for update;
  if not found or l.archived or (l.starts_at is not null and l.starts_at>now()) or l.status in ('suspended','revoked') or (l.expires_at is not null and l.expires_at <= now())
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
create function uhm.set_license_window(p_id uuid,p_window jsonb,p_actor text) returns void
language plpgsql security invoker set search_path='' as $$
declare l uhm.licenses; begin
 select * into l from uhm.licenses where id=p_id for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if l.entitlement_version<>(p_window->>'expected_version')::integer then raise exception 'EDIT_CONFLICT'; end if;
 if l.status='revoked' or (l.activated_at is not null and p_window->>'expires_at' is null) then raise exception 'INVALID_ACTION'; end if;
 update uhm.licenses set starts_at=(p_window->>'starts_at')::timestamptz, expires_at=(p_window->>'expires_at')::timestamptz, entitlement_version=entitlement_version+1 where id=p_id;
 insert into uhm.audit_events(actor,action,target,detail) values(p_actor,'license.window.changed',p_id::text,jsonb_build_object('before',jsonb_build_object('starts_at',l.starts_at,'expires_at',l.expires_at),'after',p_window-'expected_version')::text);
end $$;
revoke execute on function uhm.set_license_window(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function uhm.set_license_window(uuid,jsonb,text) to service_role;
