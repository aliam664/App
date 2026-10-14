# Changelog — UHM Pack Installer

All notable changes to this project are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning is [SemVer](https://semver.org/).

## [1.2.0] — 2026-10-14

### Added
- **Profile layer for video & CSP settings (the "second layer").** The
  game reads effective settings from `<Documents>\Assetto Corsa\cfg\`
  (`video.ini` and `extension\*.ini` CSP overrides), which win over
  anything in the game folder — so pack settings shipped the old way
  never took effect for most players. The installer now bundles profile
  settings under `mods/settings/{common,<tier>}/` (`video.ini` +
  `csp/*.ini`, see `mods/settings/README.md`) and, with the player's
  consent in step 2, applies them onto the profile:
  - **Video is merged, not overwritten** — the player's `WIDTH`,
    `HEIGHT`, `REFRESH`, `FULLSCREEN` and `VSYNC` always survive; the
    pack's quality keys are applied (`profile::merge_video_ini`).
  - **CSP/Pure settings are copied with first-wins backups** to
    `%APPDATA%\com.uhm.packinstaller\backups\profile\` and recorded
    in the manifest as "Profile Settings", so Manage Mods reverts them
    like any other mod.
  - Step 2 gained two independent opt-ins (both default to apply, both
    fully reversible) in all four languages; detection of existing
    profile files is included.
  - New Rust module `profile.rs` with unit tests (merge semantics,
    source collection, tier override).

### Notes
- The profile layer only ever writes to the two whitelisted profile
  locations (`cfg/video.ini`, `cfg/extension/**.ini`); everything else
  still never leaves the game folder. This is called out in the wizard
  and in ADMIN-GUIDE.md.

## [1.1.0] — 2026-10-14

A stability and data-safety release: every critical bug from the October
2026 audit is fixed, and the installer now preserves the player's own
video / CSP settings by default.

### Added
- **User-settings preservation (step 2 of the wizard).** The pre-install
  check now inspects four groups instead of two: CSP, Pure, **Video
  settings** (`system/cfg/video.ini`) and **CSP/Pure settings** (CSP/Pure
  `*.ini` files under `extension/config` / `extension/config-ext`). The
  two settings groups default to **“keep mine”** (pre-selected); the
  player can still opt to overwrite. Missing files are always installed,
  and the structural `extension/config/data_manifest.ini` always follows
  the installed CSP version. Implemented in the Rust core
  (`installer::settings_group_of`, `ModSpec.preserve`) with unit tests,
  wired through the step-2 UI (`baseModsCheck`) and the install plan
  (`tierSelect`). All four UI languages gained the new strings.
- **Content installs are now removable.** Drag-and-drop installs were
  already recorded by the backend in `manifest.installs` but had no UI;
  the Manage page now lists them (“Content installs (drag & drop)”) with
  a working remove action that restores backups.
- **Release checksums.** The CI workflow now generates `SHA256SUMS.txt`
  next to the installer and attaches it to GitHub Releases, as
  ADMIN-GUIDE.md always promised.

### Fixed (critical audit findings)
- **Cancelled installs are recorded.** Cancelling the pack install
  mid-copy used to skip the manifest write, orphaning the copied files
  with no way to revert them. The outcome (including partial copies) is
  now always recorded, and such entries count as installed for removal.
- **Uninstall removes every file a mod ever placed.** The Manage page
  previously uninstalled only the newest history entry; files unique to
  earlier installs (e.g. a previous tier) survived forever. Removal now
  processes the union of all history entries.
- **Failed installs no longer shadow good ones.** Error/missing entries
  with empty file lists are no longer written on top of the install
  history (both in `install.js` and `addons.js`), which previously made
  the Manage page delete the record while leaving the files on disk.
- **Drag-and-drop backups work on Windows and keep the original.**
  `mod_installer` built its backup path from ids like `car:my_car`; the
  `:` is illegal in Windows paths and aborted overwrites, and the backup
  was silently refreshed on every re-install, destroying the user's
  original file. The id is now sanitised and the first backup always
  wins, mirroring the pack installer.
- **No concurrent installs.** A single running pack/mod install is now
  enforced in the backend (`OperationGuard`); a second attempt returns
  `BUSY` instead of resetting the first run's cancel flag and mixing
  progress events.
- **Trash consistency.** Emptying the content-library trash keeps the
  records of entries whose files failed to delete (instead of wiping the
  whole list and orphaning them), and “move to trash” now copies →
  registers → deletes, so a failed save can no longer lose content.
- **Archive / preview size ceilings.** ZIP extraction refuses archives
  declaring more than 20 GiB uncompressed, ZIP metadata reads are capped
  at 16 MiB, and on-disk previews larger than 16 MiB are not loaded —
  guarding against decompression-bomb archives.

### Changed
- Step-2 summary now counts 4 base items (CSP, Pure, video settings,
  CSP settings) in all four languages.
- Version bumped to 1.1.0 in `package.json`, `src-tauri/tauri.conf.json`
  and `src-tauri/Cargo.toml`.

### Notes
- The bundled `mods/` content folders are still empty in the repository;
  pack content must be placed by the content administrator before
  tagging (see ADMIN-GUIDE.md) — this is a content task, not a code fix.

## [1.0.0] — 2026-09-13

First public release. Five-tier graphics pack installer (CSP, Pure, PP
filters, HUD, camera presets), hardware detection with tier suggestion,
first-write backups with full revert, optional add-ons, drag-and-drop
ZIP/RAR content installer, content library with recycle bin, Persian /
English / Chinese / Japanese UI, night and day themes.
