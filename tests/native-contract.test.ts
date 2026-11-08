import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('registers each native command in the handler, manifest and least-privilege capability', () => {
  const source = readFileSync('src-tauri/src/main.rs', 'utf8');
  const declared = [...source.matchAll(/#\[tauri::command\]\s*(?:async\s+)?fn\s+(\w+)/g)]
    .map((m) => m[1])
    .sort();
  const handler = source
    .match(/generate_handler!\[([\s\S]*?)\]/)![1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
  const build = readFileSync('src-tauri/build.rs', 'utf8');
  const registered = [...build.match(/\.commands\(&\[([\s\S]*?)\]\)/)![1].matchAll(/"(\w+)"/g)]
    .map((m) => m[1])
    .sort();
  const capability = JSON.parse(readFileSync('src-tauri/capabilities/main.json', 'utf8'));
  const allowed = capability.permissions
    .filter((s: string) => s.startsWith('allow-'))
    .map((s: string) => s.slice(6).replaceAll('-', '_'))
    .sort();
  expect(declared.length).toBeGreaterThan(15);
  expect(handler).toEqual(declared);
  expect(registered).toEqual(declared);
  expect(allowed).toEqual(declared);
  expect(capability.permissions.some((s: string) => /shell:|fs:/.test(s))).toBe(false);
});
it('keeps executable code local while allowing bounded native thumbnails and public catalog images', () => {
  const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  const csp = config.app.security.csp as string;
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toMatch(/script-src[^;]*(https:|unsafe-eval)/);
  expect(csp).toContain('img-src https: data:');
  expect(csp).toContain("object-src 'none'");
});
it('pins a public updater key and version binding without granting webview installer permissions', () => {
  const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  const trust = JSON.parse(readFileSync('config/updater-public.json', 'utf8'));
  const capabilities = JSON.parse(readFileSync('src-tauri/capabilities/main.json', 'utf8'));
  expect(config.plugins.updater.pubkey).toBe(trust.public_key);
  expect(config.plugins.updater.requireSignedVersion).toBe(true);
  expect(config.plugins.updater.allowDowngrades).toBe(false);
  expect(Buffer.from(trust.public_key, 'base64').toString()).toContain('public key');
  expect(capabilities.permissions.some((p: string) => p.startsWith('updater:'))).toBe(false);
});
