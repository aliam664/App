# CHANGELOG

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
- `npm run check`: typecheck + 228 Vitest tests + production build PASS.
- `npm run format:check` PASS; `npm audit --audit-level=high`: 0 vulnerabilities.
- Playwright IPC/platform/admin suite: 26 PASS. Design/keyboard/WCAG suite: 10 PASS.
- `npm run build:pages` + `verify:builds` PASS.
- Windows native tests/build/upgrade and live deployment results are recorded in `docs/release-0.1.3-fa.md` only after the corresponding CI/deploy operations complete.

### Not included / deferred
- No database migration in 0.1.3. Idempotent license-issuance receipts and install-report dedupe need an additive migration + backup gate and are specified for the next version.
- No staged percentage rollout, Authenticode signing claim, real-game validation, or guarantee against a local administrator tampering with offline clock state.
