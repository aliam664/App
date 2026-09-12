// Single source of truth for bundled content.
//
// Content ships in the `mods/` folder next to the app (bundled as a Tauri
// resource):
//
//   mods/graphics/<tier>/   ← the 5-tier graphics pack, a mirror of the game
//                             folder, copied onto the game root
//   mods/graphics/common/   ← optional, installed for every tier first
//   mods/addons/<id>/       ← optional add-ons (mod.json + preview.png + files/)
//
// The graphics pack is installed as ONE unit (`GRAPHICS_PACK_ID`); add-ons
// are installed/removed individually from the "Add-ons" page.

const GRAPHICS_PACK_ID = 'graphics';

const TIER_DEFINITIONS = [
  { id: 'low', icon: '', image: 'assets/images/tiers/low.webp', weight: 1 },
  { id: 'medium', icon: '', image: 'assets/images/tiers/medium.webp', weight: 2 },
  { id: 'high', icon: '', image: 'assets/images/tiers/high.webp', weight: 3 },
  { id: 'veryhigh', icon: '', image: 'assets/images/tiers/veryhigh.webp', weight: 4 },
  { id: 'ultra', icon: '', image: 'assets/images/tiers/ultra.webp', weight: 5 }
];

/* ---------- Components of the pack (presentation only) ----------
   These describe WHAT the graphics pack contains so the home/about pages
   can explain it. They no longer map to separate install folders. */

const MOD_DEFINITIONS = [
  { id: 'csp', icon: '', nameKey: 'modCsp', descKey: 'modCspDesc', enabled: true },
  { id: 'pure', icon: '', nameKey: 'modPure', descKey: 'modPureDesc', enabled: true },
  { id: 'ppfilter', icon: '', nameKey: 'modPp', descKey: 'modPpDesc', enabled: true },
  { id: 'chasecam', icon: '', nameKey: 'modChase', descKey: 'modChaseDesc', enabled: true },
  { id: 'hud', icon: '', nameKey: 'modHud', descKey: 'modHudDesc', enabled: true },
  { id: 'srp', icon: '', nameKey: 'modSrp', descKey: 'modSrpDesc', enabled: true, prerequisites: ['pure'] },
  { id: 'video', icon: '', nameKey: 'modVideo', descKey: 'modVideoDesc', enabled: true }
];

// Long labels (install log, results, manage page). Add-on names come from
// their own mod.json, so only the pack + legacy ids live here.
const MOD_LABEL = {
  graphics: 'Graphics Pack',
  csp: 'CSP',
  pure: 'PURE',
  ppfilter: 'PP Filter',
  chasecam: 'Chase Cam',
  hud: 'HUD',
  srp: 'SRP Light',
  video: 'Video'
};

// Short labels (chips inside tier cards)
const MOD_LABEL_SHORT = {
  csp: 'CSP',
  pure: 'PURE',
  ppfilter: 'PP',
  chasecam: 'Cam',
  hud: 'HUD',
  srp: 'SRP',
  video: 'Video'
};

const MOD_ICON = { graphics: '', csp: '', pure: '', ppfilter: '', chasecam: '', hud: '', srp: '', video: '' };

// Which components each tier is *described* as containing (chips on cards).
// Actual files are whatever you put in mods/graphics/<tier>/.
const TIER_MODS = {
  low: ['csp', 'ppfilter', 'video'],
  medium: ['csp', 'pure', 'ppfilter', 'video'],
  high: ['csp', 'pure', 'ppfilter', 'chasecam', 'video'],
  veryhigh: ['csp', 'pure', 'ppfilter', 'chasecam', 'hud', 'video'],
  ultra: ['csp', 'pure', 'ppfilter', 'chasecam', 'hud', 'srp', 'video']
};

// Top-level game paths that belong to CSP / PURE. When the user chooses to
// KEEP an existing installation, these are excluded from the pack copy.
const BASE_MOD_PATHS = {
  csp: ['dwrite.dll', 'extension/config', 'extension/lua', 'extension/internal', 'extension/textures', 'extension/shaders', 'extension/fonts', 'extension/weather', 'extension/dwrite.ini'],
  pure: ['extension/config-ext/pure', 'extension/config-ext/Pure', 'extension/pure', 'extension/weather-ext/pure', 'extension/config/pure.ini', 'extension/config/pure_config.ini']
};

window.GRAPHICS_PACK_ID = GRAPHICS_PACK_ID;
window.MOD_DEFINITIONS = MOD_DEFINITIONS;
window.TIER_DEFINITIONS = TIER_DEFINITIONS;
window.MOD_LABEL = MOD_LABEL;
window.MOD_LABEL_SHORT = MOD_LABEL_SHORT;
window.MOD_ICON = MOD_ICON;
window.TIER_MODS = TIER_MODS;
window.BASE_MOD_PATHS = BASE_MOD_PATHS;

/* ---------- Display-name resolution ----------
   graphics pack → localised "Graphics Pack" label
   add-on        → name from its mod.json (cached by the add-ons page)
   legacy id     → MOD_LABEL */
window.ADDON_NAME_CACHE = window.ADDON_NAME_CACHE || {};
window.modDisplayName = function modDisplayName(id) {
  const lang = (window.appState && window.appState.lang) || 'fa';
  if (id === GRAPHICS_PACK_ID) return window.i18n ? window.i18n.t(lang, 'addons.graphicsPack') : MOD_LABEL.graphics;
  const cached = window.ADDON_NAME_CACHE[id];
  if (cached) return cached[lang] || cached.en || cached.fa || id;
  return MOD_LABEL[id] || id;
};
