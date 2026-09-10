/* ------------------------------------------------------------------ */
/*  Hardware detection + smart tier suggestion (main-process safe)     */
/* ------------------------------------------------------------------ */
const { execFile } = require('child_process');
const os = require('os');

function runCmd(cmd, args, timeout = 3000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => {
      resolve(err ? '' : String(stdout || ''));
    });
  });
}

function parseVramToGb(raw, unit) {
  if (!raw) return null;
  const num = parseFloat(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(num) || num <= 0) return null;
  let gb;
  if (unit === 'bytes') {
    gb = num / (1024 * 1024 * 1024);          // AdapterRAM (PowerShell / WMIC)
  } else if (unit === 'mib') {
    gb = num / 1024;                          // nvidia-smi memory.total
  } else {
    // Unit unknown — best-effort heuristic (kept for API compatibility).
    if (num > 1000000) gb = num / (1024 * 1024 * 1024); // bytes
    else if (num > 1000) gb = num / 1024;               // MiB
    else gb = num;                                      // already GB
  }
  return Math.round(gb * 10) / 10;
}

/* ------------------------------------------------------------------ */
/*  Tier suggestion — expanded GPU database + RAM/CPU constraints      */
/*                                                                     */
/*  Reference anchor list (user's test results):                       */
/*    Low        = GTX 1650                                            */
/*    Medium     = RX 580                                              */
/*    High       = GTX 1660 Ti                                         */
/*    VeryHigh   = RTX 2060 SUPER                                      */
/*    Ultra      = RTX 3060 and newer                                  */
/*                                                                     */
/*  Rules:                                                             */
/*   1. Known GPU list is checked first (most specific model wins).    */
/*   2. Unknown GPUs fall back to VRAM (1-2GB always Low).             */
/*   3. RAM is a hard ceiling: <4GB => Low, 4-7GB => Medium,           */
/*      8-15GB => VeryHigh max, >=16GB => no cap.                      */
/*   4. CPU is a soft ceiling: <=2 cores => Medium max, 3-4 => High    */
/*      max, 5-6 => VeryHigh max, >=7 => no cap.                       */
/*   Final tier = min(GPU/VRAM tier, RAM cap, CPU cap).                */
/* ------------------------------------------------------------------ */
const GPU_CHECKS = [
  /* -------- Ultra (RTX 3060 and newer, all RTX 50/40/30 high-end) --- */
  {
    tier: 'ultra',
    re: /\b(rtx\s*(3060(\s*ti)?|3070(\s*ti)?|3080(\s*ti)?|3090(\s*ti)?|4060(\s*ti)?|4070(\s*ti|super|ti\s*super)?|4080(\s*super)?|4090(\s*ti)?|5060(\s*ti)?|5070(\s*ti)?|5080|5090))\b/i
  },
  {
    tier: 'ultra',
    re: /\brx\s*(6600(\s*xt)?|6650(\s*xt)?|6700(\s*xt)?|6750(\s*xt)?|6800(\s*xt)?|6900(\s*xt)?|6950(\s*xt)?|7600(\s*xt)?|7700(\s*xt)?|7800(\s*xt)?|7900(\s*xt|xtx|gre)?)\b/i
  },
  {
    tier: 'ultra',
    re: /\b(arc\s*(a750|a770|b570|b580))\b/i
  },

  /* -------- VeryHigh (RTX 2060 SUPER class + equivalent) ------------ */
  {
    tier: 'veryhigh',
    re: /(2060\s*super|2070(\s*super)?|2080(\s*super)?|gtx\s*1080|rtx\s*3050\s*ti)/i
  },
  {
    tier: 'veryhigh',
    re: /\brx\s*(5700\s*xt|6700\s*xt|6800\s*xt|6900\s*xt)\b/i
  },

  /* -------- High (GTX 1660 Ti class + equivalent) ------------------- */
  {
    tier: 'high',
    re: /(1660\s*ti|1660\s*super|2060|3050|2050|gtx\s*1070(\s*ti)?|gtx\s*980\s*ti|gtx\s*780|mx\s*450|mx\s*550)/i
  },
  {
    tier: 'high',
    re: /\brx\s*(5600(\s*xt)?|5700|vega\s*56)\b|\barc\s*a580\b/i
  },

  /* -------- Medium (RX 580 class + equivalent) ---------------------- */
  {
    tier: 'medium',
    re: /(1650\s*super|1660|1060(\s*ti)?|gtx\s*970|gtx\s*980|gtx\s*770|gtx\s*760|mx\s*250|mx\s*330|mx\s*350)/i
  },
  {
    tier: 'medium',
    re: /\brx\s*(460|470|480|570|580|590|5500\s*xt|6500\s*xt|6500)\b|\br9\s*(380|390)\b/i
  },

  /* -------- Low (GTX 1650 class and below, integrated) -------------- */
  {
    tier: 'low',
    re: /(1650|1050(\s*ti)?|1030|gtx\s*950|gtx\s*960|gtx\s*750(\s*ti)?|gtx\s*740|gtx\s*730|gtx\s*720|gtx\s*710|gt\s*1030|gt\s*710|gtx\s*920|gtx\s*940|mx\s*110|mx\s*130|mx\s*150|mx\s*230)/i
  },
  {
    tier: 'low',
    re: /\brx\s*(530|540|550|560|560\s*xt)\b|\br7\s*(240|250|260|360|370)\b|\br5\s*340\b|\bhd\s*(6870|6750|6770|7750|7770|7850|7870)\b/i
  },
  {
    tier: 'low',
    re: /(intel[^0-9]*(uhd|hd|iris)[^0-9]*|intel\s*arc\s*a380|radeon\s*vega\s*(3|6|8|11)|vega\s*(3|8|11)|integrated|nvidia\s*geforce\s*(gt|mx)\s*\d{2,3})/i
  }
];

function suggestTierFromGpu(gpuName) {
  const name = String(gpuName || '').trim();
  if (!name) return null;
  for (const check of GPU_CHECKS) {
    if (check.re.test(name)) {
      return { tier: check.tier, reason: check.tier, detectedBy: 'gpu' };
    }
  }
  return null;
}

/* Secondary criterion: VRAM. Unknown GPUs are mapped by video memory.
   Every GPU with 1GB or 2GB VRAM always goes to Low. */
function suggestTierFromVram(vramGb) {
  if (!vramGb || vramGb <= 0) return null;
  if (vramGb <= 2) return { tier: 'low', reason: 'vram', detectedBy: 'vram' };
  if (vramGb <= 4) return { tier: 'medium', reason: 'vram', detectedBy: 'vram' };
  if (vramGb <= 6) return { tier: 'high', reason: 'vram', detectedBy: 'vram' };
  if (vramGb <= 8) return { tier: 'veryhigh', reason: 'vram', detectedBy: 'vram' };
  return { tier: 'ultra', reason: 'vram', detectedBy: 'vram' };
}

/* RAM is a hard ceiling because low memory will choke high presets. */
function ramCap(ramGb) {
  const gb = Number(ramGb) || 0;
  if (gb < 4) return 1;   // less than 4GB -> Low max
  if (gb < 8) return 2;   // 4-7GB     -> Medium max
  if (gb < 16) return 4;  // 8-15GB    -> VeryHigh max
  return 5;               // >=16GB    -> no cap
}

/* CPU is a soft ceiling so a weak CPU does not get saddled with heavy presets. */
function cpuCap(cores) {
  const n = Number(cores) || 0;
  if (n <= 2) return 2;   // <=2 cores  -> Medium max
  if (n <= 4) return 3;   // 3-4 cores  -> High max
  if (n <= 6) return 4;   // 5-6 cores  -> VeryHigh max
  return 5;               // >=7 cores  -> no cap
}

function tierScore(tier) {
  return { low: 1, medium: 2, high: 3, veryhigh: 4, ultra: 5 }[tier] || 2;
}

function capToTier(score) {
  return score <= 1 ? 'low' : score === 2 ? 'medium' : score === 3 ? 'high' : score === 4 ? 'veryhigh' : 'ultra';
}

/* Full decision: GPU -> VRAM -> CPU/RAM fallback, then apply RAM/CPU ceilings. */
function suggestTierFromSpecs({ gpuName = '', gpuVramGb = null, cpuCores = 0, totalMemGb = 0 } = {}) {
  // 1) Known GPU list first
  let base = suggestTierFromGpu(gpuName);

  // 2) Unknown GPU: use VRAM as the secondary metric
  if (!base) {
    const byVram = suggestTierFromVram(gpuVramGb);
    if (byVram) base = byVram;
  }

  // 3) Fallback: CPU / RAM if we have nothing else
  if (!base) {
    const memGb = Number(totalMemGb) || 0;
    const cores = Number(cpuCores) || 0;
    let tier = 'medium';
    if (memGb >= 32 && cores >= 12) tier = 'ultra';
    else if (memGb >= 32 && cores >= 8) tier = 'veryhigh';
    else if (memGb >= 16 && cores >= 8) tier = 'high';
    else if (memGb >= 16) tier = 'medium';
    else if (memGb >= 8) tier = 'low';
    base = { tier, reason: tier, detectedBy: 'spec' };
  }

  // Apply RAM & CPU ceilings. Example: RTX 3060 + 4GB RAM -> medium (not ultra).
  const baseScore = tierScore(base.tier);
  const finalScore = Math.min(baseScore, ramCap(totalMemGb), cpuCap(cpuCores));
  const finalTier = capToTier(finalScore);

  const constrained = finalScore < baseScore;
  return {
    tier: finalTier,
    reason: constrained ? `${base.reason}-limited` : base.reason,
    detectedBy: constrained ? `${base.detectedBy}-limited` : base.detectedBy,
    score: finalScore,
    baseTier: base.tier,
    constrained
  };
}

/* ------------------------------------------------------------------ */
/*  OS detection                                                       */
/* ------------------------------------------------------------------ */
async function detectWindowsGpu() {
  // 1) NVIDIA (exact, includes VRAM + driver)
  const nvidia = await runCmd('nvidia-smi', [
    '--query-gpu=name,memory.total,driver_version',
    '--format=csv,noheader,nounits'
  ]);
  if (nvidia.trim()) {
    const parts = nvidia.trim().split(',').map((p) => p.trim());
    if (parts[0]) {
      return {
        gpuName: parts[0],
        gpuVramGb: parseVramToGb(parts[1], 'mib'),
        driverVersion: parts[2] || null,
        source: 'nvidia-smi'
      };
    }
  }

  // 2) PowerShell (robust on modern Windows)
  const ps = await runCmd('powershell.exe', [
    '-NoProfile',
    '-ErrorAction', 'SilentlyContinue',
    '-Command',
    'Get-CimInstance Win32_VideoController | Select-Object -First 1 Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress'
  ]);
  if (ps.trim()) {
    try {
      const json = JSON.parse(ps.trim());
      const name = json.Name || json.name;
      if (name) {
        return {
          gpuName: name,
          gpuVramGb: parseVramToGb(json.AdapterRAM || json.adapterRAM, 'bytes'),
          driverVersion: json.DriverVersion || json.driverVersion || null,
          source: 'powershell'
        };
      }
    } catch (e) { /* fallback */ }
  }

  // 3) WMIC legacy fallback
  const wmic = await runCmd('wmic', ['path', 'win32_VideoController', 'get', 'name,AdapterRAM,DriverVersion', '/format:csv']);
  if (wmic.trim()) {
    const lines = wmic.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length > 1) {
      const parts = lines[1].split(',');
      const name = parts[parts.length - 3];
      const vram = parts[parts.length - 2];
      const driver = parts[parts.length - 1];
      if (name) {
        return {
          gpuName: name.trim(),
          gpuVramGb: parseVramToGb(vram, 'bytes'),
          driverVersion: driver.trim() || null,
          source: 'wmic'
        };
      }
    }
  }
  return null;
}

async function detectLinuxGpu() {
  const lspci = await runCmd('lspci', []);
  const match = lspci.match(/VGA compatible controller[^:]*:\s*(.+)/);
  if (match && match[1]) return { gpuName: match[1].trim(), source: 'lspci' };
  return null;
}

async function detectSystemSpecs() {
  const specs = {
    platform: process.platform,
    osVersion: os.release(),
    cpuName: os.cpus()[0] ? os.cpus()[0].model.trim() : '',
    cpuCores: os.cpus().length,
    totalMemGb: Math.round(os.totalmem() / (1024 * 1024 * 1024) * 10) / 10,
    gpuName: '',
    gpuVramGb: null,
    driverVersion: null,
    gpuSource: null,
    suggestedTier: null,
    detectedBy: null,
    tierReason: null
  };

  let gpu = null;
  try {
    if (process.platform === 'win32') gpu = await detectWindowsGpu();
    else if (process.platform === 'linux') gpu = await detectLinuxGpu();
  } catch (e) {
    // Self-heal: GPU probing must never take down the whole spec detection.
    gpu = null;
  }

  if (gpu) {
    specs.gpuName = gpu.gpuName || '';
    specs.gpuVramGb = gpu.gpuVramGb || null;
    specs.driverVersion = gpu.driverVersion || null;
    specs.gpuSource = gpu.source || null;
  }

  const suggestion = suggestTierFromSpecs({
    gpuName: specs.gpuName,
    gpuVramGb: specs.gpuVramGb,
    cpuCores: specs.cpuCores,
    totalMemGb: specs.totalMemGb
  });
  specs.suggestedTier = suggestion.tier;
  specs.detectedBy = suggestion.detectedBy;
  specs.tierReason = suggestion.reason;
  specs.constrained = Boolean(suggestion.constrained);

  return specs;
}

module.exports = {
  parseVramToGb,
  suggestTierFromGpu,
  suggestTierFromVram,
  suggestTierFromSpecs,
  tierScore,
  ramCap,
  cpuCap,
  detectSystemSpecs
};
