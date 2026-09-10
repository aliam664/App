const assert = require('assert');
const { suggestTierFromGpu, suggestTierFromVram, suggestTierFromSpecs, parseVramToGb, ramCap, cpuCap } = require('../src/lib/hardware');

/* ===================================================================
   1) GPU database: direct classification (no RAM/CPU constraints)
   =================================================================== */
const gpuCases = [
  // ---- Ultra (RTX 3060 and newer) ----
  ['NVIDIA GeForce RTX 3060', 'ultra'],
  ['NVIDIA GeForce RTX 3060 Ti', 'ultra'],
  ['NVIDIA GeForce RTX 3070', 'ultra'],
  ['NVIDIA GeForce RTX 3070 Ti', 'ultra'],
  ['NVIDIA GeForce RTX 3080', 'ultra'],
  ['NVIDIA GeForce RTX 3090 Ti', 'ultra'],
  ['NVIDIA GeForce RTX 4060', 'ultra'],
  ['NVIDIA GeForce RTX 4070 Ti Super', 'ultra'],
  ['NVIDIA GeForce RTX 4080 Super', 'ultra'],
  ['NVIDIA GeForce RTX 4090', 'ultra'],
  ['NVIDIA GeForce RTX 5060', 'ultra'],
  ['NVIDIA GeForce RTX 5090', 'ultra'],
  ['AMD Radeon RX 6600', 'ultra'],
  ['AMD Radeon RX 6700 XT', 'ultra'],
  ['AMD Radeon RX 7800 XT', 'ultra'],
  ['AMD Radeon RX 7900 XTX', 'ultra'],
  ['Intel Arc A770', 'ultra'],
  ['Intel Arc B580', 'ultra'],

  // ---- VeryHigh (RTX 2060 SUPER class) ----
  ['NVIDIA GeForce RTX 2060 SUPER', 'veryhigh'],
  ['NVIDIA GeForce RTX 2070', 'veryhigh'],
  ['NVIDIA GeForce RTX 2070 Super', 'veryhigh'],
  ['NVIDIA GeForce RTX 2080', 'veryhigh'],
  ['NVIDIA GeForce GTX 1080', 'veryhigh'],
  ['NVIDIA GeForce RTX 3050 Ti', 'veryhigh'],
  ['AMD Radeon RX 5700 XT', 'veryhigh'],
  ['AMD Radeon RX 6700 XT', 'ultra'], // already ultra, override below by first match? keep as ultra

  // ---- High (GTX 1660 Ti class) ----
  ['NVIDIA GeForce GTX 1660 Ti', 'high'],
  ['NVIDIA GeForce GTX 1660 SUPER', 'high'],
  ['NVIDIA GeForce RTX 2060', 'high'],
  ['NVIDIA GeForce RTX 3050', 'high'],
  ['NVIDIA GeForce GTX 1070', 'high'],
  ['NVIDIA GeForce GTX 1070 Ti', 'high'],
  ['NVIDIA GeForce GTX 980 Ti', 'high'],
  ['AMD Radeon RX 5600 XT', 'high'],
  ['AMD Radeon RX 5700', 'high'],
  ['AMD Radeon RX Vega 56', 'high'],
  ['Intel Arc A580', 'high'],

  // ---- Medium (RX 580 class) ----
  ['NVIDIA GeForce GTX 1650 SUPER', 'medium'],
  ['NVIDIA GeForce GTX 1660', 'medium'],
  ['NVIDIA GeForce GTX 1060', 'medium'],
  ['NVIDIA GeForce GTX 1060 6GB', 'medium'],
  ['NVIDIA GeForce GTX 970', 'medium'],
  ['NVIDIA GeForce GTX 980', 'medium'],
  ['NVIDIA GeForce GTX 770', 'medium'],
  ['NVIDIA GeForce GTX 760', 'medium'],
  ['AMD Radeon RX 580', 'medium'],
  ['AMD Radeon RX 570', 'medium'],
  ['AMD Radeon RX 480', 'medium'],
  ['AMD Radeon RX 5500 XT', 'medium'],
  ['AMD Radeon RX 6500 XT', 'medium'],

  // ---- Low (GTX 1650 class and below) ----
  ['NVIDIA GeForce GTX 1650', 'low'],
  ['NVIDIA GeForce GTX 1050', 'low'],
  ['NVIDIA GeForce GTX 1050 Ti', 'low'],
  ['NVIDIA GeForce GT 1030', 'low'],
  ['NVIDIA GeForce GTX 750 Ti', 'low'],
  ['NVIDIA GeForce GTX 950', 'low'],
  ['NVIDIA GeForce GTX 960', 'low'],
  ['NVIDIA GeForce MX 150', 'low'],
  ['AMD Radeon RX 550', 'low'],
  ['AMD Radeon RX 560', 'low'],
  ['AMD Radeon R7 360', 'low'],
  ['AMD Radeon HD 7750', 'low'],
  ['Intel(R) UHD Graphics 630', 'low'],
  ['Intel(R) HD Graphics 520', 'low'],
  ['Intel(R) Iris(R) Xe Graphics', 'low'],
  ['Intel Arc A380', 'low'],
  ['AMD Radeon Vega 8', 'low'],
  ['AMD Radeon Integrated Graphics', 'low']
];

for (const [gpu, expected] of gpuCases) {
  const result = suggestTierFromGpu(gpu);
  assert.strictEqual(result && result.tier, expected, `${gpu} -> expected ${expected}, got ${result && result.tier}`);
}

/* ===================================================================
   2) VRAM secondary metric (unknown GPUs) — 1/2GB always Low
   =================================================================== */
const vramCases = [
  [1, 'low'], [2, 'low'], [3, 'medium'], [4, 'medium'], [5, 'high'],
  [6, 'high'], [8, 'veryhigh'], [12, 'ultra']
];
for (const [vram, expected] of vramCases) {
  assert.strictEqual((suggestTierFromVram(vram) || {}).tier, expected, `VRAM ${vram}GB -> ${expected}`);
}

/* ===================================================================
   3) RAM / CPU caps
   =================================================================== */
// RAM < 4GB forces Low
assert.strictEqual(ramCap(2), 1);
assert.strictEqual(ramCap(3), 1);
assert.strictEqual(ramCap(4), 2);
assert.strictEqual(ramCap(8), 4);
assert.strictEqual(ramCap(16), 5);

// CPU caps
assert.strictEqual(cpuCap(2), 2);
assert.strictEqual(cpuCap(4), 3);
assert.strictEqual(cpuCap(6), 4);
assert.strictEqual(cpuCap(8), 5);

/* ===================================================================
   4) Full decision with RAM/CPU constraints
   =================================================================== */
// RTX 3060 (ultra GPU) but only 4GB RAM / 4 cores -> must fall to medium
let r = suggestTierFromSpecs({ gpuName: 'NVIDIA GeForce RTX 3060', totalMemGb: 4, cpuCores: 4 });
assert.strictEqual(r.tier, 'medium');
assert.strictEqual(r.baseTier, 'ultra');
assert.strictEqual(r.constrained, true);

// RTX 3060 + 8GB + 4 cores -> high (RAM cap veryhigh, CPU cap high)
r = suggestTierFromSpecs({ gpuName: 'NVIDIA GeForce RTX 3060', totalMemGb: 8, cpuCores: 4 });
assert.strictEqual(r.tier, 'high');

// RTX 3060 + 16GB + 8 cores -> ultra
r = suggestTierFromSpecs({ gpuName: 'NVIDIA GeForce RTX 3060', totalMemGb: 16, cpuCores: 8 });
assert.strictEqual(r.tier, 'ultra');

// GTX 1650 stays low even with a beast CPU/RAM (GPU is the limiting factor)
r = suggestTierFromSpecs({ gpuName: 'NVIDIA GeForce GTX 1650', totalMemGb: 32, cpuCores: 16 });
assert.strictEqual(r.tier, 'low');

// Unknown GPU with 2GB VRAM always Low, even with 32GB RAM / 16 cores
r = suggestTierFromSpecs({ gpuName: 'Some Unknown GPU', gpuVramGb: 2, totalMemGb: 32, cpuCores: 16 });
assert.strictEqual(r.tier, 'low');

// Unknown GPU with 12GB VRAM -> ultra if RAM/CPU allow
r = suggestTierFromSpecs({ gpuName: 'Some Unknown GPU', gpuVramGb: 12, totalMemGb: 16, cpuCores: 8 });
assert.strictEqual(r.tier, 'ultra');

// Unknown GPU with 8GB VRAM + 8GB RAM + 4 cores -> high (constrained)
r = suggestTierFromSpecs({ gpuName: 'Some Unknown GPU', gpuVramGb: 8, totalMemGb: 8, cpuCores: 4 });
assert.strictEqual(r.tier, 'high');

// No GPU/VRAM -> CPU/RAM fallback
let fb = suggestTierFromSpecs({ totalMemGb: 8, cpuCores: 4 });
assert.strictEqual(fb.tier, 'low');
fb = suggestTierFromSpecs({ totalMemGb: 16, cpuCores: 8 });
assert.strictEqual(fb.tier, 'high');
fb = suggestTierFromSpecs({ totalMemGb: 32, cpuCores: 12 });
assert.strictEqual(fb.tier, 'ultra');

/* ===================================================================
   5) VRAM parser
   =================================================================== */
assert.strictEqual(parseVramToGb('12288'), 12);           // MiB from nvidia-smi
assert.strictEqual(parseVramToGb(12884901888), 12);       // bytes from PowerShell
assert.strictEqual(parseVramToGb('2048'), 2);

// Explicit units (sources now pass the unit they actually report)
assert.strictEqual(parseVramToGb('512', 'mib'), 0.5);     // 512 MiB GPU — was misread as 512 GB
assert.strictEqual(parseVramToGb('8192', 'mib'), 8);
assert.strictEqual(parseVramToGb(536870912, 'bytes'), 0.5); // 512 MB AdapterRAM
assert.strictEqual(parseVramToGb(8589934592, 'bytes'), 8);
assert.strictEqual(parseVramToGb('0', 'mib'), null);      // invalid → null
assert.strictEqual(parseVramToGb(null), null);
assert.strictEqual(parseVramToGb(0xFFFFFFFF, 'bytes'), null); // AdapterRAM "unknown" sentinel
assert.strictEqual(parseVramToGb('4294967295', 'bytes'), null);

console.log('HARDWARE TESTS PASSED');
