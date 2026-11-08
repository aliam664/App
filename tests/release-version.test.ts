import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import metadata from '../package.json';
import lock from '../package-lock.json';
import tauri from '../src-tauri/tauri.conf.json';
import { appVersion } from '../apps/web/src/version';
it('keeps installer, Cargo, npm, interface and telemetry versions consistent', () => {
  expect(metadata.version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(tauri.version).toBe(metadata.version);
  expect(lock.version).toBe(metadata.version);
  expect(lock.packages[''].version).toBe(metadata.version);
  expect(appVersion).toBe(metadata.version);
  expect(readFileSync('src-tauri/Cargo.toml', 'utf8').match(/^version = "([^"]+)"/m)?.[1]).toBe(
    metadata.version,
  );
  expect(
    readFileSync('src-tauri/Cargo.lock', 'utf8').match(
      /name = "uhm-launcher"\nversion = "([^"]+)"/,
    )?.[1],
  ).toBe(metadata.version);
});
