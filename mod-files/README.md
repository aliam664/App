# Mod files

Place the real UHM mod files here. **Full guide (Persian): [../MOD-FILES-GUIDE.md](../MOD-FILES-GUIDE.md)**

| Mod | Folder | Copied into (inside the game folder) |
|---|---|---|
| CSP | csp/ | `<AC>\` |
| PURE | pure/ | `<AC>\` |
| PP Filter | ppfilter/ | `<AC>\system\cfg\` |
| Chase Cam | chasecam/ | `<AC>\system\cfg\` |
| HUD | hud/ | `<AC>\` |
| SRP Light | srp/ | `<AC>\extension\config-ext\pure\` |
| Video | video/ | `<AC>\system\cfg\` |

Two layouts are supported per mod folder (auto-detected):

- **Flat** – everything inside `<mod>/` is copied for every tier.
- **Per-tier** – `<mod>/common/` (all tiers) + `<mod>/low|medium|high|veryhigh|ultra/` (only that tier).
  The tier folder overrides `common/`.

Do not put ZIP/RAR archives here — extract them first. Empty folders are kept with `.gitkeep`.
