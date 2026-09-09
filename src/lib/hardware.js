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

function parseVramToGb(raw) {
  if (!raw) return null;
  const num = parseFloat(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(num) || num <= 0) return null;
  // nvidia-smi reports MiB, PowerShell AdapterRAM reports bytes
  if (num > 1000000) return Math.round(num / (1024 * 1024 * 1024) * 10) / 10; // bytes
  if (num > 1000) return Math.round(num / 1024 * 10) / 10; // MiB
  return num; // already GB
}

/* ------------------------------------------------------------------ */
/*  Tier suggestion based on the user's reference GPU list             */
/*  Low        = GTX 1650                                              */
/*  Medium     = RX 580                                                */
/*  High       = GTX 1660 Ti                                           */
/*  VeryHigh   = RTX 2060 SUPER                                        */
/*  Ultra      = RTX 3060 and newer                                    */
/* ------------------------------------------------------------------ */
const GPU_CHECKS = [
  {
    tier: 'ultra',
    re: /\b(rtx\s*(3060|3070|3080|3090|4060|4070|4080|4090))\b|\brx\s*(6600|6700|6800|6900|7600|7700|7800|7900)\b/i
  },
  {
    tier: 'veryhigh',
    re: /(2060\s*super|2070|2080|5700\s*xt|5600\s*xt|gtx\s*1080)/i
  },
  {
    tier: 'high',
    re: /(1660\s*ti|1660\s*super|2060|3050|gtx\s*1070|rx\s*590|rx\s*5500)/i
  },
  {
    tier: 'medium',
    re: /(1650\s*super|1660|1060|rx\s*580|rx\s*570|rx\s*480|970|980)/i
  },
  {
    tier: 'low',
    re: /(1650|1050|1030|rx\s*550|rx\s*560|750|760|integrated|intel|vega)/i
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

function suggestTierFromSpecs({ gpuName = '', cpuCores = 0, totalMemGb = 0 } = {}) {
  const byGpu = suggestTierFromGpu(gpuName);
  if (byGpu) return { ...byGpu, score: tierScore(byGpu.tier) };

  // Fallback: اگر GPU قابل تشخیص نبود، بر اساس CPU/RAM پیشنهاد بده
  const memGb = Number(totalMemGb) || 0;
  const cores = Number(cpuCores) || 0;

  let tier = 'medium';
  if (memGb >= 32 && cores >= 12) tier = 'ultra';
  else if (memGb >= 32 && cores >= 8) tier = 'veryhigh';
  else if (memGb >= 16 && cores >= 8) tier = 'high';
  else if (memGb >= 16) tier = 'medium';
  else if (memGb >= 8) tier = 'low';

  return { tier, reason: tier, detectedBy: 'spec', score: tierScore(tier) };
}

function tierScore(tier) {
  return { low: 1, medium: 2, high: 3, veryhigh: 4, ultra: 5 }[tier] || 2;
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
        gpuVramGb: parseVramToGb(parts[1]),
        driverVersion: parts[2] || null,
        source: 'nvidia-smi'
      };
    }
  }

  // 2) PowerShell (robust on modern Windows)
  const ps = await runCmd('powershell.exe', [
    '-NoProfile',
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
          gpuVramGb: parseVramToGb(json.AdapterRAM || json.adapterRAM),
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
          gpuVramGb: parseVramToGb(vram),
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
  if (process.platform === 'win32') gpu = await detectWindowsGpu();
  else if (process.platform === 'linux') gpu = await detectLinuxGpu();

  if (gpu) {
    specs.gpuName = gpu.gpuName || '';
    specs.gpuVramGb = gpu.gpuVramGb || null;
    specs.driverVersion = gpu.driverVersion || null;
    specs.gpuSource = gpu.source || null;
  }

  const suggestion = suggestTierFromSpecs({
    gpuName: specs.gpuName,
    cpuCores: specs.cpuCores,
    totalMemGb: specs.totalMemGb
  });
  specs.suggestedTier = suggestion.tier;
  specs.detectedBy = suggestion.detectedBy;
  specs.tierReason = suggestion.reason;

  return specs;
}

module.exports = {
  parseVramToGb,
  suggestTierFromGpu,
  suggestTierFromSpecs,
  tierScore,
  detectSystemSpecs
};
