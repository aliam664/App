# CHANGELOG

## 0.1.4 — 2026-11-11

### UI / UX

- Public redesign of the Assetto Corsa Launcher: new editorial garage identity, modular CSS (`apps/web/src/styles/`), refreshed brand assets (`mark.svg`, `icon.png`, hero and track artwork) and a rebuilt home/library/package/admin surfaces.
- Full runtime bilingual localization (FA/EN) through `apps/web/src/i18n.ts`; every visible string now switches language without reload.
- Added the Contact Us flow (`apps/web/src/contact.ts`) backed by the new `20261112101846_contact_settings` migration, with an admin-side read path.
- Responsive and WCAG fixes: keyboard focus, contrast, and mobile layout regressions addressed.

### Licensing / backend

- Health reports the real application version; the API, Edge bundle and UI version are asserted to match `package.json` by `tests/release-version.test.ts`.
- Update-key broker accepts only `refs/heads/main` and the fixed session branch `refs/heads/arena/0274db12-app` with matching workflow_ref/subject; the retired `arena/a81c9815-app`, `arena/0b78cac4-app` and `arena/37af8e92-app` are rejected. Numeric repository/owner pins, RS256/OIDC checks and green-build provenance remain mandatory.

### Release / CI

- Version aligned to 0.1.4 across npm, lockfiles, Tauri and Cargo manifests.
- Release/CI/workflow branch pins moved to `arena/0274db12-app`; the historical `0.1.0` pilot workflow keeps its own distinct pins.
- Both Windows installer-upgrade and automatic-update harnesses derive the candidate version from `src-tauri/tauri.conf.json` inside the tested source tree instead of a hardcoded literal or outer branch checkout, fixing the cross-version harness mismatch that broke `0.1.3` smoke re-runs (`43201107637`). The post-release automatic-update smoke targets the reviewed 0.1.2 → 0.1.4 rollout.

### Not included / deferred

- The historical `0.1.0` pilot workflow and its `uhm-platform-v0.1.0-pilot.1` release are unchanged historical records, not part of this release.
- No staged percentage rollout, Authenticode signing claim, real-game validation, or guarantee against a local administrator tampering with offline clock state.

## 0.1.3 — 2026-11-08

### Installer / package manager

- Added a versioned per-file ownership registry (package, version, path, SHA-256, size, transaction, bounded revision history). Identical shared files are allowed; conflicting shared bytes fail closed. Legacy 0.1.2 path-only claims are preserved without inventing hashes.
- Rollback and crash recovery now hash the actual current target before restoring. User edits/deletions after the journal intent are preserved and reported as `needs_review`; original backups remain available. Legacy journals cannot authorize overwriting an existing file.
- Updates prune obsolete files only when their current hash still matches the installed record, with a verified backup and journal entry first. Modified obsolete files are retained.
- Installation preview now includes package version, destination, download size, prerequisites, shared-file owners, per-file hash and downgrade/modified-file warnings before any game mutation.
- Downloads use bounded exponential backoff (500/1000/2000 ms), skip pointless retries for policy/checksum failures, check free space during transfer, and keep the existing Range/resume + mirror + SHA-256 + atomic cache path. External 7z extraction passes `-snl` and rejects case-colliding output paths.

### Licensing / backend

- `/licenses/refresh` rejects licenses whose `starts_at` moved into the future.
- Offline lease is configurable through `UHM_OFFLINE_LEASE_DAYS` (integer 1–30, default 10); refresh interval scales for short leases. Existing 10-day behavior remains the default.
- Health reports the real application version. Release history pagination no longer stops silently at 500 rows.
- Publication validation rejects extract destinations that overlap any other copy/extract destination. Publishing rejects versions that are not newer than every previous release of that package.
- Update-key broker accepts only `main` and the fixed session branch `arena/0b78cac4-app` with matching workflow_ref/subject; the retired `arena/37af8e92-app` is rejected. Numeric repository/owner pins, RS256/OIDC checks and green-build provenance remain mandatory.

### UI / UX

- Batch task state is driven by real per-package native completion events; a later package failure no longer marks earlier confirmed packages as failed or unconfirmed packages as successful.
- Task history shows version/date, explains unavailable dependency retries, and can be cleared when idle. Zero/negative/invalid sizes render correctly (`0 B`, KB/MB/GB) instead of “فایل متصل نشده”.
- Cached browser licenses expire locally; native verification remains the final authority. Admin/library rendering has a stale-generation guard. Recovery conflicts are visible from Settings. Added a redacted clipboard diagnostic report (version/runtime/online/pending count only).

### Release / CI

- Version aligned to 0.1.3 across package, lockfiles, Tauri and Cargo manifests.
- Windows upgrade harness now uses the immutable public 0.1.2 installer as the baseline for 0.1.3, including locked-target failure/retry and fresh-install checks. Post-release automatic-update smoke targets 0.1.2 → 0.1.3.
- Added `cargo clippy --all-targets -D warnings` to Windows CI. Legacy pilot/branch-preview push triggers were retired to prevent stale-branch automation; they remain manually dispatchable.

### Verified locally before publication

- `npm run check`: typecheck + 231 Vitest tests + production build PASS.
- `npm run format:check` PASS; `npm audit --audit-level=high`: 0 vulnerabilities.
- Playwright IPC/platform/admin suite: 26 PASS. Design/keyboard/WCAG suite: 10 PASS.
- `npm run build:pages` + `verify:builds` PASS.
- Verified rollout: Platform checks 42507833044, Pages 42507833088, live check 42507833091, signed release 42508550397 and real 0.1.2→0.1.3 update smoke 42508612506 all SUCCESS. Supabase API v12/broker v3 deployed without migration. See `docs/completion-0.1.3-fa.md` and `docs/server-infrastructure-audit-0.1.3-fa.md`.

### Not included / deferred

- No database migration in 0.1.3. Idempotent license-issuance receipts and install-report dedupe need an additive migration + backup gate and are specified for the next version.
- No staged percentage rollout, Authenticode signing claim, real-game validation, or guarantee against a local administrator tampering with offline clock state.
