-- Cloud-only operations (not PGlite/local app migrations). Run as project owner.
-- No private credentials. Browser roles still cannot access uhm.
alter role authenticator set pgrst.db_schemas = 'public,graphql_public,uhm';
notify pgrst, 'reload config';
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('uhm-ephemeral-cleanup', '17 * * * *', 'select uhm.cleanup_ephemeral();');
