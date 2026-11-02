-- Additive, backwards-compatible content metadata and normalized package children.
alter table uhm.packages
 add column short_description text not null default '' check(length(short_description)<=240),
 add column content_type text not null default 'pack' check(content_type in ('car','track','skin','python_app','lua_app','csp','ppfilter','pack')),
 add column author text not null default '' check(length(author)<=120),
 add column brand text not null default '' check(length(brand)<=120),
 add column tags jsonb not null default '[]', add column images jsonb not null default '[]',
 add column channel text not null default 'stable' check(channel in ('stable','test')),
 add column scheduled_at timestamptz;
create table uhm.package_files (
 package_id uuid not null references uhm.packages(id), id uuid not null,
 name text not null, url text not null, sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 size bigint not null check(size>0), format text not null check(format in ('zip','rar','7z','file','exe')),
 mirrors jsonb not null default '[]', archive_password text, sort_order integer not null,
 primary key(package_id,id)
);
create table uhm.package_steps (
 package_id uuid not null, id uuid not null, file_id uuid not null,
 action text not null check(action in ('copy','extract')), destination text not null,
 overwrite text not null check(overwrite in ('backup','fail')), source_subdir text,
 depends_on jsonb not null default '[]', sort_order integer not null,
 primary key(package_id,id), foreign key(package_id,file_id) references uhm.package_files(package_id,id)
);
create table uhm.package_dependencies (
 package_id uuid references uhm.packages(id), dependency_id uuid not null,
 primary key(package_id,dependency_id), check(package_id<>dependency_id)
);
-- Missing dependency IDs can be saved in a draft; publication validates the complete graph.
create function uhm.sync_package_children() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 delete from uhm.package_steps where package_id=new.id;
 delete from uhm.package_files where package_id=new.id;
 delete from uhm.package_dependencies where package_id=new.id;
 insert into uhm.package_files(package_id,id,name,url,sha256,size,format,mirrors,archive_password,sort_order)
 select new.id,(f->>'id')::uuid,f->>'name',f->>'url',f->>'sha256',(f->>'size')::bigint,f->>'format',coalesce(f->'mirrors','[]'),f->>'archive_password',n::integer
 from jsonb_array_elements(new.files) with ordinality as a(f,n);
 insert into uhm.package_steps(package_id,id,file_id,action,destination,overwrite,source_subdir,depends_on,sort_order)
 select new.id,(s->>'id')::uuid,(s->>'file_id')::uuid,s->>'action',s->>'destination',coalesce(s->>'overwrite','backup'),s->>'source_subdir',coalesce(s->'depends_on','[]'),n::integer
 from jsonb_array_elements(new.steps) with ordinality as a(s,n);
 insert into uhm.package_dependencies(package_id,dependency_id)
 select new.id,d::uuid from jsonb_array_elements_text(new.dependencies) d;
 return new;
end $$;
create trigger package_children_sync after insert or update on uhm.packages for each row execute function uhm.sync_package_children();
-- Backfill existing packages by invoking the same trigger without changing immutable releases.
-- Existing published rows cannot be updated. Build normalized rows directly instead.
insert into uhm.package_files(package_id,id,name,url,sha256,size,format,mirrors,archive_password,sort_order)
select p.id,(f->>'id')::uuid,f->>'name',f->>'url',f->>'sha256',(f->>'size')::bigint,f->>'format',coalesce(f->'mirrors','[]'),f->>'archive_password',n::integer
from uhm.packages p cross join lateral jsonb_array_elements(p.files) with ordinality a(f,n);
insert into uhm.package_steps(package_id,id,file_id,action,destination,overwrite,source_subdir,depends_on,sort_order)
select p.id,(s->>'id')::uuid,(s->>'file_id')::uuid,s->>'action',s->>'destination',coalesce(s->>'overwrite','backup'),s->>'source_subdir',coalesce(s->'depends_on','[]'),n::integer
from uhm.packages p cross join lateral jsonb_array_elements(p.steps) with ordinality a(s,n);
insert into uhm.package_dependencies(package_id,dependency_id)
select p.id,d::uuid from uhm.packages p cross join lateral jsonb_array_elements_text(p.dependencies) d;
do $$ declare t text; begin
 foreach t in array array['package_files','package_steps','package_dependencies'] loop
 execute format('alter table uhm.%I enable row level security',t);
 execute format('revoke all on uhm.%I from public,anon,authenticated',t);
 execute format('grant select,insert,update,delete on uhm.%I to service_role',t);
 end loop;
end $$;
revoke all on function uhm.sync_package_children() from public,anon,authenticated;
grant execute on function uhm.sync_package_children() to service_role;
-- Select the latest eligible stable snapshot; scheduled/test releases never hide an older stable release.
create or replace function uhm.published_packages() returns setof jsonb
language sql stable security invoker set search_path='' as $$
 select latest.manifest from uhm.packages p cross join lateral (
  select r.manifest from uhm.package_releases r where r.package_id=p.id
   and coalesce(r.manifest->>'channel','stable')='stable'
   and ((r.manifest->>'scheduled_at') is null or (r.manifest->>'scheduled_at')::timestamptz<=now())
  order by r.published_at desc,r.version desc limit 1
 ) latest where p.status<>'archived' order by p.id;
$$;
