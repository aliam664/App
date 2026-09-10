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

window.MOD_DEFINITIONS = MOD_DEFINITIONS;
window.TIER_DEFINITIONS = TIER_DEFINITIONS;
