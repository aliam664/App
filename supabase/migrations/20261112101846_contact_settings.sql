-- Dynamic bilingual Contact Us settings with RLS, optimistic concurrency and atomic audit log.
create table uhm.contact_settings (
 id uuid primary key,
 headline_fa text not null default '' check(length(headline_fa)<=120),
 headline_en text not null default '' check(length(headline_en)<=120),
 intro_fa text not null default '' check(length(intro_fa)<=600),
 intro_en text not null default '' check(length(intro_en)<=600),
 email text not null default '' check(length(email)<=160),
 phone text not null default '' check(length(phone)<=40),
 telegram text not null default '' check(length(telegram)<=256),
 discord text not null default '' check(length(discord)<=256),
 instagram text not null default '' check(length(instagram)<=256),
 youtube text not null default '' check(length(youtube)<=256),
 website text not null default '' check(length(website)<=256),
 support_hours_fa text not null default '' check(length(support_hours_fa)<=160),
 support_hours_en text not null default '' check(length(support_hours_en)<=160),
 location_fa text not null default '' check(length(location_fa)<=160),
 location_en text not null default '' check(length(location_en)<=160),
 response_note_fa text not null default '' check(length(response_note_fa)<=300),
 response_note_en text not null default '' check(length(response_note_en)<=300),
 extra_links jsonb not null default '[]' check(jsonb_typeof(extra_links)='array' and jsonb_array_length(extra_links)<=6),
 version integer not null default 1,
 updated_at timestamptz not null default now(),
 updated_by text not null default ''
);
alter table uhm.contact_settings enable row level security;
revoke all on uhm.contact_settings from public,anon,authenticated;
grant select,insert,update on uhm.contact_settings to service_role;

create function uhm.save_contact_settings(p_contact jsonb,p_actor text,p_expected_version integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare old_row uhm.contact_settings; next_row uhm.contact_settings; begin
 perform pg_advisory_xact_lock(20261109);
 select * into old_row from uhm.contact_settings where id=(p_contact->>'id')::uuid for update;
 if coalesce(old_row.version,0)<>p_expected_version then raise exception 'EDIT_CONFLICT'; end if;
 insert into uhm.contact_settings(
  id,headline_fa,headline_en,intro_fa,intro_en,email,phone,telegram,discord,instagram,youtube,website,
  support_hours_fa,support_hours_en,location_fa,location_en,response_note_fa,response_note_en,extra_links,
  version,updated_at,updated_by
 ) values (
  (p_contact->>'id')::uuid,
  coalesce(p_contact->>'headline_fa',''),
  coalesce(p_contact->>'headline_en',''),
  coalesce(p_contact->>'intro_fa',''),
  coalesce(p_contact->>'intro_en',''),
  coalesce(p_contact->>'email',''),
  coalesce(p_contact->>'phone',''),
  coalesce(p_contact->>'telegram',''),
  coalesce(p_contact->>'discord',''),
  coalesce(p_contact->>'instagram',''),
  coalesce(p_contact->>'youtube',''),
  coalesce(p_contact->>'website',''),
  coalesce(p_contact->>'support_hours_fa',''),
  coalesce(p_contact->>'support_hours_en',''),
  coalesce(p_contact->>'location_fa',''),
  coalesce(p_contact->>'location_en',''),
  coalesce(p_contact->>'response_note_fa',''),
  coalesce(p_contact->>'response_note_en',''),
  coalesce(p_contact->'extra_links','[]'::jsonb),
  1,
  now(),
  coalesce(p_actor,'')
 )
 on conflict(id) do update set
  headline_fa=excluded.headline_fa,
  headline_en=excluded.headline_en,
  intro_fa=excluded.intro_fa,
  intro_en=excluded.intro_en,
  email=excluded.email,
  phone=excluded.phone,
  telegram=excluded.telegram,
  discord=excluded.discord,
  instagram=excluded.instagram,
  youtube=excluded.youtube,
  website=excluded.website,
  support_hours_fa=excluded.support_hours_fa,
  support_hours_en=excluded.support_hours_en,
  location_fa=excluded.location_fa,
  location_en=excluded.location_en,
  response_note_fa=excluded.response_note_fa,
  response_note_en=excluded.response_note_en,
  extra_links=excluded.extra_links,
  version=uhm.contact_settings.version+1,
  updated_at=now(),
  updated_by=excluded.updated_by
 returning * into next_row;
 insert into uhm.audit_events(actor,action,target,detail)
 values(p_actor,'contact.settings.changed',next_row.id::text,jsonb_build_object('before',to_jsonb(old_row),'after',to_jsonb(next_row))::text);
 return to_jsonb(next_row);
end $$;
revoke execute on function uhm.save_contact_settings(jsonb,text,integer) from public,anon,authenticated;
grant execute on function uhm.save_contact_settings(jsonb,text,integer) to service_role;
