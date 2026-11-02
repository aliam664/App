import { z } from 'zod';
import {
  Id,
  Proof,
  AccessInput,
  EventInput,
  ServiceInput,
  defaultService,
  hasPermission,
  rolePermissions,
  type Admin,
  type Permission,
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
      permissions: access.role === 'owner' ? rolePermissions.owner : access.permissions,
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
    await requireAdmin('team.manage');
    return reply({
      members: await repo.list('admin_access'),
      license_options: (await repo.list('licenses')).map((l) => ({
        id: l.id,
        prefix: l.prefix,
        display_name: l.display_name,
        status: l.status,
        archived: l.archived,
      })),
    });
  }
  const accessRoute = path.match(/^\/admin\/team\/([a-f0-9-]+)$/);
  if (accessRoute && method === 'POST') {
    const actor = await requireAdmin('team.manage');
    const id = Id.parse(accessRoute[1]);
    const input = AccessInput.parse(body);
    if (actor.license_id === id) return fail('SELF_ACCESS_CHANGE');
    const old = (await repo.list('admin_access')).find((a) => a.id === id);
    if (
      actor.role !== 'owner' &&
      (old?.role === 'owner' ||
        input.role === 'owner' ||
        input.permissions.some((p) => !hasPermission(actor, p)))
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
    await repo.update('licenses', id, input);
    await audit(
      actor.id,
      'license.metadata.changed',
      id,
      JSON.stringify({
        before: { display_name: old.display_name, notes: old.notes, tags: old.tags },
        after: input,
      }),
    );
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
