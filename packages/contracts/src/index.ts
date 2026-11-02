import { z } from 'zod';
export const Tier = z.enum(['normal', 'pro', 'vip']);
export type Tier = z.infer<typeof Tier>;
export const ranks: Record<Tier, number> = { normal: 0, pro: 1, vip: 2 };
export const Role = z.enum(['owner', 'license_manager', 'content_manager', 'support', 'viewer']);
export type Role = z.infer<typeof Role>;
export const Permission = z.enum([
  'licenses.read',
  'licenses.create',
  'licenses.update',
  'licenses.suspend',
  'licenses.revoke',
  'licenses.reset',
  'licenses.extend',
  'licenses.archive',
  'content.read',
  'content.write',
  'content.publish',
  'analytics.read',
  'errors.read',
  'errors.resolve',
  'team.manage',
  'service.manage',
  'audit.read',
]);
export type Permission = z.infer<typeof Permission>;
export const rolePermissions: Record<Role, Permission[]> = {
  owner: [...Permission.options],
  license_manager: Permission.options.filter(
    (p) => p.startsWith('licenses.') || ['analytics.read', 'errors.read'].includes(p),
  ),
  content_manager: [
    'content.read',
    'content.write',
    'content.publish',
    'analytics.read',
    'errors.read',
  ],
  support: [
    'licenses.read',
    'licenses.update',
    'content.read',
    'analytics.read',
    'errors.read',
    'errors.resolve',
  ],
  viewer: ['content.read', 'analytics.read'],
};
export function hasPermission(admin: Pick<Admin, 'role' | 'permissions'>, permission: Permission) {
  return (
    admin.role === 'owner' ||
    (admin.permissions ?? rolePermissions[admin.role]).includes(permission)
  );
}
export const AccessInput = z
  .object({
    role: Role,
    permissions: z.array(Permission).max(Permission.options.length),
    enabled: z.boolean(),
  })
  .strict();
export type AdminAccess = z.infer<typeof AccessInput> & {
  id: string;
  version: number;
  updated_at: string;
};
export const EventInput = z
  .object({
    id: z.string().uuid(),
    type: z.enum([
      'app_open',
      'download_started',
      'download_completed',
      'download_failed',
      'package_download_completed',
      'install_started',
      'install_completed',
      'install_failed',
      'app_error',
    ]),
    occurred_at: z.string().datetime(),
    session_id: z.string().uuid(),
    package_id: z.string().uuid().optional(),
    version: z.string().max(30).optional(),
    file_id: z.string().uuid().optional(),
    file_name: z
      .string()
      .max(100)
      .refine((v) => safeRelativePath(v) && !/[\\/]/.test(v))
      .optional(),
    host: z
      .string()
      .regex(/^[a-zA-Z0-9.-]{1,253}$/)
      .optional(),
    bytes: z.number().int().min(0).max(100_000_000_000).optional(),
    duration_ms: z.number().int().min(0).max(604800000).optional(),
    error_code: z
      .string()
      .regex(/^[A-Z0-9_]{1,80}$/)
      .optional(),
    stage: z.enum(['app', 'download', 'verify', 'extract', 'install', 'recovery']).optional(),
    app_version: z.string().max(30).optional(),
  })
  .strict();
export type ClientEvent = z.infer<typeof EventInput>;
export type TelemetryEvent = ClientEvent & {
  license_id: string;
  received_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
};
export const ServiceInput = z
  .object({
    maintenance: z.boolean(),
    activation_paused: z.boolean(),
    issuance_paused: z.boolean(),
    downloads_paused: z.boolean(),
    message: z.string().max(500),
  })
  .strict();
export type ServiceSettings = z.infer<typeof ServiceInput> & { id: string; updated_at: string };
export const SERVICE_ID = '00000000-0000-4000-8000-000000000001';
export const defaultService = (): ServiceSettings => ({
  id: SERVICE_ID,
  maintenance: false,
  activation_paused: false,
  issuance_paused: false,
  downloads_paused: false,
  message: '',
  updated_at: new Date().toISOString(),
});
export const Version = z.string().regex(/^\d+\.\d+\.\d+$/, 'نسخه باید مانند 1.2.0 باشد');
export const Id = z.string().uuid();
export function safeRelativePath(input: string): boolean {
  if (
    !input ||
    input.length > 220 ||
    /[\x00-\x1f\x7f-\x9f:<>"|?*]/.test(input) ||
    /^[\\/]/.test(input)
  )
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
        !/^(con|prn|aux|nul|conin\$|conout\$|clock\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(p),
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
  name: z
    .string()
    .min(1)
    .max(100)
    .refine((v) => safeRelativePath(v) && !/[\\/]/.test(v), 'نام امن فایل بدون مسیر لازم است'),
  url: DownloadUrl,
  mirrors: z.array(DownloadUrl).max(5).optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().positive().max(100_000_000_000),
  archive_password: z
    .string()
    .max(256)
    .refine((v) => !/[\x00-\x1f\x7f]/.test(v), 'رمز نباید کاراکتر کنترلی داشته باشد')
    .optional(),
  format: z.enum(['zip', 'rar', '7z', 'file', 'exe']),
});
export const Step = z.object({
  id: Id,
  file_id: Id,
  action: z.enum(['copy', 'extract']),
  destination: RelativePath,
  overwrite: z.enum(['backup', 'fail']).default('backup'),
  source_subdir: RelativePath.optional(),
  depends_on: z.array(Id).max(100).optional(),
});
export const PackageSpec = z.object({
  id: Id,
  slug: z.string().regex(/^[a-z0-9-]{2,64}$/),
  name: z.string().min(2).max(80),
  description: z.string().min(10).max(3000),
  category: z.enum(['graphics', 'tracks', 'cars', 'tools']),
  tier: Tier,
  image: z.union([z.string().regex(/^\/images\/(0[1-9]|logo)\.jpg$/), DownloadUrl]),
  version: Version,
  short_description: z.string().max(240).optional(),
  content_type: z
    .enum(['car', 'track', 'skin', 'python_app', 'lua_app', 'csp', 'ppfilter', 'pack'])
    .optional(),
  author: z.string().max(120).optional(),
  brand: z.string().max(120).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  images: z.array(DownloadUrl).max(8).optional(),
  channel: z.enum(['stable', 'test']).optional(),
  scheduled_at: z.string().datetime().nullable().optional(),
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
  display_name?: string;
  notes?: string;
  tags?: string[];
  archived?: boolean;
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
export type Admin = {
  id: string;
  role: Role;
  aal: string;
  permissions?: Permission[];
  license_id?: string;
  auth_method?: 'license' | 'account';
};
export type Tables = {
  licenses: License;
  packages: PackageSpec;
  audit_events: AuditEvent;
  challenges: Challenge;
  install_reports: InstallReport;
  admin_access: AdminAccess;
  telemetry_events: TelemetryEvent;
  service_settings: ServiceSettings;
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
  if (new Set(pkg.files.map((f) => f.name.toLowerCase())).size !== pkg.files.length)
    throw new Error('DUPLICATE_FILENAME');
  const files = new Map(pkg.files.map((f) => [f.id, f]));
  if (
    files.size !== pkg.files.length ||
    new Set(pkg.steps.map((s) => s.id)).size !== pkg.steps.length
  )
    throw new Error('DUPLICATE_ID');
  const targets = new Set<string>();
  const completed = new Set<string>();
  for (const step of pkg.steps) {
    if ((step.depends_on || []).some((id) => !completed.has(id)))
      throw new Error('STEP_DEPENDENCY_ORDER');
    completed.add(step.id);
    if (step.source_subdir && step.action !== 'extract') throw new Error('INVALID_SOURCE_SUBDIR');
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
