-- Reusable roles are server-side data, never Auth user_metadata.
create table uhm.custom_roles (
 id uuid primary key, name text not null check(length(name) between 2 and 80),
 description text not null default '' check(length(description)<=300),
 permissions jsonb not null check(jsonb_typeof(permissions)='array'),
 enabled boolean not null default true, version integer not null default 1,
 updated_at timestamptz not null default now()
);
create unique index custom_roles_name on uhm.custom_roles(lower(name));
alter table uhm.custom_roles enable row level security;
revoke all on uhm.custom_roles from public,anon,authenticated;
grant select,insert,update on uhm.custom_roles to service_role;
alter table uhm.admin_access add column role_ids jsonb not null default '[]'
 check(jsonb_typeof(role_ids)='array' and jsonb_array_length(role_ids)<=8);

create function uhm.save_custom_role(p_role jsonb,p_actor text,p_expected_version integer) returns void
language plpgsql security invoker set search_path='' as $$
declare old_row uhm.custom_roles; next_row uhm.custom_roles; begin
 perform pg_advisory_xact_lock(20261104);
 select * into old_row from uhm.custom_roles where id=(p_role->>'id')::uuid for update;
 if coalesce(old_row.version,0)<>p_expected_version then raise exception 'EDIT_CONFLICT'; end if;
 if exists(select 1 from uhm.custom_roles where id<>(p_role->>'id')::uuid and lower(name)=lower(p_role->>'name')) then raise exception 'ROLE_NAME_EXISTS'; end if;
 insert into uhm.custom_roles(id,name,description,permissions,enabled,version)
 values((p_role->>'id')::uuid,p_role->>'name',p_role->>'description',p_role->'permissions',(p_role->>'enabled')::boolean,1)
 on conflict(id) do update set name=excluded.name,description=excluded.description,permissions=excluded.permissions,
 enabled=excluded.enabled,version=uhm.custom_roles.version+1,updated_at=now() returning * into next_row;
 insert into uhm.audit_events(actor,action,target,detail) values(p_actor,'admin.role.changed',next_row.id::text,jsonb_build_object('before',to_jsonb(old_row),'after',to_jsonb(next_row))::text);
end $$;
create or replace function uhm.save_admin_access(p_access jsonb,p_actor text) returns void
language plpgsql security invoker set search_path='' as $$
declare old_row uhm.admin_access; next_row uhm.admin_access; begin
 perform pg_advisory_xact_lock(20261102);
 perform pg_advisory_xact_lock(20261104);
 select * into old_row from uhm.admin_access where id=(p_access->>'id')::uuid for update;
 if p_access->>'expected_version' is not null and coalesce(old_row.version,0)<>(p_access->>'expected_version')::integer then raise exception 'EDIT_CONFLICT'; end if;
 if old_row.enabled and old_row.role='owner' and ((p_access->>'enabled')::boolean=false or p_access->>'role'<>'owner')
 and not exists(select 1 from uhm.admin_access where id<>old_row.id and enabled and role='owner') then raise exception 'LAST_OWNER'; end if;
 if exists(select 1 from jsonb_array_elements_text(coalesce(p_access->'role_ids','[]')) ids(value)
 where not exists(select 1 from uhm.custom_roles r where r.id::text=ids.value and enabled)) then raise exception 'ROLE_UNAVAILABLE'; end if;
 insert into uhm.admin_access(id,role,permissions,enabled,version,updated_at,role_ids)
 values((p_access->>'id')::uuid,p_access->>'role',p_access->'permissions',(p_access->>'enabled')::boolean,1,now(),coalesce(p_access->'role_ids','[]'))
 on conflict(id) do update set role=excluded.role,permissions=excluded.permissions,enabled=excluded.enabled,
 role_ids=excluded.role_ids,version=uhm.admin_access.version+1,updated_at=now() returning * into next_row;
 insert into uhm.audit_events(actor,action,target,detail) values(p_actor,'admin.access.changed',next_row.id::text,jsonb_build_object('before',to_jsonb(old_row),'after',to_jsonb(next_row))::text);
end $$;
revoke execute on function uhm.save_custom_role(jsonb,text,integer) from public,anon,authenticated;
grant execute on function uhm.save_custom_role(jsonb,text,integer) to service_role;
