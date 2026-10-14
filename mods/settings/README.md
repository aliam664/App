# mods/settings/ — user-profile settings (layer 2)

This folder holds the pack's **profile-layer** settings: the files the
game actually reads from the player's profile. They are applied (with the
player's consent in step 2 of the wizard) onto:

| Source here | Lands at |
|---|---|
| `video.ini` | `<Documents>\Assetto Corsa\cfg\video.ini` — **merged**: the player's resolution / refresh rate / fullscreen / vsync are always preserved |
| `csp/<name>.ini` (any depth) | `<Documents>\Assetto Corsa\cfg\extension\<name>.ini` — CSP/Pure override files; the player's previous files are backed up first |

Layout mirrors the graphics pack:

```text
settings/
├── common/          settings shared by every tier (applied first)
│   ├── video.ini    optional baseline video template
│   └── csp/*.ini    optional shared CSP/Pure settings
└── <tier>/          low | medium | high | veryhigh | ultra
    ├── video.ini    optional — wins over common/video.ini
    └── csp/*.ini    optional — wins over common/csp/<same name>
```

Rules:

- Everything is **optional**. If a tier (and common) has no `video.ini`,
  the video profile is simply not touched; same for `csp/`.
- Only `*.ini` files under `csp/` are applied; other files are ignored.
- Backups of overwritten profile files go to
  `%APPDATA%\com.uhm.packinstaller\backups\profile\` (first backup wins,
  so the player's original is never clobbered), and removing the
  "Profile Settings" entry in Manage Mods reverts them.
- Do NOT put display resolution in the tier templates expecting it to
  apply — `WIDTH` / `HEIGHT` / `REFRESH` / `FULLSCREEN` / `VSYNC` are
  deliberately taken from the player's file during the merge.
