const assert = require('assert');
const { suggestTierFromGpu, suggestTierFromVram, suggestTierFromSpecs, parseVramToGb } = require('../src/lib/hardware');

// نقشه‌ی مرجع کاربر
const cases = [
  ['NVIDIA GeForce GTX 1650', 'low'],
  ['NVIDIA GeForce GTX 1050', 'low'],
  ['NVIDIA GeForce GTX 750', 'low'],
  ['Intel(R) UHD Graphics 630', 'low'],
  ['AMD Radeon RX 580', 'medium'],
  ['NVIDIA GeForce GTX 1660', 'medium'],
  ['AMD Radeon RX 570', 'medium'],
  ['NVIDIA GeForce GTX 1660 Ti', 'high'],
  ['NVIDIA GeForce GTX 1660 SUPER', 'high'],
  ['NVIDIA GeForce RTX 2060', 'high'],
  ['NVIDIA GeForce GTX 1070', 'high'],
  ['AMD Radeon RX 5600 XT', 'high'],
  ['NVIDIA GeForce RTX 2060 SUPER', 'veryhigh'],
  ['NVIDIA GeForce GTX 1080', 'veryhigh'],
  ['NVIDIA GeForce RTX 2070', 'veryhigh'],
  ['AMD Radeon RX 5700 XT', 'veryhigh'],
  ['NVIDIA GeForce RTX 3060', 'ultra'],
  ['NVIDIA GeForce RTX 3070', 'ultra'],
  ['NVIDIA GeForce RTX 4090', 'ultra'],
  ['AMD Radeon RX 6600', 'ultra'],
  ['AMD Radeon RX 7900 XTX', 'ultra']
];

for (const [gpu, expected] of cases) {
  const result = suggestTierFromGpu(gpu);
  assert.strictEqual(result && result.tier, expected, `${gpu} -> expected ${expected}`);
}

// معیار دوم: VRAM — مخصوصاً همه‌ی کارت‌های ۱ و ۲ گیگ → Low
const vramCases = [
  [1, 'low'],
  [2, 'low'],
  [3, 'medium'],
  [4, 'medium'],
  [6, 'high'],
  [8, 'veryhigh'],
  [12, 'ultra']
];
for (const [vram, expected] of vramCases) {
  assert.strictEqual((suggestTierFromVram(vram) || {}).tier, expected, `VRAM ${vram}GB -> ${expected}`);
}

// Unknown GPU + VRAM fallback
assert.strictEqual(suggestTierFromSpecs({ gpuName: 'Some Unknown GPU', gpuVramGb: 1 }).tier, 'low');
assert.strictEqual(suggestTierFromSpecs({ gpuName: 'Some Unknown GPU', gpuVramGb: 2 }).tier, 'low');
assert.strictEqual(suggestTierFromSpecs({ gpuName: 'Some Unknown GPU', gpuVramGb: 12 }).tier, 'ultra');

// Fallback CPU/RAM when GPU and VRAM unknown
assert.strictEqual(suggestTierFromSpecs({ gpuName: '', totalMemGb: 8, cpuCores: 4 }).tier, 'low');
assert.strictEqual(suggestTierFromSpecs({ gpuName: '', totalMemGb: 16, cpuCores: 8 }).tier, 'high');
assert.strictEqual(suggestTierFromSpecs({ gpuName: '', totalMemGb: 32, cpuCores: 12 }).tier, 'ultra');

// VRAM parser
assert.strictEqual(parseVramToGb('12288'), 12);           // MiB from nvidia-smi
assert.strictEqual(parseVramToGb(12884901888), 12);       // bytes from PowerShell

console.log('HARDWARE TESTS PASSED');
