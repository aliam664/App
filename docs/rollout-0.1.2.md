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
- Original Owner remains VIP/active, device-bound, activation count 1, entitlement version 2, unchanged original expiry.
- Existing package count 2 and member count 4 unchanged. No existing license was activated, reset, reissued or tested against.

## Windows release gates

- Version synchronized to 0.1.2 in npm/Tauri/Cargo manifests and both locks.
- Platform checks **41803227684** passed for initial 0.1.2 source `009cdb31ce7bf79125731e5a02a50ae9ead393e7`: ordinary tests, browser/design checks, native security/recovery, real isolated package chain, audits, NSIS build, actual immutable public 0.1.1 install → candidate upgrade → uninstall/fresh candidate startup.
- Final matching [Platform checks 41804408252](https://github.com/aliam664/App/actions/runs/41804408252) passed for `ffc9a4ad178b79251b20f58c413626d2d17e647e`: fresh application profile; actual locked-EXE NSIS write failure; old-app startup after failure; successful upgrade retry; all web/native/security/package-chain/audit/build gates. Both PowerShell harnesses parsed successfully.
- [Signing/publication 41805407297](https://github.com/aliam664/App/actions/runs/41805407297) succeeded: managed OIDC authorization, unchanged separate updater trust, signature/version binding, publication, full remote feed → installer → cryptographic verification. Non-destructive production checks also passed, including new capabilities and anonymous database denial.
- [Actual automatic upgrade 41805527112](https://github.com/aliam664/App/actions/runs/41805527112) **passed**, starting from immutable public **0.1.1**, not fabricated 0.0.0. Actual old app received the public feed and signed update, rejected modified/truncated cached EXEs with networking blocked, retained settings/content, re-downloaded successfully, deferred with controlled game-process fixture, automatically upgraded on the next safe start and restarted.
- Temporary firewall rules and all synthetic game/install paths are confined to a disposable GitHub Windows runner. No active license or real Assetto Corsa content is used.

## Rollout status

**Published and live, 2026-11-04 09:11:55 UTC.**

- Release: https://github.com/aliam664/App/releases/tag/uhm-launcher-v0.1.2
- EXE: https://github.com/aliam664/App/releases/download/uhm-launcher-v0.1.2/UHM-Launcher-0.1.2-x64-setup.exe
- Feed: https://github.com/aliam664/App/releases/download/uhm-launcher-updates/latest.json
- Source: `ffc9a4ad178b79251b20f58c413626d2d17e647e`; build run `41804408252`.
- Asset `708921023`: **16,462,582 bytes**; GitHub asset digest `sha256:c13afbcc883fed9b484df4ab9b0103da38844981c9b77c6813c8ef7c8d84b395`.
- Live feed independently read back as version **0.1.2**, exact immutable versioned EXE URL and version-bound signature; remote EXE signature verified by the publication run and actual old Windows app.
- Immutable old public 0.1.1 independently checked again: asset `705989995`, 16,446,096 bytes, original SHA256 `1064de0500e37fece771f5ab26b838984353916ca7a7cf0576c6f7348aed17dd` unchanged.
- Final read-only production verification: 16 RLS tables; anonymous reads of custom roles/categories and mutation RPC execution denied; Owner/device binding/expiry/activation/entitlement unchanged; 2 packages and 4 members preserved.

The signed prerelease is active in the dedicated launcher update channel; legacy GitHub latest is intentionally unchanged. Online update-capable installed clients discover it at startup/periodic checks and install only at a safe close/next launch. Very old clients without an updater need the manual installer. This cannot execute remote commands or prove every physical PC installed successfully.

Limits: no Windows Authenticode publisher certificate; no real game/interactive user-PC test or destructive power-loss simulation; no actual activated-owner migration test (deliberately excluded to protect the owner). Personally modified game-file rollback remains unapproved and is not performed; server restore creates a new draft only. Existing historical security-audit findings are not all declared closed by these release gates. See the Persian [release report](release-0.1.2-fa.md) and [guide](admin-guide-fa.md).
