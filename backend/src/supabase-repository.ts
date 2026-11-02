import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Repository } from './repository.ts';
import type { Tables, Table, Admin, License } from '../../packages/contracts/src/index.ts';
export class SupabaseRepository implements Repository {
  private db: SupabaseClient<any, any, any>;
  constructor(
    private url: string,
    private secret: string,
  ) {
    this.db = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: 'uhm' },
    });
  }
  private check(error: { message: string } | null) {
    if (error) {
      const known = [
        'RELEASE_IMMUTABLE',
        'EMPTY_INSTALL_PLAN',
        'INVALID_ACTION',
        'NOT_FOUND',
        'LAST_OWNER',
      ];
      const code = known.find((code) => error.message.includes(code));
      if (code) throw new Error(code);
      if (error.message.includes('package_releases_pkey')) throw new Error('RELEASE_IMMUTABLE');
      if (error.message.includes('packages_slug_key')) throw new Error('SLUG_EXISTS');
      throw new Error('DATABASE_ERROR');
    }
  }
  async published() {
    const rows: import('../../packages/contracts/src/index.ts').PackageSpec[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await this.db.rpc('published_packages').range(offset, offset + 999);
      this.check(error);
      rows.push(...(data || []));
      if (!data || data.length < 1000) return rows;
    }
  }
  async releases() {
    const { data, error } = await this.db
      .from('package_releases')
      .select('*')
      .order('published_at', { ascending: false })
      .limit(500);
    this.check(error);
    return (data || []) as {
      package_id: string;
      version: string;
      manifest: import('../../packages/contracts/src/index.ts').PackageSpec;
      published_at: string;
    }[];
  }
  async list<T extends Table>(table: T): Promise<Tables[T][]> {
    const rows: Tables[T][] = [];
    let offset = 0;
    for (;;) {
      const { data, error } = await this.db
        .from(table)
        .select('*')
        .range(offset, offset + 999);
      this.check(error);
      rows.push(...((data || []) as unknown as Tables[T][]));
      if (!data || data.length < 1000) break;
      offset += 1000;
    }
    return rows;
  }
  async insert<T extends Table>(table: T, rows: Tables[T][]) {
    const { error } = await this.db.from(table).insert(rows);
    this.check(error);
  }
  async update<T extends Table>(table: T, id: string, patch: Partial<Tables[T]>) {
    const { error } = await this.db
      .from(table)
      .update(patch as Record<string, unknown>)
      .eq('id', id);
    this.check(error);
  }
  async activate(hash: string, thumb: string, now: string): Promise<License> {
    const { data, error } = await this.db.rpc('activate_license', { p_hash: hash, p_thumb: thumb });
    this.check(error);
    return data as License;
  }
  async consumeChallenge(id: string, thumb: string, now: string) {
    const { data, error } = await this.db.rpc('consume_challenge', { p_id: id, p_thumb: thumb });
    this.check(error);
    return Boolean(data);
  }
  async rateLimit(key: string, limit: number, seconds: number) {
    const { data, error } = await this.db.rpc('take_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_seconds: seconds,
    });
    this.check(error);
    return Boolean(data);
  }
  async admin(token: string): Promise<Admin | null> {
    if (!token) return null;
    const {
      data: { user },
      error,
    } = await this.db.auth.getUser(token);
    if (error || !user) return null;
    const { data: membership, error: memberError } = await this.db
      .from('admin_memberships')
      .select('role')
      .eq('id', user.id)
      .eq('enabled', true)
      .maybeSingle();
    if (memberError || !membership) return null;
    // getUser verifies identity; getClaims verifies the JWT before reading its assurance level.
    const { data: claims, error: claimsError } = await this.db.auth.getClaims(token);
    if (claimsError || !claims) return null;
    return { id: user.id, role: membership.role, aal: String(claims.claims.aal || 'aal1') };
  }
  async errorsPage(status: 'open' | 'all' | 'resolved', before?: { at: string; id: string }) {
    let q = this.db
      .from('telemetry_events')
      .select('*')
      .in('type', ['download_failed', 'install_failed', 'app_error'])
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(100);
    if (status === 'open') q = q.is('resolved_at', null);
    if (status === 'resolved') q = q.not('resolved_at', 'is', null);
    if (before)
      q = q.or(`occurred_at.lt.${before.at},and(occurred_at.eq.${before.at},id.lt.${before.id})`);
    const { data, error } = await q;
    this.check(error);
    return data as import('../../packages/contracts/src/index.ts').TelemetryEvent[];
  }
  async licenseStats(id: string) {
    const { data, error } = await this.db.rpc('license_event_stats', { p_license: id });
    this.check(error);
    return data;
  }
  async auditPage(id: string, before?: { at: string; id: string }) {
    let q = this.db
      .from('audit_events')
      .select('*')
      .eq('target', id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(100);
    if (before)
      q = q.or(`created_at.lt.${before.at},and(created_at.eq.${before.at},id.lt.${before.id})`);
    const { data, error } = await q;
    this.check(error);
    return data as import('../../packages/contracts/src/index.ts').AuditEvent[];
  }
  async analytics(since: string) {
    const { data, error } = await this.db.rpc('dashboard_analytics', { p_since: since });
    this.check(error);
    return data;
  }
  async eventsPage(licenseId: string, before?: { at: string; id: string }) {
    let q = this.db
      .from('telemetry_events')
      .select('*')
      .eq('license_id', licenseId)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(100);
    if (before)
      q = q.or(`occurred_at.lt.${before.at},and(occurred_at.eq.${before.at},id.lt.${before.id})`);
    const { data, error } = await q;
    this.check(error);
    return data as import('../../packages/contracts/src/index.ts').TelemetryEvent[];
  }
  async saveAccess(
    access: import('../../packages/contracts/src/index.ts').AdminAccess,
    actor: string,
  ) {
    const { error } = await this.db.rpc('save_admin_access', { p_access: access, p_actor: actor });
    this.check(error);
  }
  async ingestEvents(events: import('../../packages/contracts/src/index.ts').TelemetryEvent[]) {
    const { error } = await this.db
      .from('telemetry_events')
      .upsert(events, { onConflict: 'license_id,id', ignoreDuplicates: true });
    this.check(error);
  }
  async mutateLicense(id: string, action: string, actor: string, days = 30) {
    const { error } = await this.db.rpc('mutate_license', {
      p_id: id,
      p_action: action,
      p_actor: actor,
      p_days: days,
    });
    this.check(error);
  }
}
