/** Full real HTTPS feed -> immutable EXE -> signature verification. No GUI install. */
import { verifyUpdateSignature } from './update-signature';
import trust from '../config/updater-public.json';
const version = process.env.APP_VERSION;
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw Error('Expected built version required');
const feed = 'https://github.com/aliam664/App/releases/download/uhm-launcher-updates/latest.json';
async function bytes(url: string, limit: number) {
  const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!response.ok || !response.body)
    throw Error(`Published update unavailable: HTTP ${response.status}`);
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw Error('Published update exceeds safety limit');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
// Bounded retries cover normal release-asset CDN propagation, not validation failures.
let raw: Buffer | undefined;
for (let attempt = 0; attempt < 4; attempt++) {
  try {
    raw = await bytes(feed, 65536);
    break;
  } catch (error) {
    if (attempt === 3) throw error;
    await new Promise((r) => setTimeout(r, 3000));
  }
}
const manifest = JSON.parse(raw!.toString('utf8'));
if (manifest.version !== version) throw Error('Published feed version differs from built version');
const platform = manifest.platforms?.['windows-x86_64'];
const expected = `https://github.com/aliam664/App/releases/download/uhm-launcher-v${version}/UHM-Launcher-${version}-x64-setup.exe`;
if (platform?.url !== expected) throw Error('Unexpected published installer URL');
const installer = await bytes(expected, 128 * 1024 * 1024);
verifyUpdateSignature(installer, platform.signature, trust.public_key, version);
console.log(
  JSON.stringify(
    {
      ok: true,
      version,
      bytes: installer.length,
      checks: [
        'Public update feed',
        'Real remote Windows installer download',
        'Valid artifact signature',
        'Signed version binding',
      ],
    },
    null,
    2,
  ),
);
