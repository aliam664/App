const assert = require('assert');
const { suggestTierFromGpu, suggestTierFromSpecs, parseVramToGb } = require('../src/lib/hardware');

// نقشه‌ی مرجع کاربر
const cases = [
  ['NVIDIA GeForce GTX 1650', 'low'],
  ['NVIDIA GeForce GTX 1050', 'low'],
  ['AMD Radeon RX 580', 'medium'],
  ['NVIDIA GeForce GTX 1660', 'medium'],
  ['NVIDIA GeForce GTX 1660 Ti', 'high'],
  ['NVIDIA GeForce GTX 1660 SUPER', 'high'],
  ['NVIDIA GeForce RTX 2060', 'high'],
  ['NVIDIA GeForce RTX 2060 SUPER', 'veryhigh'],
  ['NVIDIA GeForce GTX 1080', 'veryhigh'],
  ['NVIDIA GeForce RTX 3060', 'ultra'],
  ['NVIDIA GeForce RTX 3070', 'ultra'],
  ['AMD Radeon RX 6600', 'ultra']
];

for (const [gpu, expected] of cases) {
  const result = suggestTierFromGpu(gpu);
  assert.strictEqual(result && result.tier, expected, `${gpu} -> expected ${expected}`);
}

// Fallback بر اساس CPU/RAM وقتی GPU شناسایی نشد
assert.strictEqual(suggestTierFromSpecs({ gpuName: '', totalMemGb: 8, cpuCores: 4 }).tier, 'low');
assert.strictEqual(suggestTierFromSpecs({ gpuName: '', totalMemGb: 16, cpuCores: 8 }).tier, 'high');
assert.strictEqual(suggestTierFromSpecs({ gpuName: '', totalMemGb: 32, cpuCores: 12 }).tier, 'ultra');

// VRAM parser
assert.strictEqual(parseVramToGb('12288'), 12);           // MiB from nvidia-smi
assert.strictEqual(parseVramToGb(12884901888), 12);       // bytes from PowerShell

console.log('HARDWARE TESTS PASSED');
