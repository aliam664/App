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
    const current = await this.list('packages');
    const releases = await this.releases();
    return current.flatMap((p) => {
      if (p.status === 'archived') return [];
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
        ['suspended', 'revoked'].includes(l.status) ||
        (l.expires_at && l.expires_at <= now) ||
        (l.device_thumbprint && l.device_thumbprint !== thumb)
      )
        throw new Error('ACTIVATION_DENIED');
      if (!l.activated_at) {
        l.activated_at = now;
        l.expires_at = new Date(Date.parse(now) + l.duration_days * 86400000).toISOString();
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
  ) {
    await this.transaction(() => {
      const old = this.state.admin_access.find((a) => a.id === access.id);
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
