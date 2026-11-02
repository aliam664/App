# UHM commissioning record — 2026-11-02

## Live destination

- Separate **free-plan** project `ewjvnqlqacljflvjbpbv` — UHM Launcher, us-east-1. The unrelated TikTacProject was not changed.
- API: `https://ewjvnqlqacljflvjbpbv.supabase.co/functions/v1/api`
- Edge `api` version **8**, ACTIVE; health returns production identity and the public trust in `config/production-public.json`.
- Deployed body: generated **deployment/edge/api.js**. Its SHA-256 and three exact npm versions are in `deployment/edge/cloud-integrity.json`. No GitHub remote import or runtime eval remains in the deployment.
- Application source used for this deployment and installer: `05e694fecc0b3fac8661c09e319f631f8d8da22c`.
- Migrations `202611010001`, `202611010002`, `202611020003` are applied; cloud history reconciled to filenames. 11 application tables use RLS; browser roles have no private-schema grants.
- Public Auth signup disabled. First owner is license-based, VIP, 3,650 days from first activation, all 17 permissions. **User's owner license is unused, activation_count=0, no device binding.** No user Auth account/MFA factor was fabricated.
- Hourly pg_cron job `uhm-ephemeral-cleanup` is installed; it is not a backup job.

## Verification and cleanup

- Local: 100 unit tests (99 before initial deployment; one cloud-artifact integrity regression added afterward), 14 normal browser tests and 4 static Pages tests passed before source deployment; the final private-file regression brings normal browser tests to 15; production builds and format/type checks passed.
- [Platform checks 41474918733](https://github.com/aliam664/App/actions/runs/41474918733): web/API and Windows jobs SUCCESS, including native tests, cargo audit and production-connected unsigned NSIS installer.
- [Branch publication 41474919070](https://github.com/aliam664/App/actions/runs/41474919070): SUCCESS. Pages API reports built `ae2b7212f60711c51abb3cb38f304c489294b5d6`, no error. Connected shared UI is stored in the branch fallback.
- Live commissioning exercised production identity, catalog, approved/denied CORS, OPTIONS, direct publishable-key database denial, ES256/device-bound activation, owner permissions, proof replay rejection, issuance, concurrent two-device activation, viewer delegation, denied mutations and immediate permission revocation. Database audit records preserve these operations.
- The long synchronous test exceeded the observation tool's response window, which retried and encountered the already-bound throwaway license. It was not counted as a successful full-suite response. A separate asynchronous run persisted its real result: `deployment.smoke.finished`, run **1eda7d2d-e105-4722-8f46-d22da7f4cad5**, **ok=true**, verified **2026-11-02T15:55:11.318Z**. It confirmed owner activation/all 17 permissions, proof-authenticated event uploaded twice with exactly one stored row, history and database analytics.
- Temporary commissioning function and both temporary test secrets were deleted. Throwaway owner and subordinate licenses were revoked/archived and their admin access disabled. Audit/telemetry evidence retained, so initial charts can contain a few clearly marked deployment-test events. These are not customer activity.

## Installer and boundaries

The installer artifact is `uhm-windows-production-unsigned` from run 41474918733. Stable pilot release: **uhm-platform-v0.1.0-pilot.1** (published by the dedicated provenance-checked release workflow). [Release workflow 41477227219](https://github.com/aliam664/App/actions/runs/41477227219) SUCCESS; release and both assets confirmed published at 2026-11-02T16:00:59Z. Installer SHA-256: `eac1696ac94016ff8ceca9d78197afa0d6900cc3cf72f727506d8ec5c4c79aae` (17,031,227 bytes). The older Electron release v1.0.0 is not replaced.

This is an operational **pilot**, not a claim of commercial security certification. No real mod/game package was seeded as if usable. Actual game/uploader installation on the user's machine, Authenticode, signed updater, load/security review, external automated backup/restore, capacity monitoring and retention remain release/operations gates. External bot integration is not configured.

GitHub integration cannot write Actions variables/secrets (403). Public configuration is read from the versioned public JSON; no private credential workaround was used. Operator handoff/recovery files are excluded from Git under `operator-private/`. Download them and keep encrypted independent backups; the encrypted credentials archive is not a database backup.

Final source packaging/runbooks CI [41477226862](https://github.com/aliam664/App/actions/runs/41477226862) and website refresh [41477226703](https://github.com/aliam664/App/actions/runs/41477226703) also completed SUCCESS.

## Final hardening

Private operator handoff is excluded from both Git and Vite filesystem serving, including direct, `@fs`, raw and import routes. A dedicated browser regression checks the deny rules without reading real credentials. The old sandbox preview process was stopped; the real website is the handoff URL. Cloud verification: all 11 tables have RLS, anon SELECT grants=0, one enabled owner, unused primary owner, cleanup job active, initial database size 11,728,563 bytes.
