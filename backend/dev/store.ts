import { validatePublication } from '../../packages/contracts/src/index.ts';
import { defaultCategories } from '../../packages/contracts/src/index.ts';
import { summarizeEvents } from '../src/analytics.ts';
import type {
  Tables,
  Table,
  License,
  Admin,
  PackageSpec,
} from '../../packages/contracts/src/index.ts';
import type { Repository } from '../src/repository.ts';
export type State = { [K in Table]: Tables[K][] } & { releases: PackageSpec[] };
export const emptyState = (): State => ({
  licenses: [],
  packages: [],
  audit_events: [],
  challenges: [],
  install_reports: [],
  releases: [],
  admin_access: [],
  telemetry_events: [],
  service_settings: [],
  contact_settings: [],
  custom_roles: [],
  package_categories: defaultCategories(),
});
export class LocalRepository implements Repository {
  private queue: Promise<unknown> = Promise.resolve();
  private limits = new Map<string, { count: number; end: number }>();
  constructor(
    public state: State = emptyState(),
    private persist: (state: State) => Promise<void> = async () => {},
    public adminToken = 'test-admin-token',
  ) {
    this.state = { ...emptyState(), ...state };
  }
  private async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      const previous = structuredClone(this.state);
      try {
        const value = await fn();
        await this.persist(this.state);
        return value;
      } catch (e) {
        this.state = previous;
        throw e;
      }
    });
    this.queue = next.catch(() => {});
    return next;
  }
  async published() {
    await this.queue;
    return structuredClone(this.visiblePackages());
  }
  private visiblePackages() {
    const current = this.state.packages;
    const releases = this.state.releases.map((p) => ({
      package_id: p.id,
      manifest: p,
      published_at: p.released_at || '',
    }));
    return current.flatMap((p) => {
      if (p.status === 'archived' || p.deleted_at) return [];
      const eligible = (p: PackageSpec) =>
        p.channel !== 'test' && (!p.scheduled_at || Date.parse(p.scheduled_at) <= Date.now());
      if (p.status === 'published' && eligible(p)) return [p];
      const previous = releases
        .filter((r) => r.package_id === p.id && eligible(r.manifest))
        .sort((a, b) => b.published_at.localeCompare(a.published_at))[0];
      return previous ? [previous.manifest] : [];
    });
  }
  async releases() {
    await this.queue;
    return structuredClone(this.state.releases).map((p) => ({
      package_id: p.id,
      version: p.version,
      manifest: p,
      published_at: p.released_at || new Date().toISOString(),
    }));
  }
  async list<T extends Table>(table: T): Promise<Tables[T][]> {
    await this.queue;
    return structuredClone(this.state[table]) as Tables[T][];
  }
  async insert<T extends Table>(table: T, rows: Tables[T][]) {
    await this.transaction(() => {
      const target = this.state[table] as Tables[T][];
      if (rows.some((r) => target.some((old) => old.id === r.id))) throw new Error('DUPLICATE_ID');
      target.push(...structuredClone(rows));
      if (table === 'challenges')
        this.state.challenges = this.state.challenges.filter(
          (c) => Date.parse(c.expires_at) > Date.now(),
        );
      this.state.audit_events = this.state.audit_events.slice(-2000);
    });
  }
  async update<T extends Table>(table: T, id: string, patch: Partial<Tables[T]>) {
    await this.transaction(() => {
      const target = this.state[table] as Tables[T][];
      const index = target.findIndex((r) => r.id === id);
      if (index < 0) throw new Error('NOT_FOUND');
      const merged = { ...target[index], ...structuredClone(patch) };
      if (table === 'packages' && (merged as PackageSpec).status === 'published') {
        const p = merged as PackageSpec;
        if (this.state.releases.some((r) => r.id === id && r.version === p.version))
          throw new Error('RELEASE_IMMUTABLE');
        this.state.releases.push(structuredClone(p));
      }
      target[index] = merged;
    });
  }
  async activate(hash: string, thumb: string, now: string) {
    return this.transaction(() => {
      const l = this.state.licenses.find((l) => l.code_hash === hash);
      if (
        !l ||
        l.archived ||
        (l.starts_at && l.starts_at > now) ||
        ['suspended', 'revoked'].includes(l.status) ||
        (l.expires_at && l.expires_at <= now) ||
        (l.device_thumbprint && l.device_thumbprint !== thumb)
      )
        throw new Error('ACTIVATION_DENIED');
      if (!l.activated_at) {
        l.activated_at = now;
        l.expires_at ||= new Date(Date.parse(now) + l.duration_days * 86400000).toISOString();
      }
      if (!l.device_thumbprint) l.activation_count++;
      l.device_thumbprint = thumb;
      l.status = 'active';
      this.state.audit_events.push({
        id: crypto.randomUUID(),
        actor: 'device',
        action: 'license.activated',
        target: l.id,
        detail: '',
        created_at: now,
      });
      return structuredClone(l);
    });
  }
  async consumeChallenge(id: string, thumb: string, now: string) {
    return this.transaction(() => {
      const c = this.state.challenges.find(
        (c) => c.id === id && c.thumbprint === thumb && !c.consumed && c.expires_at > now,
      );
      if (!c) return false;
      c.consumed = true;
      return true;
    });
  }
  async rateLimit(key: string, limit: number, seconds: number) {
    const now = Date.now();
    if (this.limits.size > 10000)
      for (const [k, v] of this.limits) if (v.end < now) this.limits.delete(k);
    let bucket = this.limits.get(key);
    if (!bucket || bucket.end < now) {
      bucket = { count: 0, end: now + seconds * 1000 };
      this.limits.set(key, bucket);
    }
    return ++bucket.count <= limit;
  }
  async admin(token: string): Promise<Admin | null> {
    return token === this.adminToken ? { id: 'demo-owner', role: 'owner', aal: 'aal2' } : null;
  }
  async resolveError(licenseId: string, id: string, actor: string) {
    await this.transaction(() => {
      const event = this.state.telemetry_events.find(
        (e) => e.id === id && e.license_id === licenseId,
      );
      if (!event) throw new Error('NOT_FOUND');
      event.resolved_at = new Date().toISOString();
      event.resolved_by = actor;
    });
  }
  async errorsPage(status: 'open' | 'all' | 'resolved', before?: { at: string; id: string }) {
    return (await this.list('telemetry_events'))
      .filter(
        (e) =>
          (e.type.endsWith('failed') || e.type === 'app_error') &&
          (status === 'all' || (status === 'resolved' ? !!e.resolved_at : !e.resolved_at)) &&
          (!before ||
            e.occurred_at < before.at ||
            (e.occurred_at === before.at && e.id < before.id)),
      )
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id.localeCompare(a.id))
      .slice(0, 100);
  }
  async licenseStats(id: string) {
    const rows = (await this.list('telemetry_events'))
      .filter((e) => e.license_id === id)
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    return {
      totals: summarizeEvents(rows, '0000').totals,
      first_seen: rows[0]?.occurred_at || null,
      last_seen: rows.at(-1)?.occurred_at || null,
    };
  }
  async auditPage(id: string, before?: { at: string; id: string }) {
    return (await this.list('audit_events'))
      .filter(
        (e) =>
          e.target === id &&
          (!before || e.created_at < before.at || (e.created_at === before.at && e.id < before.id)),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
      .slice(0, 100);
  }
  async analytics(since: string) {
    return summarizeEvents(await this.list('telemetry_events'), since);
  }
  async eventsPage(licenseId: string, before?: { at: string; id: string }) {
    return (await this.list('telemetry_events'))
      .filter(
        (e) =>
          e.license_id === licenseId &&
          (!before ||
            e.occurred_at < before.at ||
            (e.occurred_at === before.at && e.id < before.id)),
      )
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id.localeCompare(a.id))
      .slice(0, 100);
  }
  async saveAccess(
    access: import('../../packages/contracts/src/index.ts').AdminAccess,
    actor: string,
    expectedVersion?: number,
  ) {
    await this.transaction(() => {
      const old = this.state.admin_access.find((a) => a.id === access.id);
      if (expectedVersion !== undefined && (old?.version ?? 0) !== expectedVersion)
        throw new Error('EDIT_CONFLICT');
      if (
        old?.enabled &&
        old.role === 'owner' &&
        (!access.enabled || access.role !== 'owner') &&
        !this.state.admin_access.some((a) => a.id !== access.id && a.role === 'owner' && a.enabled)
      )
        throw new Error('LAST_OWNER');
      const next = { ...access, version: (old?.version ?? 0) + 1 };
      this.state.admin_access = this.state.admin_access
        .filter((a) => a.id !== access.id)
        .concat(next);
      this.state.audit_events.push({
        id: crypto.randomUUID(),
        actor,
        action: 'admin.access.changed',
        target: access.id,
        detail: JSON.stringify({ before: old, after: next }),
        created_at: new Date().toISOString(),
      });
    });
  }
  async saveRole(
    role: import('../../packages/contracts/src/index.ts').CustomRole,
    actor: string,
    expectedVersion: number,
  ) {
    await this.transaction(() => {
      const old = this.state.custom_roles.find((r) => r.id === role.id);
      if ((old?.version ?? 0) !== expectedVersion) throw new Error('EDIT_CONFLICT');
      if (
        this.state.custom_roles.some(
          (r) => r.id !== role.id && r.name.toLocaleLowerCase() === role.name.toLocaleLowerCase(),
        )
      )
        throw new Error('ROLE_NAME_EXISTS');
      const next = { ...role, version: (old?.version ?? 0) + 1 };
      this.state.custom_roles = this.state.custom_roles
        .filter((r) => r.id !== role.id)
        .concat(next);
      this.state.audit_events.push({
        id: crypto.randomUUID(),
        actor,
        action: 'admin.role.changed',
        target: role.id,
        detail: JSON.stringify({ before: old, after: next }),
        created_at: new Date().toISOString(),
      });
    });
  }
  async ingestEvents(events: import('../../packages/contracts/src/index.ts').TelemetryEvent[]) {
    await this.transaction(() => {
      for (const event of events)
        if (
          !this.state.telemetry_events.some(
            (e) => e.id === event.id && e.license_id === event.license_id,
          )
        )
          this.state.telemetry_events.push(structuredClone(event));
    });
  }
  async setLicenseWindow(
    id: string,
    window: import('zod').infer<
      typeof import('../../packages/contracts/src/index.ts').LicenseWindowInput
    >,
    actor: string,
  ) {
    await this.transaction(() => {
      const l = this.state.licenses.find((l) => l.id === id);
      if (!l) throw new Error('NOT_FOUND');
      if (l.entitlement_version !== window.expected_version) throw new Error('EDIT_CONFLICT');
      if (l.status === 'revoked' || (l.activated_at && !window.expires_at))
        throw new Error('INVALID_ACTION');
      const before = { ...l };
      l.starts_at = window.starts_at;
      l.expires_at = window.expires_at;
      l.entitlement_version++;
      this.state.audit_events.push({
        id: crypto.randomUUID(),
        actor,
        action: 'license.window.changed',
        target: id,
        detail: JSON.stringify({
          before: { starts_at: before.starts_at, expires_at: before.expires_at },
          after: { starts_at: l.starts_at, expires_at: l.expires_at },
        }),
        created_at: new Date().toISOString(),
      });
    });
  }
  async saveCategory(
    category: import('../../packages/contracts/src/index.ts').PackageCategory,
    actor: string,
    expectedVersion: number,
  ) {
    await this.transaction(() => {
      const old = this.state.package_categories.find((c) => c.id === category.id);
      if ((old?.version ?? 0) !== expectedVersion) throw new Error('EDIT_CONFLICT');
      const next = { ...category, version: (old?.version ?? 0) + 1 };
      this.state.package_categories = this.state.package_categories
        .filter((c) => c.id !== category.id)
        .concat(next);
      this.state.audit_events.push({
        id: crypto.randomUUID(),
        actor,
        action: 'category.changed',
        target: category.id,
        created_at: new Date().toISOString(),
        detail: JSON.stringify({ before: old, after: next }),
      });
    });
  }
  async saveProfile(
    id: string,
    input: import('zod').infer<typeof import('../../packages/contracts/src/index.ts').ProfileInput>,
    actor: string,
  ) {
    await this.transaction(() => {
      const l = this.state.licenses.find((l) => l.id === id);
      if (!l) throw new Error('NOT_FOUND');
      const before = { display_name: l.display_name, notes: l.notes, tags: l.tags };
      Object.assign(l, input);
      this.state.audit_events.push({
        id: crypto.randomUUID(),
        actor,
        action: 'license.metadata.changed',
        target: id,
        created_at: new Date().toISOString(),
        detail: JSON.stringify({ before, after: input }),
      });
    });
  }
  async saveContact(
    contact: import('../../packages/contracts/src/index.ts').ContactSettings,
    actor: string,
    expectedVersion: number,
  ) {
    return this.transaction(() => {
      const old = this.state.contact_settings.find((c) => c.id === contact.id);
      if ((old?.version ?? 0) !== expectedVersion) throw new Error('EDIT_CONFLICT');
      const next = {
        ...structuredClone(contact),
        version: (old?.version ?? 0) + 1,
        updated_at: new Date().toISOString(),
        updated_by: actor,
      };
      this.state.contact_settings = this.state.contact_settings
        .filter((c) => c.id !== contact.id)
        .concat(next);
      this.state.audit_events.push({
        id: crypto.randomUUID(),
        actor,
        action: 'contact.settings.changed',
        target: contact.id,
        created_at: next.updated_at,
        detail: JSON.stringify({ before: old ?? null, after: next }),
      });
      return structuredClone(next);
    });
  }
  async commitPackage(
    pkg: PackageSpec,
    actor: string,
    action: 'save' | 'publish' | 'archive' | 'delete' | 'restore',
    expectedRevision?: number,
  ) {
    return this.transaction(() => {
      const old = this.state.packages.find((p) => p.id === pkg.id);
      if (expectedRevision !== undefined && (old?.revision ?? (old ? 1 : 0)) !== expectedRevision)
        throw new Error('EDIT_CONFLICT');
      if (old?.deleted_at) throw new Error('PACKAGE_DELETED');
      if ((action === 'save' || action === 'restore') && pkg.status !== 'draft')
        throw new Error('INVALID_ACTION');
      if (action === 'publish' && pkg.status !== 'published') throw new Error('INVALID_ACTION');
      if ((action === 'archive' || action === 'delete') && pkg.status !== 'archived')
        throw new Error('INVALID_ACTION');
      if (
        action === 'delete' &&
        this.visiblePackages().some((p) => p.id !== pkg.id && p.dependencies.includes(pkg.id))
      )
        throw new Error('PACKAGE_IN_USE');
      if (
        (action === 'save' || action === 'restore') &&
        this.state.releases.some((r) => r.id === pkg.id && r.version === pkg.version)
      )
        throw new Error('RELEASE_IMMUTABLE');
      if (this.state.packages.some((p) => p.id !== pkg.id && p.slug === pkg.slug))
        throw new Error('SLUG_EXISTS');
      const next = {
        ...structuredClone(pkg),
        revision: (old?.revision ?? (old ? 1 : 0)) + 1,
        deleted_at: action === 'delete' ? new Date().toISOString() : null,
      };
      if (action === 'publish') {
        validatePublication(next, this.visiblePackages());
        if (old?.status !== 'draft') throw new Error('DRAFT_REQUIRED');
        if (!this.state.package_categories.some((c) => c.id === next.category && c.enabled))
          throw new Error('CATEGORY_UNAVAILABLE');
        if (this.state.releases.some((r) => r.id === next.id && r.version === next.version))
          throw new Error('RELEASE_IMMUTABLE');
        this.state.releases.push(structuredClone(next));
      }
      this.state.packages = this.state.packages.filter((p) => p.id !== pkg.id).concat(next);
      this.state.audit_events.push({
        id: crypto.randomUUID(),
        actor,
        action: action === 'save' ? 'package.draft.saved' : `package.${action}`,
        target: pkg.id,
        created_at: new Date().toISOString(),
        detail: JSON.stringify({
          before: old ? { version: old.version, status: old.status, revision: old.revision } : null,
          after: { version: next.version, status: next.status, revision: next.revision },
        }),
      });
      return structuredClone(next);
    });
  }
  async mutateLicense(id: string, action: string, actor: string, days = 30) {
    await this.transaction(() => {
      const l = this.state.licenses.find((l) => l.id === id);
      if (!l) throw new Error('NOT_FOUND');
      if (l.status === 'revoked') throw new Error('INVALID_ACTION');
      if (action === 'suspend') l.status = 'suspended';
      else if (action === 'revoke') l.status = 'revoked';
      else if (action === 'resume') l.status = l.device_thumbprint ? 'active' : 'unused';
      else if (action === 'reset') {
        l.device_thumbprint = null;
        l.status = 'unused';
      } else if (action === 'extend') {
        if (l.expires_at)
          l.expires_at = new Date(
            Math.max(Date.now(), Date.parse(l.expires_at)) + days * 86400000,
          ).toISOString();
        else l.duration_days += days;
      } else throw new Error('INVALID_ACTION');
      l.entitlement_version++;
      this.state.audit_events.push({
        id: crypto.randomUUID(),
        actor,
        action: `license.${action}`,
        target: id,
        detail: '',
        created_at: new Date().toISOString(),
      });
    });
  }
}
