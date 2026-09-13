<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="96" alt="UHM Pack Installer" />

# UHM Pack Installer

**The official graphics-pack and content installer for Assetto Corsa.**

[![Build & Test](https://github.com/aliam664/App/actions/workflows/build.yml/badge.svg)](https://github.com/aliam664/App/actions/workflows/build.yml)
[![Latest release](https://img.shields.io/github/v/release/aliam664/App?label=release&color=006EFB)](https://github.com/aliam664/App/releases/latest)
[![Installer size](https://img.shields.io/github/downloads/aliam664/App/latest/total?label=downloads&color=0087FD)](https://github.com/aliam664/App/releases/latest)
![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-lightgrey)
![Stack](https://img.shields.io/badge/built%20with-Tauri%202%20%C2%B7%20Rust-black)

[**Download**](https://github.com/aliam664/App/releases/latest) · [Administrator guide](ADMIN-GUIDE.md) · [Design system](docs/DESIGN.md) · [Report an issue](https://github.com/aliam664/App/issues)

</div>

---

## Overview

UHM Pack Installer delivers a curated, five-tier graphics package (CSP, Pure, PP filters, HUD and camera presets) to Assetto Corsa in a single guided flow. It detects the player's hardware, recommends a tier, backs up every file it touches, and can revert the installation completely. A drag-and-drop installer for third-party content (cars, tracks, skins, apps, PP filters — ZIP and encrypted RAR) and a content library round out the tool.

The application is a native Windows executable of approximately **4 MB**, built with Tauri 2 and a Rust core. It has no runtime dependencies beyond Microsoft Edge WebView2, which is installed silently when absent.

## Features

| Area | Capability |
|---|---|
| **Graphics pack** | Five quality tiers (`low` → `ultra`); automatic hardware detection (GPU, VRAM, RAM, CPU) with a recommended tier; optional preservation of a user's existing CSP / Pure installation |
| **Safety** | First-write backups of every overwritten file; one-click uninstall that restores originals; strict path containment — nothing is ever written outside the game folder |
| **Add-ons** | Optional apps and extensions with preview, description and per-item install / remove |
| **Content installer** | Drag-and-drop ZIP / RAR (including password-protected RAR); detects cars, tracks, skins, apps, PP filters, fonts, weather; handles wrapper folders |
| **Library** | Browse installed cars and tracks with search, filters, previews and a recycle bin |
| **Interface** | Persian (RTL) and English; night and day themes; motorsport-inspired design system; respects `prefers-reduced-motion` |

## Requirements

- Windows 10 or Windows 11, 64-bit
- Assetto Corsa (Steam)
- Microsoft Edge WebView2 Runtime — installed automatically if missing

## Installation

1. Download `UHM.Pack.Installer_<version>_x64-setup.exe` from the [latest release](https://github.com/aliam664/App/releases/latest).
2. Run the installer. If Windows SmartScreen appears, choose **More info → Run anyway** (the binary is not code-signed).
3. Launch **UHM Pack Installer**, confirm the detected game folder, and follow the on-screen steps.

> [!NOTE]
> Application data (settings, install manifest, backups, recycle bin) is stored in `%APPDATA%\com.uhm.packinstaller`. Removing this folder does **not** affect your game.

> [!IMPORTANT]
> Uninstalling the graphics pack from within the application restores your original files. Uninstalling the *program* via Windows does not touch the game folder.

## Repository layout

```text
.
├── src/            Front-end (HTML · CSS · JavaScript) bundled into the app
├── src-tauri/      Rust core: installer, archive handling, hardware detection, Tauri shell
├── mods/           Content shipped inside the installer  →  see ADMIN-GUIDE.md
├── view/           Generated mirror of src/ — open view/index.html in a browser
├── docs/           Design system and CI workflow template
├── scripts/        Checks, view sync, CI reporter, local static server
├── test/           Front-end tests and RAR fixtures
└── .github/        Build & release workflow
```

## Building from source

```powershell
winget install OpenJS.NodeJS.LTS Rustlang.Rustup Microsoft.VisualStudio.2022.BuildTools
git clone https://github.com/aliam664/App.git && cd App
npm ci
npm run check        # front-end tests + view/ integrity
npm run test:rust    # Rust core tests
npm run dev          # run against a copy of your game folder
npm run build        # → src-tauri/target/release/bundle/nsis/*.exe
```

Continuous integration builds and tests every push; pushing a tag of the form `v*` publishes a GitHub Release with the signed checksum file.

## Security

- All destination paths are resolved and verified to remain inside the game directory before any write.
- Archive entries containing traversal segments are rejected.
- Directory pruning after uninstall never ascends past the game root.
- The web view runs with a restrictive Content-Security-Policy; no remote code is loaded.

To report a vulnerability, open a private security advisory or contact the maintainer directly rather than filing a public issue.

## Contributing

Issues and pull requests are welcome. Please run `npm run check` and `npm run test:rust` before submitting. Visual changes must follow [`docs/DESIGN.md`](docs/DESIGN.md); the `view/` folder is generated — edit `src/` and run `npm run view`.

## License

Application source © UHM. Bundled third-party content remains the property of its respective authors and is distributed under their terms. Fonts: Vazirmatn, Estedad (SIL OFL), Chakra Petch (SIL OFL), JetBrains Mono (SIL OFL).
