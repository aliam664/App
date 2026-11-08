-- Editing a new draft must not remove the last published release from the live catalog.
-- The lateral lookup is indexed and does not depend on the admin history page's limit.
create index package_release_latest on uhm.package_releases(package_id,published_at desc);
create function uhm.published_packages() returns setof jsonb
language sql stable security invoker set search_path = '' as $$
  select case when p.status='published' then to_jsonb(p) else latest.manifest end
  from uhm.packages p
  left join lateral (
    select r.manifest from uhm.package_releases r
    where r.package_id=p.id order by r.published_at desc limit 1
  ) latest on true
  where p.status<>'archived' and (p.status='published' or latest.manifest is not null)
  order by p.id;
$$;
revoke all on function uhm.published_packages() from public,anon,authenticated;
grant execute on function uhm.published_packages() to service_role;
