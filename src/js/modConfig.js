// تعریف مودها و سطوح سیستم — مسیر فایل‌ها در src/assets/mod-files نگه‌داری می‌شوند

const MOD_DEFINITIONS = [
  {
    id: 'csp',
    icon: '🌓',
    nameKey: 'modCsp',
    descKey: 'modCspDesc',
    dest: '',
    type: 'copy',
    enabled: true,
    requireUserFiles: true
  },
  {
    id: 'pure',
    icon: '✨',
    nameKey: 'modPure',
    descKey: 'modPureDesc',
    dest: '',
    type: 'copy',
    enabled: true,
    requireUserFiles: true
  },
  {
    id: 'ppfilter',
    icon: '🎨',
    nameKey: 'modPp',
    descKey: 'modPpDesc',
    dest: 'system/cfg',
    type: 'copy',
    enabled: true,
    requireUserFiles: true
  },
  {
    id: 'chasecam',
    icon: '📷',
    nameKey: 'modChase',
    descKey: 'modChaseDesc',
    dest: 'system/cfg',
    type: 'copy',
    enabled: true,
    requireUserFiles: true
  },
  {
    id: 'hud',
    icon: '🖥',
    nameKey: 'modHud',
    descKey: 'modHudDesc',
    dest: '',
    type: 'copy',
    enabled: true,
    requireUserFiles: true
  },
  {
    id: 'srp',
    icon: '💡',
    nameKey: 'modSrp',
    descKey: 'modSrpDesc',
    dest: 'extension/config-ext/pure',
    type: 'copy',
    enabled: true,
    requireUserFiles: true,
    prerequisites: ['pure']
  },
  {
    id: 'video',
    icon: '⚙️',
    nameKey: 'modVideo',
    descKey: 'modVideoDesc',
    dest: 'system/cfg',
    type: 'copy',
    enabled: true,
    requireUserFiles: true
  }
];

const TIER_DEFINITIONS = [
  { id: 'low', icon: '💻', image: 'assets/images/tiers/low.png', weight: 1 },
  { id: 'medium', icon: '🖥️', image: 'assets/images/tiers/medium.png', weight: 2 },
  { id: 'high', icon: '🎮', image: 'assets/images/tiers/high.png', weight: 3 },
  { id: 'veryhigh', icon: '🔥', image: 'assets/images/tiers/veryhigh.png', weight: 4 },
  { id: 'ultra', icon: '🏆', image: 'assets/images/tiers/ultra.png', weight: 5 }
];

/* ---------- Single source of truth for mod presentation ---------- */

// نمایش بلند (نصب، نتیجه، مدیریت)
const MOD_LABEL = {
  csp: 'CSP',
  pure: 'PURE',
  ppfilter: 'PP Filter',
  chasecam: 'Chase Cam',
  hud: 'HUD',
  srp: 'SRP Light',
  video: 'Video'
};

// نمایش کوتاه (چیپ‌های داخل کارت سطح)
const MOD_LABEL_SHORT = {
  csp: 'CSP',
  pure: 'PURE',
  ppfilter: 'PP',
  chasecam: 'Cam',
  hud: 'HUD',
  srp: 'SRP',
  video: 'Video'
};

const MOD_ICON = {
  csp: '🌓',
  pure: '✨',
  ppfilter: '🎨',
  chasecam: '📷',
  hud: '🖥',
  srp: '💡',
  video: '⚙️'
};

// هر سطح سیستم چه زیرمجموعه‌ای از مودها را نصب می‌کند.
// (با TIER_MODS نمایشی در showcase.js و منطق نصب در tierSelect.js یکی است.)
const TIER_MODS = {
  low: ['csp', 'ppfilter', 'video'],
  medium: ['csp', 'pure', 'ppfilter', 'video'],
  high: ['csp', 'pure', 'ppfilter', 'chasecam', 'video'],
  veryhigh: ['csp', 'pure', 'ppfilter', 'chasecam', 'hud', 'video'],
  ultra: ['csp', 'pure', 'ppfilter', 'chasecam', 'hud', 'srp', 'video']
};

window.MOD_DEFINITIONS = MOD_DEFINITIONS;
window.TIER_DEFINITIONS = TIER_DEFINITIONS;
window.MOD_LABEL = MOD_LABEL;
window.MOD_LABEL_SHORT = MOD_LABEL_SHORT;
window.MOD_ICON = MOD_ICON;
window.TIER_MODS = TIER_MODS;
