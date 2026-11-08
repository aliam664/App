import { describe, it, expect } from 'vitest';
import {
  safeRelativePath,
  DownloadUrl,
  compareVersions,
  resolvePlan,
  validatePublication,
  PackageSpec,
} from '../packages/contracts/src/index';
import { seedPackages } from '../backend/src/seed';
describe('installation boundary', () => {
  it.each([
    'COM¹.txt',
    'LPT²',
    'CONIN$.cfg',
    'CONOUT$',
    'CLOCK$',
    'x\u007fy',
    'x\u0085y',
    '../escape',
    'C:\\Windows\\x',
    '/etc/passwd',
    '\\\\host\\share',
    'a/../../b',
    'a:ads',
    'CON.ini',
    'dir/NUL',
    'x.',
    'x ',
    'a//b',
    '.uhm/state.json',
    'a/COM1.txt',
    'a\u0000b',
  ])('rejects unsafe path %s', (p) => expect(safeRelativePath(p)).toBe(false));
  it.each(['extension/config/pure.ini', 'content/cars/car/model.kn5', 'پوشه/تست.ini'])(
    'accepts relative game path %s',
    (p) => expect(safeRelativePath(p)).toBe(true),
  );
  it.each([
    'http://example.com/x',
    'https://user:pass@example.com/x',
    'https://127.0.0.1/x',
    'https://169.254.169.254/x',
    'https://[::1]/x',
    'https://localhost/x',
    'https://192.168.1.2/x',
    'https://10.0.0.1/x',
    'https://example.com:8080/x',
  ])('rejects unsafe download %s', (u) => expect(DownloadUrl.safeParse(u).success).toBe(false));
  it('accepts public HTTPS', () =>
    expect(DownloadUrl.safeParse('https://downloads.example.com/test.zip').success).toBe(true));
});
describe('package graph', () => {
  it('sorts dependencies before main package', () => {
    const p = seedPackages();
    expect(resolvePlan(p[0].id, p, 'pro').map((p) => p.id)).toEqual([p[2].id, p[0].id]);
  });
  it('deduplicates shared dependencies', () => {
    const p = seedPackages();
    p[0].dependencies = [p[2].id, p[2].id];
    expect(resolvePlan(p[0].id, p, 'pro')).toHaveLength(2);
  });
  it('rejects cycles', () => {
    const p = seedPackages();
    p[2].dependencies = [p[0].id];
    expect(() => resolvePlan(p[0].id, p, 'pro')).toThrow('DEPENDENCY_CYCLE');
  });
  it('checks dependency subscription separately', () => {
    const p = seedPackages();
    p[2].tier = 'vip';
    expect(() => resolvePlan(p[0].id, p, 'pro')).toThrow('TIER_REQUIRED');
  });
  it('rejects unpublished dependency', () => {
    const p = seedPackages();
    p[2].status = 'draft';
    expect(() => resolvePlan(p[0].id, p, 'pro')).toThrow('DEPENDENCY_UNAVAILABLE');
  });
  it('never publishes a presentation-only package', () => {
    const p = seedPackages();
    expect(() => validatePublication(p[0], p)).toThrow('EMPTY_INSTALL_PLAN');
  });
  it('compares numbers not strings', () =>
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0));
  it('validates sample metadata', () =>
    seedPackages().forEach((p) => expect(PackageSpec.safeParse(p).success).toBe(true)));
});

it('validates archive passwords and original multi-volume filenames without allowing paths', async () => {
  const { FileSpec } = await import('../packages/contracts/src/index');
  const base = {
    id: crypto.randomUUID(),
    name: 'mod.part1.rar',
    url: 'https://files.example.com/mod.part1.rar',
    sha256: 'a'.repeat(64),
    size: 123,
    format: 'rar',
  };
  expect(FileSpec.parse({ ...base, archive_password: 'test-رمز-123' }).archive_password).toBe(
    'test-رمز-123',
  );
  expect(() => FileSpec.parse({ ...base, name: '../secret.rar' })).toThrow();
  expect(() => FileSpec.parse({ ...base, archive_password: 'bad\npassword' })).toThrow();
});

it('accepts richer manifests but rejects unsafe mirror and archive subtree paths', () => {
  const p = seedPackages()[0];
  const file = {
    id: crypto.randomUUID(),
    name: 'pack.zip',
    url: 'https://files.example.com/p.zip',
    size: 100,
    sha256: 'a'.repeat(64),
    format: 'zip',
  };
  const step = {
    id: crypto.randomUUID(),
    file_id: file.id,
    action: 'extract',
    destination: 'content/cars',
    source_subdir: 'wrapper/content/cars',
    overwrite: 'backup',
  };
  expect(
    PackageSpec.safeParse({
      ...p,
      files: [{ ...file, mirrors: ['https://mirror.example.com/p.zip'] }],
      steps: [step],
      content_type: 'skin',
      tags: ['street'],
      channel: 'test',
    }).success,
  ).toBe(true);
  expect(
    PackageSpec.safeParse({
      ...p,
      files: [{ ...file, mirrors: ['https://127.0.0.1/secret'] }],
      steps: [step],
    }).success,
  ).toBe(false);
  expect(
    PackageSpec.safeParse({ ...p, files: [file], steps: [{ ...step, source_subdir: '../escape' }] })
      .success,
  ).toBe(false);
});
it('validates ordered step prerequisites and forbids subtrees on copy', () => {
  const p = PackageSpec.parse({
    ...seedPackages()[2],
    dependencies: [],
    files: [
      {
        id: crypto.randomUUID(),
        name: 'a.zip',
        url: 'https://example.com/a.zip',
        size: 100,
        sha256: 'a'.repeat(64),
        format: 'zip',
      },
    ],
  });
  const a = {
    id: crypto.randomUUID(),
    file_id: p.files[0].id,
    action: 'extract' as const,
    destination: 'content/cars/a',
    overwrite: 'backup' as const,
  };
  const b = { ...a, id: crypto.randomUUID(), destination: 'content/cars/b', depends_on: [a.id] };
  expect(() => validatePublication({ ...p, steps: [a, b] }, [])).not.toThrow();
  expect(() => validatePublication({ ...p, steps: [b, a] }, [])).toThrow('STEP_DEPENDENCY_ORDER');
  expect(() =>
    validatePublication({ ...p, steps: [{ ...a, action: 'copy', source_subdir: 'inner' }] }, []),
  ).toThrow('INVALID_SOURCE_SUBDIR');
});

it('rejects extract subtrees that overlap any other installation destination', () => {
  const base = PackageSpec.parse({ ...seedPackages()[2], dependencies: [] });
  const file = {
    id: crypto.randomUUID(),
    name: 'a.zip',
    url: 'https://example.com/a.zip',
    size: 100,
    sha256: 'a'.repeat(64),
    format: 'zip' as const,
  };
  const extract = {
    id: crypto.randomUUID(),
    file_id: file.id,
    action: 'extract' as const,
    destination: 'content/cars',
    overwrite: 'backup' as const,
  };
  const pkg = { ...base, files: [file], steps: [extract] };
  for (const destination of ['content/cars', 'content/cars/inner', 'content']) {
    const copy = {
      id: crypto.randomUUID(),
      file_id: file.id,
      action: 'copy' as const,
      destination,
      overwrite: 'backup' as const,
    };
    expect(() => validatePublication({ ...pkg, steps: [extract, copy] }, [])).toThrow(
      'DESTINATION_CONFLICT',
    );
    expect(() => validatePublication({ ...pkg, steps: [copy, extract] }, [])).toThrow(
      'DESTINATION_CONFLICT',
    );
  }
  const sibling = { ...extract, id: crypto.randomUUID(), destination: 'content/tracks' };
  expect(() => validatePublication({ ...pkg, steps: [extract, sibling] }, [])).not.toThrow();
});
