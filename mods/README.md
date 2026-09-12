# mods/ — bundled content

Everything in this folder is packaged next to the app and installed onto the
player's Assetto Corsa folder. **Full guide (Persian): [../MODS-GUIDE.md](../MODS-GUIDE.md)**

```
mods/
├── graphics/                 the 5-tier graphics pack (installed as ONE unit)
│   ├── common/               optional — copied for every tier, first
│   ├── low/      medium/     high/     veryhigh/     ultra/
│   │   └── <mirror of the game folder>  e.g. system/cfg/video.ini, extension/…, dwrite.dll
└── addons/                   optional extras — the "Add-ons" page in the app
    └── <id>/                 folder name = id (letters, digits, - _ .); names starting with _ or . are hidden
        ├── mod.json          optional metadata (see _example-addon/mod.json)
        ├── preview.png       card image (png/jpg/webp), ideally 16:9
        └── files/            <mirror of the game folder>
```

Rules
- Folders are mirrors: whatever is inside is copied 1:1 onto the game root, with a backup of every overwritten file.
- Do **not** put ZIP/RAR archives here — extract them first.
- `.gitkeep`, `Thumbs.db`, `desktop.ini`, `.DS_Store` are never copied.
- `mod.json` and `preview.png` are never copied into the game.
