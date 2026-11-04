-- Additive package workflows; existing identities and published release snapshots are not rewritten.
create table uhm.package_categories (
 id text primary key check(id ~ '^[a-z0-9-]{2,64}$'), name text not null check(length(name) between 2 and 80),
 enabled boolean not null default true, version integer not null default 1, updated_at timestamptz not null default now()
);
insert into uhm.package_categories(id,name) values('graphics','گرافیک و نور'),('tracks','مسیرها'),('cars','خودروها'),('tools','ابزارهای پایه');
alter table uhm.package_categories enable row level security;
revoke all on uhm.package_categories from public,anon,authenticated;
grant select,insert,update on uhm.package_categories to service_role;
alter table uhm.packages drop constraint packages_category_check;
alter table uhm.packages add constraint package_category_slug check(category ~ '^[a-z0-9-]{2,64}$');
alter table uhm.packages add column revision integer not null default 1, add column deleted_at timestamptz;

create function uhm.save_package_category(p_category jsonb,p_actor text,p_expected_version integer) returns void
language plpgsql security invoker set search_path='' as $$
declare old_row uhm.package_categories; next_row uhm.package_categories; begin
 perform pg_advisory_xact_lock(20261105);
 select * into old_row from uhm.package_categories where id=p_category->>'id' for update;
 if coalesce(old_row.version,0)<>p_expected_version then raise exception 'EDIT_CONFLICT'; end if;
 insert into uhm.package_categories(id,name,enabled) values(p_category->>'id',p_category->>'name',(p_category->>'enabled')::boolean)
 on conflict(id) do update set name=excluded.name,enabled=excluded.enabled,version=uhm.package_categories.version+1,updated_at=now() returning * into next_row;
 insert into uhm.audit_events(actor,action,target,detail) values(p_actor,'category.changed',next_row.id,jsonb_build_object('before',to_jsonb(old_row),'after',to_jsonb(next_row))::text);
end $$;

create function uhm.save_user_profile(p_id uuid,p_input jsonb,p_actor text) returns void
language plpgsql security invoker set search_path='' as $$
declare l uhm.licenses; begin
 select * into l from uhm.licenses where id=p_id for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 update uhm.licenses set display_name=p_input->>'display_name', notes=p_input->>'notes',tags=p_input->'tags' where id=p_id;
 insert into uhm.audit_events(actor,action,target,detail) values(p_actor,'license.metadata.changed',p_id::text,jsonb_build_object('before',jsonb_build_object('display_name',l.display_name,'notes',l.notes,'tags',l.tags),'after',p_input)::text);
end $$;

create function uhm.commit_package(p_manifest jsonb,p_actor text,p_action text,p_expected_revision integer default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare old_row uhm.packages; next_row uhm.packages; graph jsonb; nodes integer; cyclic boolean; missing boolean; tier_denied boolean; ids text[]; begin
 perform pg_advisory_xact_lock(20261105);
 select * into old_row from uhm.packages where id=(p_manifest->>'id')::uuid for update;
 if p_expected_revision is not null and coalesce(old_row.revision,0)<>p_expected_revision then raise exception 'EDIT_CONFLICT'; end if;
 if old_row.deleted_at is not null then raise exception 'PACKAGE_DELETED'; end if;
 if p_action not in ('save','publish','archive','delete','restore') then raise exception 'INVALID_ACTION'; end if;
 if p_action in ('save','restore') and p_manifest->>'status' is distinct from 'draft' then raise exception 'INVALID_ACTION'; end if;
 if p_action in ('archive','delete') and p_manifest->>'status' is distinct from 'archived' then raise exception 'INVALID_ACTION'; end if;
 if p_action in ('save','restore') and exists(select 1 from uhm.package_releases where package_id=(p_manifest->>'id')::uuid and version=p_manifest->>'version') then raise exception 'RELEASE_IMMUTABLE'; end if;
 if p_action='publish' then
  if old_row.status is distinct from 'draft' or p_manifest->>'status'<>'published' then raise exception 'DRAFT_REQUIRED'; end if;
  if not exists(select 1 from uhm.package_categories where id=p_manifest->>'category' and enabled) then raise exception 'CATEGORY_UNAVAILABLE'; end if;
  -- Recheck the live dependency graph under the same lock as publish/delete. API validation alone races concurrent publishers.
  select coalesce(jsonb_object_agg(p->>'id',p),'{}'::jsonb) into graph from uhm.published_packages() p where p->>'id'<>p_manifest->>'id';
  graph:=graph||jsonb_build_object(p_manifest->>'id',p_manifest);
  -- UNION deduplicates reachable IDs. Do not enumerate all DAG paths (exponential for shared prerequisites).
  with recursive walk(id) as (
   select p_manifest->>'id'
   union
   select d.value from walk w cross join lateral jsonb_array_elements_text(graph->w.id->'dependencies') d
  ) select count(*)::integer,array_agg(id),bool_or(graph->id is null),
   bool_or(array_position(array['normal','pro','vip'],graph->id->>'tier')>array_position(array['normal','pro','vip'],p_manifest->>'tier'))
   into nodes,ids,missing,tier_denied from walk;
  if missing then raise exception 'DEPENDENCY_UNAVAILABLE'; end if;
  if tier_denied then raise exception 'TIER_REQUIRED'; end if;
  if nodes>30 then raise exception 'INSTALL_PLAN_LIMIT'; end if;
  -- At most 30 reachable nodes / 900 pairs, including cyclic input.
  with recursive edges(source,target) as (
   select n,d.value from unnest(ids) n cross join lateral jsonb_array_elements_text(graph->n->'dependencies') d
   union
   select e.source,d.value from edges e cross join lateral jsonb_array_elements_text(graph->e.target->'dependencies') d
  ) select exists(select 1 from edges where source=target) into cyclic;
  if cyclic then raise exception 'DEPENDENCY_CYCLE'; end if;
 end if;
 if p_action='delete' and exists(select 1 from uhm.published_packages() p where p->>'id'<>old_row.id::text and (p->'dependencies') ? old_row.id::text) then raise exception 'PACKAGE_IN_USE'; end if;
 select * into next_row from jsonb_populate_record(null::uhm.packages,
 jsonb_build_object('short_description','','content_type','pack','author','','brand','','tags','[]'::jsonb,'images','[]'::jsonb,'channel','stable','scheduled_at',null)
 ||p_manifest||jsonb_build_object('revision',coalesce(old_row.revision,0)+1,'deleted_at',case when p_action='delete' then to_jsonb(now()) else 'null'::jsonb end));
 insert into uhm.packages select (next_row).* on conflict(id) do update set slug=excluded.slug,name=excluded.name,description=excluded.description,category=excluded.category,tier=excluded.tier,image=excluded.image,version=excluded.version,changelog=excluded.changelog,dependencies=excluded.dependencies,files=excluded.files,steps=excluded.steps,status=excluded.status,released_at=excluded.released_at,short_description=excluded.short_description,content_type=excluded.content_type,author=excluded.author,brand=excluded.brand,tags=excluded.tags,images=excluded.images,channel=excluded.channel,scheduled_at=excluded.scheduled_at,revision=excluded.revision,deleted_at=excluded.deleted_at;
 insert into uhm.audit_events(actor,action,target,detail) values(p_actor,case when p_action='save' then 'package.draft.saved' else 'package.'||p_action end,next_row.id::text,jsonb_build_object('before',case when old_row.id is null then null else jsonb_build_object('version',old_row.version,'status',old_row.status,'revision',old_row.revision) end,'after',jsonb_build_object('version',next_row.version,'status',next_row.status,'revision',next_row.revision))::text);
 return to_jsonb(next_row);
end $$;
revoke execute on function uhm.save_package_category(jsonb,text,integer),uhm.commit_package(jsonb,text,text,integer),uhm.save_user_profile(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function uhm.save_package_category(jsonb,text,integer),uhm.commit_package(jsonb,text,text,integer),uhm.save_user_profile(uuid,jsonb,text) to service_role;
