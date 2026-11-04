import { adminServices } from './admin-services.ts';
import {
  hasPermission,
  accessPermissions,
  defaultService,
  type Permission,
} from '../../packages/contracts/src/index.ts';
import { z } from 'zod';
import {
  PackageSpec,
  GenerateLicenses,
  Activation,
  Proof,
  PublicJwk,
  Id,
  resolvePlan,
  validatePublication,
  type License,
  type Admin,
  type Role,
} from '../../packages/contracts/src/index.ts';
import {
  b64,
  codeHash,
  generateLicenseCode,
  thumbprint,
  verifyProof,
  grant,
  signPayload,
  verifyToken,
  type SigningConfig,
} from './crypto.ts';
import type { Repository } from './repository.ts';
export type ApiConfig = SigningConfig & {
  mode: 'demo' | 'production';
  allowedOrigins: string[];
  demoSession?: { token: string; license: string };
};
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function createApi(repo: Repository, config: ApiConfig) {
  return async (request: Request, trustedIp = 'unknown'): Promise<Response> => {
    const requestId = crypto.randomUUID(),
      origin = request.headers.get('origin');
    const headers = new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Request-Id': requestId,
      Vary: 'Origin',
    });
    if (origin && config.allowedOrigins.includes(origin))
      headers.set('Access-Control-Allow-Origin', origin);
    const reply = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status, headers });
    const audit = (actor: string, action: string, target: string, detail = '') =>
      repo.insert('audit_events', [
        {
          id: crypto.randomUUID(),
          actor,
          action,
          target,
          detail,
          created_at: new Date().toISOString(),
        },
      ]);
    try {
      if (origin && !config.allowedOrigins.includes(origin))
        throw new HttpError(403, 'ORIGIN_DENIED');
      if (request.method === 'OPTIONS') {
        headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        return new Response(null, { status: 204, headers });
      }
      const path = new URL(request.url).pathname.replace(/^\/api/, '');
      if (request.method === 'GET' && path === '/health')
        return reply({
          mode: config.mode,
          capabilities: ['content-packages-v2', 'admin-custom-roles-v1', 'license-window-v1'],
          version: '0.1.0',
          public_key: config.publicJwk,
          issuer: config.issuer,
          kid: config.kid,
        });
      // Only adapter-supplied IPs are trusted; never arbitrary forwarded headers.
      const ipKey = await codeHash(trustedIp, config.pepper);
      if (!path.startsWith('/admin/') && !(await repo.rateLimit(`ip:${ipKey}`, 120, 60))) {
        headers.set('Retry-After', '60');
        throw new HttpError(429, 'RATE_LIMITED');
      }
      if (request.method === 'GET' && path === '/catalog') {
        const packages = (await repo.published()).map(({ files, steps, ...p }) => ({
          ...p,
          size: files.reduce((sum, f) => sum + f.size, 0),
          file_count: files.length,
        }));
        return reply({ packages });
      }
      if (path === '/demo/session' && request.method === 'POST' && config.mode === 'demo')
        return reply(config.demoSession);
      let body: unknown = {};
      if (request.method === 'POST') {
        const reader = request.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (reader)
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 131072) {
              await reader.cancel();
              throw new HttpError(413, 'BODY_TOO_LARGE');
            }
            chunks.push(value);
          }
        const bytes = new Uint8Array(size);
        let at = 0;
        for (const c of chunks) {
          bytes.set(c, at);
          at += c.length;
        }
        try {
          body = JSON.parse(new TextDecoder().decode(bytes) || '{}');
        } catch {
          throw new HttpError(400, 'INVALID_JSON');
        }
      }
      let adminRateChecked = false;
      async function requireAdmin(
        section: Permission | 'read' | 'license' | 'content',
      ): Promise<Admin> {
        const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
        let admin: Admin | null = null;
        try {
          const claims = await verifyToken(token, config, 'uhm-admin+jwt');
          const access = (await repo.list('admin_access')).find(
            (a) => a.id === claims.license_id && a.enabled && a.version === claims.access_version,
          );
          const license = (await repo.list('licenses')).find(
            (l) =>
              l.id === claims.license_id &&
              !l.archived &&
              (!l.starts_at || Date.parse(l.starts_at) <= Date.now()) &&
              l.status === 'active' &&
              l.device_thumbprint === claims.device_thumbprint &&
              l.entitlement_version === claims.entitlement_version &&
              Date.parse(l.expires_at!) > Date.now(),
          );
          if (access && license)
            admin = {
              id: `license:${license.id}`,
              license_id: license.id,
              role: access.role,
              permissions: accessPermissions(access, await repo.list('custom_roles')),
              aal: 'device-proof',
              auth_method: 'license',
            };
        } catch {
          /* Tokens for Supabase Auth have a separate issuer and trust path. */
        }
        if (!admin) admin = await repo.admin(token);
        if (!admin) throw new HttpError(401, 'ADMIN_REQUIRED');
        if (!adminRateChecked) {
          if (!(await repo.rateLimit(`admin:${admin.id}`, 180, 60))) {
            headers.set('Retry-After', '60');
            throw new HttpError(429, 'RATE_LIMITED');
          }
          adminRateChecked = true;
        }
        const permission =
          section === 'license'
            ? 'licenses.create'
            : section === 'content'
              ? 'content.write'
              : section;
        if (permission !== 'read' && !hasPermission(admin, permission))
          throw new HttpError(403, 'ROLE_DENIED');
        if (admin.auth_method !== 'license' && admin.aal !== 'aal2')
          throw new HttpError(403, 'MFA_REQUIRED');
        return admin;
      }
      async function proof(purpose: string, data: z.infer<typeof Proof>): Promise<string> {
        const thumb = await thumbprint(data.public_key);
        const challenge = (await repo.list('challenges')).find((c) => c.id === data.challenge_id);
        if (
          !challenge ||
          challenge.purpose !== purpose ||
          challenge.thumbprint !== thumb ||
          challenge.consumed ||
          Date.parse(challenge.expires_at) <= Date.now()
        )
          throw new HttpError(401, 'CHALLENGE_INVALID');
        if (!(await verifyProof(data.public_key, data.signature, challenge.nonce)))
          throw new HttpError(401, 'PROOF_INVALID');
        if (!(await repo.consumeChallenge(challenge.id, thumb, new Date().toISOString())))
          throw new HttpError(401, 'CHALLENGE_USED');
        return thumb;
      }
      async function device(
        purpose: string,
        data: z.infer<typeof Proof>,
        suppliedGrant?: string,
      ): Promise<License> {
        const token =
          suppliedGrant || request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
        let payload;
        try {
          payload = await verifyToken(token, config, 'uhm-offline+jwt');
        } catch {
          throw new HttpError(401, 'GRANT_INVALID');
        }
        const thumb = await proof(purpose, data);
        const license = (await repo.list('licenses')).find((l) => l.id === payload.license_id);
        if (
          !license ||
          license.status !== 'active' ||
          license.archived ||
          (license.starts_at && Date.parse(license.starts_at) > Date.now()) ||
          license.device_thumbprint !== thumb ||
          payload.device_thumbprint !== thumb ||
          license.entitlement_version !== payload.entitlement_version ||
          Date.parse(license.expires_at!) <= Date.now()
        )
          throw new HttpError(403, 'LICENSE_INVALID');
        return license;
      }
      const extended = await adminServices({
        url: request.url,
        path,
        method: request.method,
        body,
        repo,
        config,
        proof,
        requireAdmin,
        reply,
        audit,
      });
      if (extended) return extended;
      const service = (await repo.list('service_settings'))[0] ?? defaultService();
      if (
        request.method === 'POST' &&
        ((path === '/licenses/activate' && (service.maintenance || service.activation_paused)) ||
          (path === '/install/plan' && (service.maintenance || service.downloads_paused)) ||
          (path === '/admin/licenses' && service.issuance_paused))
      )
        return reply({ error: 'SERVICE_PAUSED', message: service.message }, 503);
      if (path === '/demo/license' && request.method === 'POST' && config.mode === 'demo') {
        const code = generateLicenseCode();
        await repo.insert('licenses', [
          {
            id: crypto.randomUUID(),
            code_hash: await codeHash(code, config.pepper),
            prefix: code.slice(0, 9),
            tier: 'pro',
            status: 'unused',
            duration_days: 30,
            created_at: new Date().toISOString(),
            activated_at: null,
            expires_at: null,
            device_thumbprint: null,
            entitlement_version: 1,
            activation_count: 0,
          },
        ]);
        return reply({ license: code });
      }
      if (path === '/device/challenge' && request.method === 'POST') {
        const input = z
          .object({
            public_key: PublicJwk,
            purpose: z.enum(['activate', 'refresh', 'plan', 'report', 'admin', 'telemetry']),
          })
          .strict()
          .parse(body);
        const thumb = await thumbprint(input.public_key);
        if (!(await repo.rateLimit(`device:${thumb}`, 20, 60)))
          throw new HttpError(429, 'RATE_LIMITED');
        const challenge = {
          id: crypto.randomUUID(),
          nonce: b64(crypto.getRandomValues(new Uint8Array(32))),
          thumbprint: thumb,
          purpose: input.purpose,
          expires_at: new Date(Date.now() + 120000).toISOString(),
          consumed: false,
        };
        await repo.insert('challenges', [challenge]);
        return reply({
          id: challenge.id,
          nonce: challenge.nonce,
          expires_at: challenge.expires_at,
        });
      }
      if (path === '/licenses/activate' && request.method === 'POST') {
        const input = Activation.parse(body);
        const thumb = await proof('activate', input);
        const hash = await codeHash(input.code, config.pepper);
        let license;
        try {
          license = await repo.activate(hash, thumb, new Date().toISOString());
        } catch {
          await audit('device', 'activation.rejected', thumb.slice(0, 12));
          throw new HttpError(403, 'ACTIVATION_DENIED');
        }
        return reply({ grant: await grant(license, config), license: clientLicense(license) });
      }
      if (path === '/licenses/refresh' && request.method === 'POST') {
        // Renewal uses device proof plus the explicit license ID; an expired grant is not authorization.
        const input = Proof.extend({ license_id: Id }).strict().parse(body),
          thumb = await proof('refresh', input);
        const license = (await repo.list('licenses')).find(
          (l) =>
            l.id === input.license_id &&
            l.device_thumbprint === thumb &&
            l.status === 'active' &&
            !l.archived &&
            Date.parse(l.expires_at!) > Date.now(),
        );
        if (!license) throw new HttpError(403, 'LICENSE_INVALID');
        return reply({ grant: await grant(license, config), license: clientLicense(license) });
      }
      if (path === '/install/plan' && request.method === 'POST') {
        const input = Proof.extend({ package_id: Id }).strict().parse(body);
        const license = await device('plan', input);
        const published = await repo.published();
        const packages = resolvePlan(input.package_id, published, license.tier);
        if (packages.some((p) => !p.files.length))
          throw new HttpError(409, 'DEMO_FILES_NOT_CONFIGURED');
        for (const p of packages) validatePublication(p, published);
        const token = await signPayload(
          {
            schema_version: 1,
            license_id: license.id,
            device_thumbprint: license.device_thumbprint,
            packages,
          },
          config,
          'uhm-plan+jwt',
          900,
        );
        return reply({
          plan: token,
          packages: packages.map((p) => ({ id: p.id, name: p.name, version: p.version })),
        });
      }
      if (path === '/install/report' && request.method === 'POST') {
        const input = Proof.extend({
          package_id: Id,
          version: z.string().max(30),
          status: z.enum(['installed', 'failed']),
        })
          .strict()
          .parse(body);
        const license = await device('report', input);
        await repo.insert('install_reports', [
          {
            id: crypto.randomUUID(),
            license_id: license.id,
            package_id: input.package_id,
            version: input.version,
            status: input.status,
            created_at: new Date().toISOString(),
          },
        ]);
        return reply({ accepted: true });
      }
      if (path === '/admin/releases' && request.method === 'GET') {
        await requireAdmin('content.read');
        const actor = await requireAdmin('content.read');
        return reply({
          releases: (await repo.releases()).map((r) =>
            hasPermission(actor, 'content.update')
              ? r
              : { ...r, manifest: { ...r.manifest, files: [], steps: [] } },
          ),
        });
      }
      if (path === '/admin/overview' && request.method === 'GET') {
        const admin = await requireAdmin('read');
        const can = (permission: Permission) => hasPermission(admin, permission);
        const events =
          can('analytics.read') || can('errors.read') ? await repo.list('telemetry_events') : [];
        return reply({
          admin,
          capabilities: ['admin-custom-roles-v1', 'license-window-v1'],
          licenses: can('licenses.read') ? (await repo.list('licenses')).map(publicLicense) : [],
          packages: can('content.read')
            ? (await repo.list('packages')).map((p) =>
                can('content.update') ? p : { ...p, files: [], steps: [] },
              )
            : [],
          events: can('audit.read')
            ? (await repo.list('audit_events'))
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .slice(0, 500)
            : [],
          reports: can('analytics.read') ? await repo.list('install_reports') : [],
          telemetry: events
            .filter(
              (e) => can('analytics.read') || e.type.endsWith('failed') || e.type === 'app_error',
            )
            .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
            .slice(0, 10000),
          service: can('service.manage') ? service : null,
        });
      }
      if (path === '/admin/licenses' && request.method === 'POST') {
        const admin = await requireAdmin('license'),
          input = GenerateLicenses.parse(body),
          now = new Date().toISOString();
        const codes = Array.from({ length: input.count }, () => generateLicenseCode());
        const rows: License[] = await Promise.all(
          codes.map(async (code) => ({
            id: crypto.randomUUID(),
            code_hash: await codeHash(code, config.pepper),
            prefix: code.slice(0, 9),
            tier: input.tier,
            status: 'unused',
            duration_days: input.duration_days,
            created_at: now,
            starts_at: input.starts_at ?? null,
            activated_at: null,
            expires_at: input.expires_at ?? null,
            device_thumbprint: null,
            entitlement_version: 1,
            activation_count: 0,
          })),
        );
        await repo.insert('licenses', rows);
        await audit(admin.id, 'licenses.generated', String(input.count), input.tier);
        return reply({ codes, licenses: rows.map(publicLicense) }, 201);
      }
      const licenseAction = path.match(
        /^\/admin\/licenses\/([a-f0-9-]+)\/(suspend|revoke|resume|reset|extend)$/,
      );
      if (licenseAction && request.method === 'POST') {
        const admin = await requireAdmin(
          licenseAction[2] === 'resume'
            ? 'licenses.suspend'
            : (`licenses.${licenseAction[2]}` as Permission),
        );
        const id = Id.parse(licenseAction[1]);
        const input = z
          .object({ days: z.number().int().min(1).max(365).optional() })
          .strict()
          .parse(body);
        const targetAccess = (await repo.list('admin_access')).find(
          (a) => a.id === id && a.enabled,
        );
        if (targetAccess && admin.role !== 'owner') throw new HttpError(403, 'ROLE_DENIED');
        if (admin.license_id === id) throw new HttpError(403, 'SELF_ACCESS_CHANGE');
        await repo.mutateLicense(id, licenseAction[2], admin.id, input.days);
        return reply({ ok: true });
      }
      if (path === '/admin/packages' && request.method === 'POST') {
        // Authenticate before parsing, then authorize the actual create/update action.
        const admin = await requireAdmin('read');
        const pkg = PackageSpec.parse(body);
        if (pkg.status !== 'draft') throw new HttpError(400, 'SAVE_AS_DRAFT');
        const all = await repo.list('packages');
        const existing = all.find((p) => p.id === pkg.id);
        await requireAdmin(existing ? 'content.update' : 'content.create');
        if (existing?.status === 'published' && existing.version === pkg.version)
          throw new HttpError(409, 'RELEASE_IMMUTABLE');
        if (all.some((p) => p.slug === pkg.slug && p.id !== pkg.id))
          throw new HttpError(409, 'SLUG_EXISTS');
        if (existing) await repo.update('packages', pkg.id, pkg);
        else await repo.insert('packages', [pkg]);
        await audit(admin.id, 'package.draft.saved', pkg.id);
        return reply({ package: pkg });
      }
      const testing = path.match(/^\/admin\/packages\/([a-f0-9-]+)\/test-plan$/);
      if (testing && request.method === 'POST') {
        const admin = await requireAdmin('content.publish');
        const input = Proof.extend({ grant: z.string().max(16000) })
          .strict()
          .parse(body);
        const license = await device('plan', input, input.grant);
        if (admin.license_id && admin.license_id !== license.id)
          throw new HttpError(403, 'ROLE_DENIED');
        const draft = (await repo.list('packages')).find(
          (p) => p.id === testing[1] && p.status !== 'archived',
        );
        if (!draft) throw new HttpError(404, 'NOT_FOUND');
        const candidate = { ...draft, status: 'published' as const, channel: 'test' as const };
        const all = [...(await repo.published()).filter((p) => p.id !== draft.id), candidate];
        validatePublication(candidate, all);
        const packages = resolvePlan(candidate.id, all, license.tier);
        const plan = await signPayload(
          {
            schema_version: 1,
            license_id: license.id,
            device_thumbprint: license.device_thumbprint,
            packages,
            test: true,
          },
          config,
          'uhm-plan+jwt',
          900,
        );
        await audit(admin.id, 'package.test_plan', draft.id);
        return reply({
          plan,
          packages: packages.map((p) => ({ id: p.id, name: p.name, version: p.version })),
        });
      }
      const validation = path.match(/^\/admin\/packages\/([a-f0-9-]+)\/validate$/);
      if (validation && request.method === 'POST') {
        const admin = await requireAdmin('content.publish');
        const pkg = (await repo.list('packages')).find((p) => p.id === validation[1]);
        if (!pkg) throw new HttpError(404, 'NOT_FOUND');
        validatePublication(pkg, await repo.published());
        await audit(admin.id, 'package.validated', pkg.id);
        return reply({
          ok: true,
          files: pkg.files.length,
          steps: pkg.steps.length,
          bytes: pkg.files.reduce((n, f) => n + f.size, 0),
        });
      }
      const publish = path.match(/^\/admin\/packages\/([a-f0-9-]+)\/(publish|archive)$/);
      if (publish && request.method === 'POST') {
        const admin = await requireAdmin('content.publish'),
          all = await repo.list('packages');
        const pkg = all.find((p) => p.id === Id.parse(publish[1]));
        if (!pkg) throw new HttpError(404, 'NOT_FOUND');
        if (publish[2] === 'publish') {
          if (pkg.status !== 'draft') throw new HttpError(409, 'DRAFT_REQUIRED');
          validatePublication(pkg, await repo.published());
        }
        await repo.update('packages', pkg.id, {
          status: publish[2] === 'publish' ? 'published' : 'archived',
          released_at: new Date().toISOString(),
        });
        await audit(admin.id, `package.${publish[2]}`, pkg.id);
        return reply({ ok: true });
      }
      throw new HttpError(404, 'NOT_FOUND');
    } catch (error) {
      if (error instanceof HttpError)
        return reply({ error: error.message, request_id: requestId }, error.status);
      if (error instanceof z.ZodError)
        return reply(
          {
            error: 'VALIDATION_ERROR',
            issues: error.issues.map((i) => ({ path: i.path, message: i.message })),
            request_id: requestId,
          },
          400,
        );
      const known = [
        'DEPENDENCY_CYCLE',
        'DEPENDENCY_UNAVAILABLE',
        'TIER_REQUIRED',
        'EMPTY_INSTALL_PLAN',
        'UNKNOWN_FILE',
        'FORMAT_MISMATCH',
        'DUPLICATE_ID',
        'DESTINATION_CONFLICT',
        'NOT_FOUND',
        'DUPLICATE_FILENAME',
        'STEP_DEPENDENCY_ORDER',
        'INVALID_SOURCE_SUBDIR',
        'INVALID_ACTION',
        'LAST_OWNER',
        'RELEASE_IMMUTABLE',
        'INSTALL_PLAN_LIMIT',
        'ARTIFACT_SIZE_LIMIT',
        'EDIT_CONFLICT',
        'ROLE_NAME_EXISTS',
      ];
      if (error instanceof Error && known.includes(error.message))
        return reply({ error: error.message, request_id: requestId }, 409);
      // Never log credentials, request bodies, codes or signed URLs.
      console.error(JSON.stringify({ request_id: requestId, event: 'api.failure' }));
      return reply({ error: 'INTERNAL_ERROR', request_id: requestId }, 500);
    }
  };
}
export function publicLicense({ code_hash, ...license }: License) {
  return license;
}

function clientLicense(l: License) {
  return {
    id: l.id,
    tier: l.tier,
    expires_at: l.expires_at,
    device_thumbprint: l.device_thumbprint,
    status: l.status,
  };
}
