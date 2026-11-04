# 0.1.2 deployment ledger — 2026-11-04

## Applied production changes

Only UHM (`ewjvnqlqacljflvjbpbv`) was modified; TikTac was not modified.
Three additive migrations were applied successfully using the connected deployment tool:

| Local file / actual production history version | Name                |
| ---------------------------------------------- | ------------------- |
| `20261104085627`                               | `custom_roles`      |
| `20261104085636`                               | `license_windows`   |
| `20261104085700`                               | `package_workflows` |

Local filenames were aligned to the actual generated history versions (no migration SQL was changed by that alignment). Do not rerun these migrations on production.
API was updated from version 10 to **version 11**, ACTIVE, JWT gateway verification remains disabled because the application verifies its own device-proof/admin tokens. The submitted body is the generated flattened `deployment/edge/api.js` (40,164 bytes), not a network source loader. Expected source SHA256: `a87f5e2e02325bfc1f960d28688000f85bd26100cc768dd8963474431b62cc9b`. The unchanged signing broker remains version 2.

Read-only checks after deployment:

- `/health?deployment=11`: production, original license issuer/key ID/public key; all five content/admin capabilities present.
- `/catalog?deployment=11`: valid response, four configured categories, zero publicly published packages (the two existing package rows were NOT published or modified).
- Anonymous `/admin/overview?deployment=11`: `ADMIN_REQUIRED`.
- Original Owner remains VIP/active, device-bound, activation count 1, entitlement version 2, original expiry `2036-10-30T18:08:06.997939+00:00`.
- Existing package count 2 and member count 4 unchanged. No existing license was activated, reset, reissued or tested against.

## Windows release gates

- Version synchronized to 0.1.2 in npm/Tauri/Cargo manifests and both locks.
- Platform checks **41803227684** passed for initial 0.1.2 source `009cdb31ce7bf79125731e5a02a50ae9ead393e7`: ordinary tests, browser/design checks, native security/recovery, real isolated package chain, audits, NSIS build, actual immutable public 0.1.1 install → candidate upgrade → uninstall/fresh candidate startup.
- A subsequent harness refinement additionally requires a fresh _application profile_ for the final fresh-install startup. This and migration filename alignment require a new matching Platform checks run before signing.
- Automatic signed-feed smoke now starts from the immutable **public 0.1.1**, not a fabricated 0.0.0 build. It includes damaged/truncated cached update rejection under a temporary per-program firewall rule, safe startup/data preservation, successful re-download, controlled game-process deferral, automatic next-start upgrade/restart. It has not yet run for 0.1.2.
- Temporary firewall rules and all synthetic game/install paths are confined to a disposable GitHub Windows runner. No active license or real Assetto Corsa content is used.

## Rollout status

**Not published at this checkpoint.** Live updater feed still offers 0.1.1. The release request has not been changed yet. Publication will make the signed 0.1.2 update discoverable to online supported clients; it cannot execute remote commands or prove every physical PC has installed successfully. Physical rollback of personally modified game files is not authorized or claimed.
