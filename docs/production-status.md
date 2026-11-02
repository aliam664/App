# UHM production commissioning — 2026-11-02

Separate free-plan project: `ewjvnqlqacljflvjbpbv` (UHM Launcher, us-east-1).
The unrelated TikTacProject has not been modified.

- Database migrations 202611010001, 202611010002, 202611020003 are applied.
- `uhm` is exposed only for service-role use; browser roles have no grants; RLS is enabled.
- Public Auth signup disabled; license/device authentication is the normal entry point.
- Hourly pg_cron job `uhm-ephemeral-cleanup` calls `uhm.cleanup_ephemeral()`.
- First VIP owner license issued unused, unbound, with 3,650 days from first activation.
- Private handoff files are excluded from Git under `operator-private/`.
- Production public configuration is versioned in `config/production-public.json`.
- GitHub integration cannot write Actions variables/secrets (403). Builds instead read the same versioned PUBLIC configuration; no secret was placed in that configuration.

Edge API deployment and live commissioning checks are in progress. Do not interpret the
existence of this file as confirmation of completed live tests. This status is updated
following those checks. Windows installer remains unsigned.
