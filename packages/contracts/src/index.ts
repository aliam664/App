import { z } from 'zod';
export const Tier = z.enum(['normal', 'pro', 'vip']);
export type Tier = z.infer<typeof Tier>;
export const ranks: Record<Tier, number> = { normal: 0, pro: 1, vip: 2 };
export const Role = z.enum(['owner', 'license_manager', 'content_manager', 'support', 'viewer']);
export type Role = z.infer<typeof Role>;
export const Version = z.string().regex(/^\d+\.\d+\.\d+$/, 'نسخه باید مانند 1.2.0 باشد');
export const Id = z.string().uuid();
export function safeRelativePath(input: string): boolean {
  if (!input || input.length > 220 || /[\x00-\x1f:<>"|?*]/.test(input) || /^[\\/]/.test(input))
    return false;
  return input
    .replaceAll('\\', '/')
    .split('/')
    .every(
      (p) =>
        p &&
        p.toLowerCase() !== '.uhm' &&
        p !== '.' &&
        p !== '..' &&
        !/[ .]$/.test(p) &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
    );
}
export const RelativePath = z
  .string()
  .refine(safeRelativePath, 'مسیر نسبی امن داخل پوشه بازی لازم است');
export const DownloadUrl = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      (!u.port || u.port === '443') &&
      !u.username &&
      !u.password &&
      !isPrivateHost(u.hostname)
    );
  }, 'آدرس HTTPS عمومی بدون نام کاربری و رمز لازم است');
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    !h.includes('.') ||
    h.includes(':') ||
    /^(0|10|127)\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^(22[4-9]|23\d|24\d|25[0-5])\./.test(h) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)
  );
}
export const FileSpec = z.object({
  id: Id,
  name: z.string().min(1).max(100),
  url: DownloadUrl,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().positive().max(100_000_000_000),
  format: z.enum(['zip', 'rar', '7z', 'file', 'exe']),
});
export const Step = z.object({
  id: Id,
  file_id: Id,
  action: z.enum(['copy', 'extract']),
  destination: RelativePath,
  overwrite: z.enum(['backup', 'fail']).default('backup'),
});
export const PackageSpec = z.object({
  id: Id,
  slug: z.string().regex(/^[a-z0-9-]{2,64}$/),
  name: z.string().min(2).max(80),
  description: z.string().min(10).max(3000),
  category: z.enum(['graphics', 'tracks', 'cars', 'tools']),
  tier: Tier,
  image: z.string().regex(/^\/images\/(0[1-9]|logo)\.jpg$/),
  version: Version,
  changelog: z.string().max(3000),
  dependencies: z.array(Id).max(30),
  files: z.array(FileSpec).max(30),
  steps: z.array(Step).max(100),
  status: z.enum(['draft', 'published', 'archived']),
  released_at: z.string().datetime().nullable(),
});
export type PackageSpec = z.infer<typeof PackageSpec>;
export type License = {
  id: string;
  code_hash: string;
  prefix: string;
  tier: Tier;
  status: 'unused' | 'active' | 'suspended' | 'revoked';
  duration_days: number;
  created_at: string;
  activated_at: string | null;
  expires_at: string | null;
  device_thumbprint: string | null;
  entitlement_version: number;
  activation_count: number;
};
export type AuditEvent = {
  id: string;
  actor: string;
  action: string;
  target: string;
  created_at: string;
  detail: string;
};
export type InstallReport = {
  id: string;
  license_id: string;
  package_id: string;
  version: string;
  status: 'installed' | 'failed';
  created_at: string;
};
export type Challenge = {
  id: string;
  nonce: string;
  thumbprint: string;
  expires_at: string;
  consumed: boolean;
  purpose: string;
};
export type Admin = { id: string; role: Role; aal: string };
export type Tables = {
  licenses: License;
  packages: PackageSpec;
  audit_events: AuditEvent;
  challenges: Challenge;
  install_reports: InstallReport;
};
export type Table = keyof Tables;
export const GenerateLicenses = z
  .object({
    tier: Tier,
    duration_days: z.number().int().min(1).max(1095),
    count: z.number().int().min(1).max(100),
  })
  .strict();
export const PublicJwk = z
  .object({
    kty: z.literal('EC'),
    crv: z.literal('P-256'),
    x: z.string().min(40).max(50),
    y: z.string().min(40).max(50),
  })
  .strict();
export const Activation = z
  .object({
    code: z.string().min(16).max(100),
    challenge_id: Id,
    public_key: PublicJwk,
    signature: z.string().min(40).max(200),
  })
  .strict();
export const Proof = Activation.omit({ code: true });
export function compareVersions(a: string, b: string): number {
  const aa = Version.parse(a).split('.').map(Number),
    bb = Version.parse(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return 0;
}
export function resolvePlan(id: string, packages: PackageSpec[], tier: Tier): PackageSpec[] {
  const byId = new Map(packages.map((p) => [p.id, p]));
  const visiting = new Set<string>(),
    visited = new Set<string>(),
    result: PackageSpec[] = [];
  function visit(key: string) {
    if (visiting.has(key)) throw new Error('DEPENDENCY_CYCLE');
    if (visited.has(key)) return;
    const pkg = byId.get(key);
    if (!pkg || pkg.status !== 'published') throw new Error('DEPENDENCY_UNAVAILABLE');
    if (ranks[tier] < ranks[pkg.tier]) throw new Error('TIER_REQUIRED');
    visiting.add(key);
    for (const dep of new Set(pkg.dependencies)) visit(dep);
    visiting.delete(key);
    visited.add(key);
    result.push(pkg);
  }
  visit(id);
  return result;
}
export function validatePublication(pkg: PackageSpec, all: PackageSpec[]) {
  if (!pkg.files.length || !pkg.steps.length) throw new Error('EMPTY_INSTALL_PLAN');
  const files = new Map(pkg.files.map((f) => [f.id, f]));
  if (
    files.size !== pkg.files.length ||
    new Set(pkg.steps.map((s) => s.id)).size !== pkg.steps.length
  )
    throw new Error('DUPLICATE_ID');
  const targets = new Set<string>();
  for (const step of pkg.steps) {
    const file = files.get(step.file_id);
    if (!file) throw new Error('UNKNOWN_FILE');
    if (step.action === 'extract' && !['zip', 'rar', '7z'].includes(file.format))
      throw new Error('FORMAT_MISMATCH');
    if (step.action === 'copy' && targets.has(step.destination.toLowerCase()))
      throw new Error('DESTINATION_CONFLICT');
    targets.add(step.destination.toLowerCase());
  }
  resolvePlan(
    pkg.id,
    [...all.filter((p) => p.id !== pkg.id), { ...pkg, status: 'published' }],
    pkg.tier,
  );
}
