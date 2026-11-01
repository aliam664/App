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
const allowed = (role: Role, section: 'license' | 'content' | 'read') =>
  role === 'owner' ||
  section === 'read' ||
  (section === 'license' && role === 'license_manager') ||
  (section === 'content' && role === 'content_manager');
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
          version: '0.1.0',
          public_key: config.publicJwk,
          issuer: config.issuer,
          kid: config.kid,
        });
      // Only adapter-supplied IPs are trusted; never arbitrary forwarded headers.
      const ipKey = await codeHash(trustedIp, config.pepper);
      if (!(await repo.rateLimit(`ip:${ipKey}`, 120, 60))) {
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
      async function requireAdmin(section: 'license' | 'content' | 'read'): Promise<Admin> {
        const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
        const admin = await repo.admin(token);
        if (!admin) throw new HttpError(401, 'ADMIN_REQUIRED');
        if (!allowed(admin.role, section)) throw new HttpError(403, 'ROLE_DENIED');
        if (section !== 'read' && admin.aal !== 'aal2') throw new HttpError(403, 'MFA_REQUIRED');
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
      async function device(purpose: string, data: z.infer<typeof Proof>): Promise<License> {
        const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
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
          license.device_thumbprint !== thumb ||
          payload.device_thumbprint !== thumb ||
          license.entitlement_version !== payload.entitlement_version ||
          Date.parse(license.expires_at!) <= Date.now()
        )
          throw new HttpError(403, 'LICENSE_INVALID');
        return license;
      }
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
            purpose: z.enum(['activate', 'refresh', 'plan', 'report']),
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
        return reply({ grant: await grant(license, config), license: publicLicense(license) });
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
            Date.parse(l.expires_at!) > Date.now(),
        );
        if (!license) throw new HttpError(403, 'LICENSE_INVALID');
        return reply({ grant: await grant(license, config), license: publicLicense(license) });
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
        await requireAdmin('read');
        return reply({ releases: await repo.releases() });
      }
      if (path === '/admin/overview' && request.method === 'GET') {
        const admin = await requireAdmin('read');
        const licenses = await repo.list('licenses');
        const packages = await repo.list('packages');
        return reply({
          admin,
          licenses: licenses.map(publicLicense),
          packages,
          events: (await repo.list('audit_events'))
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .slice(0, 100),
          reports: await repo.list('install_reports'),
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
            activated_at: null,
            expires_at: null,
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
        const admin = await requireAdmin('license');
        const id = Id.parse(licenseAction[1]);
        const input = z
          .object({ days: z.number().int().min(1).max(365).optional() })
          .strict()
          .parse(body);
        await repo.mutateLicense(id, licenseAction[2], admin.id, input.days);
        return reply({ ok: true });
      }
      if (path === '/admin/packages' && request.method === 'POST') {
        const admin = await requireAdmin('content');
        const pkg = PackageSpec.parse(body);
        if (pkg.status !== 'draft') throw new HttpError(400, 'SAVE_AS_DRAFT');
        const all = await repo.list('packages');
        const existing = all.find((p) => p.id === pkg.id);
        if (existing?.status === 'published' && existing.version === pkg.version)
          throw new HttpError(409, 'RELEASE_IMMUTABLE');
        if (all.some((p) => p.slug === pkg.slug && p.id !== pkg.id))
          throw new HttpError(409, 'SLUG_EXISTS');
        if (existing) await repo.update('packages', pkg.id, pkg);
        else await repo.insert('packages', [pkg]);
        await audit(admin.id, 'package.draft.saved', pkg.id);
        return reply({ package: pkg });
      }
      const publish = path.match(/^\/admin\/packages\/([a-f0-9-]+)\/(publish|archive)$/);
      if (publish && request.method === 'POST') {
        const admin = await requireAdmin('content'),
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
        'INVALID_ACTION',
        'RELEASE_IMMUTABLE',
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
