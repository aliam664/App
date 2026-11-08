import { z } from 'zod';
import {
  Id,
  Proof,
  AccessInput,
  Permission,
  CustomRoleInput,
  LicenseWindowInput,
  ProfileInput,
  licenseState,
  accessPermissions,
  EventInput,
  ServiceInput,
  defaultService,
  hasPermission,
  rolePermissions,
  type Admin,
} from '../../packages/contracts/src/index.ts';
import type { Repository } from './repository.ts';
import { signPayload, type SigningConfig } from './crypto.ts';
export async function adminServices(c: {
  url: string;
  path: string;
  method: string;
  body: unknown;
  repo: Repository;
  config: SigningConfig;
  proof: (purpose: string, data: z.infer<typeof Proof>) => Promise<string>;
  requireAdmin: (permission: Permission | 'read') => Promise<Admin>;
  reply: (value: unknown, status?: number) => Response;
  audit: (actor: string, action: string, target: string, detail?: string) => Promise<void>;
}) {
  const { path, method, body, repo, reply, requireAdmin, audit } = c;
  const fail = (error: string, status = 403) => reply({ error }, status);
  if (path === '/service/status' && method === 'GET')
    return reply({
      settings: (await repo.list('service_settings'))[0] ?? defaultService(),
      bot_configured: false,
    });
  if (path === '/admin/license-session' && method === 'POST') {
    const input = Proof.extend({ license_id: Id }).strict().parse(body);
    const thumb = await c.proof('admin', input);
    const license = (await repo.list('licenses')).find((l) => l.id === input.license_id);
    const access = (await repo.list('admin_access')).find(
      (a) => a.id === input.license_id && a.enabled,
    );
    if (
      !license ||
      !access ||
      license.status !== 'active' ||
      license.archived ||
      (license.starts_at && Date.parse(license.starts_at) > Date.now()) ||
      license.device_thumbprint !== thumb ||
      Date.parse(license.expires_at!) <= Date.now()
    )
      return fail('ADMIN_LICENSE_DENIED');
    const token = await signPayload(
      {
        license_id: license.id,
        device_thumbprint: thumb,
        access_version: access.version,
        entitlement_version: license.entitlement_version,
      },
      c.config,
      'uhm-admin+jwt',
      900,
    );
    await audit(`license:${license.id}`, 'admin.login', license.id);
    return reply({
      token,
      role: access.role,
      permissions: accessPermissions(access, await repo.list('custom_roles')),
      expires_in: 900,
    });
  }
  if (path === '/telemetry/batch' && method === 'POST') {
    const input = Proof.extend({ license_id: Id, events: z.array(EventInput).min(1).max(100) })
      .strict()
      .parse(body);
    const thumb = await c.proof('telemetry', input);
    const license = (await repo.list('licenses')).find(
      (l) => l.id === input.license_id && l.device_thumbprint === thumb,
    );
    // Reporting is allowed after expiry/revocation, but NEVER after the device binding changes.
    if (!license) return fail('LICENSE_INVALID');
    const now = Date.now();
    if (input.events.some((e) => Date.parse(e.occurred_at) > now + 86400000))
      return fail('INVALID_EVENT_TIME', 400);
    await repo.ingestEvents(
      input.events.map((e) => ({
        ...e,
        license_id: license.id,
        received_at: new Date().toISOString(),
        resolved_at: null,
        resolved_by: null,
      })),
    );
    return reply({ accepted: input.events.map((e) => e.id) });
  }
  if (path === '/admin/users' && method === 'GET') {
    await requireAdmin('users.read');
    return reply({
      users: (await repo.list('licenses')).map((l) => ({
        id: l.id,
        display_name: l.display_name || '',
        notes: l.notes || '',
        tags: l.tags || [],
        tier: l.tier,
        status: licenseState(l),
        created_at: l.created_at,
        expires_at: l.expires_at,
        archived: !!l.archived,
      })),
    });
  }
  const userProfile = path.match(/^\/admin\/users\/([a-f0-9-]+)$/);
  if (userProfile && method === 'POST') {
    const actor = await requireAdmin('users.manage');
    const id = Id.parse(userProfile[1]);
    const input = ProfileInput.parse(body);
    await repo.saveProfile(id, input, actor.id);
    return reply({ ok: true });
  }
  if (path === '/admin/devices' && method === 'GET') {
    await requireAdmin('devices.read');
    return reply({
      devices: (await repo.list('licenses'))
        .filter((l) => l.device_thumbprint)
        .map((l) => ({
          id: l.id,
          tier: l.tier,
          status: licenseState(l),
          device_thumbprint: l.device_thumbprint,
          activated_at: l.activated_at,
          activation_count: l.activation_count,
        })),
    });
  }
  if (path === '/admin/analytics' && method === 'GET') {
    await requireAdmin('analytics.read');
    const days = z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .parse(new URL(c.url).searchParams.get('days') || 30);
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - days + 1);
    return reply(await repo.analytics(since.toISOString()));
  }
  const activity = path.match(/^\/admin\/licenses\/([a-f0-9-]+)\/activity$/);
  if (activity && method === 'GET') {
    await requireAdmin('licenses.read');
    const raw = new URL(c.url).searchParams.get('cursor');
    const cursor = raw
      ? z.object({ at: z.string().datetime({ offset: true }), id: Id }).parse(JSON.parse(raw))
      : undefined;
    const events = await repo.eventsPage(Id.parse(activity[1]), cursor);
    const last = events.at(-1);
    return reply({
      stats: await repo.licenseStats(Id.parse(activity[1])),
      events,
      next:
        events.length === 100 && last
          ? JSON.stringify({ at: last.occurred_at, id: last.id })
          : null,
    });
  }
  if (path === '/admin/errors' && method === 'GET') {
    await requireAdmin('errors.read');
    const url = new URL(c.url);
    const status = z
      .enum(['open', 'all', 'resolved'])
      .parse(url.searchParams.get('status') || 'open');
    const raw = url.searchParams.get('cursor');
    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : undefined;
    } catch {
      return fail('INVALID_CURSOR', 400);
    }
    const cursor = raw
      ? z.object({ at: z.string().datetime({ offset: true }), id: Id }).parse(parsed)
      : undefined;
    const events = await repo.errorsPage(status, cursor);
    const last = events.at(-1);
    return reply({
      events,
      next:
        events.length === 100 && last
          ? JSON.stringify({ at: last.occurred_at, id: last.id })
          : null,
    });
  }
  const history = path.match(/^\/admin\/licenses\/([a-f0-9-]+)\/audit$/);
  if (history && method === 'GET') {
    await requireAdmin('audit.read');
    const raw = new URL(c.url).searchParams.get('cursor');
    const cursor = raw
      ? z.object({ at: z.string().datetime({ offset: true }), id: Id }).parse(JSON.parse(raw))
      : undefined;
    const events = await repo.auditPage(Id.parse(history[1]), cursor);
    const last = events.at(-1);
    return reply({
      events,
      next:
        events.length === 100 && last ? JSON.stringify({ at: last.created_at, id: last.id }) : null,
    });
  }
  if (path === '/admin/team' && method === 'GET') {
    const actor = await requireAdmin('read');
    const membersAllowed = hasPermission(actor, 'team.manage');
    if (!membersAllowed && !hasPermission(actor, 'roles.manage')) return fail('ROLE_DENIED');
    return reply({
      members: membersAllowed ? await repo.list('admin_access') : [],
      roles: await repo.list('custom_roles'),
      available_permissions: Permission.options,
      license_options: (membersAllowed ? await repo.list('licenses') : []).map((l) => ({
        id: l.id,
        prefix: l.prefix,
        display_name: l.display_name,
        status: l.status,
        archived: l.archived,
      })),
    });
  }
  if (path === '/admin/roles' && method === 'GET') {
    await requireAdmin('roles.manage');
    return reply({ roles: await repo.list('custom_roles') });
  }
  const roleRoute = path.match(/^\/admin\/roles\/([a-f0-9-]+)$/);
  if (roleRoute && method === 'POST') {
    const actor = await requireAdmin('roles.manage');
    const id = Id.parse(roleRoute[1]);
    const { expected_version, ...input } = CustomRoleInput.parse(body);
    const old = (await repo.list('custom_roles')).find((r) => r.id === id);
    if (
      actor.role !== 'owner' &&
      [...input.permissions, ...(old?.permissions || [])].some((p) => !hasPermission(actor, p))
    )
      return fail('ROLE_DENIED');
    // Non-owners cannot edit a reusable role already attached to an owner.
    if (
      actor.role !== 'owner' &&
      (await repo.list('admin_access')).some((a) => a.role === 'owner' && a.role_ids?.includes(id))
    )
      return fail('ROLE_DENIED');
    await repo.saveRole(
      { ...input, id, version: 1, updated_at: new Date().toISOString() },
      actor.id,
      expected_version,
    );
    return reply({ ok: true });
  }
  const accessRoute = path.match(/^\/admin\/team\/([a-f0-9-]+)$/);
  if (accessRoute && method === 'POST') {
    const actor = await requireAdmin('team.manage');
    const id = Id.parse(accessRoute[1]);
    const { expected_version, ...parsed } = AccessInput.parse(body);
    const old = (await repo.list('admin_access')).find((a) => a.id === id);
    // 0.1.1 has no role_ids field: preserve reusable assignments when it edits a member.
    const input = { ...parsed, role_ids: parsed.role_ids ?? old?.role_ids ?? [] };
    if (new Set(input.role_ids).size !== input.role_ids.length) return fail('DUPLICATE_ROLE', 400);
    const roles = await repo.list('custom_roles');
    if (
      input.role_ids.some(
        (id) => !roles.some((r) => r.id === id && (r.enabled || old?.role_ids?.includes(id))),
      )
    )
      return fail('ROLE_UNAVAILABLE', 400);
    if (actor.license_id === id) return fail('SELF_ACCESS_CHANGE');
    if (
      actor.role !== 'owner' &&
      (old?.role === 'owner' ||
        input.role === 'owner' ||
        accessPermissions(input, roles).some((p) => !hasPermission(actor, p)) ||
        (old && accessPermissions(old, roles).some((p) => !hasPermission(actor, p))))
    )
      return fail('ROLE_DENIED');
    if (
      !(await repo.list('licenses')).some(
        (l) => l.id === id && l.status !== 'revoked' && !l.archived,
      )
    )
      return fail('LICENSE_INVALID');
    await repo.saveAccess(
      { ...input, id, version: 1, updated_at: new Date().toISOString() },
      actor.id,
      expected_version,
    );
    return reply({ ok: true });
  }
  if (path === '/admin/service' && method === 'POST') {
    const actor = await requireAdmin('service.manage');
    const input = ServiceInput.parse(body);
    const old = (await repo.list('service_settings'))[0];
    const next = { ...defaultService(), ...input, updated_at: new Date().toISOString() };
    if (old) await repo.update('service_settings', old.id, next);
    else await repo.insert('service_settings', [next]);
    await audit(
      actor.id,
      'service.settings.changed',
      next.id,
      JSON.stringify({ before: old, after: next }),
    );
    return reply({ settings: next, bot_configured: false });
  }
  const licenseWindow = path.match(/^\/admin\/licenses\/([a-f0-9-]+)\/window$/);
  if (licenseWindow && method === 'POST') {
    const actor = await requireAdmin('licenses.update');
    const id = Id.parse(licenseWindow[1]);
    const input = LicenseWindowInput.parse(body);
    const old = (await repo.list('licenses')).find((l) => l.id === id);
    if (!old) return fail('NOT_FOUND', 404);
    if (actor.license_id === id) return fail('SELF_ACCESS_CHANGE');
    if (
      actor.role !== 'owner' &&
      (await repo.list('admin_access')).some((a) => a.id === id && a.enabled)
    )
      return fail('ROLE_DENIED');
    // Editing dates must not become a way to bypass the independent extension grant.
    if (
      input.expires_at &&
      (!old.expires_at || Date.parse(input.expires_at) > Date.parse(old.expires_at))
    )
      await requireAdmin('licenses.extend');
    await repo.setLicenseWindow(id, input, actor.id);
    return reply({ ok: true });
  }
  const metadata = path.match(/^\/admin\/licenses\/([a-f0-9-]+)\/metadata$/);
  if (metadata && method === 'POST') {
    const actor = await requireAdmin('licenses.update');
    const id = Id.parse(metadata[1]);
    const input = z
      .object({
        display_name: z.string().max(120),
        notes: z.string().max(4000),
        tags: z.array(z.string().min(1).max(40)).max(15),
      })
      .strict()
      .parse(body);
    const old = (await repo.list('licenses')).find((l) => l.id === id);
    if (!old) return fail('NOT_FOUND', 404);
    await repo.saveProfile(id, input, actor.id);
    return reply({ ok: true });
  }
  const archive = path.match(/^\/admin\/licenses\/([a-f0-9-]+)\/archive$/);
  if (archive && method === 'POST') {
    const actor = await requireAdmin('licenses.archive');
    const id = Id.parse(archive[1]);
    if (actor.license_id === id) return fail('SELF_ACCESS_CHANGE');
    const input = z.object({ archived: z.boolean() }).strict().parse(body);
    const license = (await repo.list('licenses')).find((l) => l.id === id);
    if (!license) return fail('NOT_FOUND', 404);
    if (
      (await repo.list('admin_access')).some((a) => a.id === id && a.enabled) &&
      actor.role !== 'owner'
    )
      return fail('ROLE_DENIED');
    if (input.archived && license.status !== 'revoked')
      await repo.mutateLicense(id, 'suspend', actor.id);
    await repo.update('licenses', id, { archived: input.archived });
    await audit(actor.id, 'license.archive.changed', id, String(input.archived));
    return reply({ ok: true });
  }
  const tier = path.match(/^\/admin\/licenses\/([a-f0-9-]+)\/tier$/);
  if (tier && method === 'POST') {
    const actor = await requireAdmin('licenses.update');
    const id = Id.parse(tier[1]);
    if (
      (await repo.list('admin_access')).some((a) => a.id === id && a.enabled) &&
      actor.role !== 'owner'
    )
      return fail('ROLE_DENIED');
    const input = z
      .object({ tier: z.enum(['normal', 'pro', 'vip']) })
      .strict()
      .parse(body);
    const old = (await repo.list('licenses')).find((l) => l.id === id);
    if (!old) return fail('NOT_FOUND', 404);
    await repo.update('licenses', id, {
      tier: input.tier,
      entitlement_version: old.entitlement_version + 1,
    });
    await audit(actor.id, 'license.tier.changed', id, `${old.tier} -> ${input.tier}`);
    return reply({ ok: true });
  }
  const resolve = path.match(/^\/admin\/errors\/([a-f0-9-]+)\/resolve$/);
  if (resolve && method === 'POST') {
    const actor = await requireAdmin('errors.resolve');
    const id = Id.parse(resolve[1]);
    const input = z.object({ license_id: Id }).strict().parse(body);
    const event = (await repo.list('telemetry_events')).find(
      (e) =>
        e.id === id &&
        e.license_id === input.license_id &&
        (e.type.endsWith('failed') || e.type === 'app_error'),
    );
    if (!event) return fail('NOT_FOUND', 404);
    await repo.resolveError(input.license_id, id, actor.id);
    await audit(actor.id, 'error.resolved', id);
    return reply({ ok: true });
  }
  return null;
}
