import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Repository } from './repository.ts';
import type { Tables, Table, Admin, License } from '../../packages/contracts/src/index.ts';
export class SupabaseRepository implements Repository {
  private db: SupabaseClient<any, any, any>;
  constructor(private url: string, private secret: string) { this.db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false }, db: { schema: 'uhm' } }); }
  private check(error: { message: string } | null) { if (error) throw new Error('DATABASE_ERROR'); }
  async list<T extends Table>(table: T): Promise<Tables[T][]> {
    const rows: Tables[T][] = []; let offset = 0;
    for (;;) { const { data, error } = await this.db.from(table).select('*').range(offset, offset + 999); this.check(error); rows.push(...(data || []) as unknown as Tables[T][]); if (!data || data.length < 1000) break; offset += 1000; }
    return rows;
  }
  async insert<T extends Table>(table: T, rows: Tables[T][]) { const { error } = await this.db.from(table).insert(rows); this.check(error); }
  async update<T extends Table>(table: T, id: string, patch: Partial<Tables[T]>) { const { error } = await this.db.from(table).update(patch as Record<string, unknown>).eq('id', id); this.check(error); }
  async activate(hash: string, thumb: string, now: string): Promise<License> {
    const { data, error } = await this.db.rpc('activate_license', { p_hash: hash, p_thumb: thumb }); this.check(error); return data as License;
  }
  async consumeChallenge(id: string, thumb: string, now: string) {
    const { data, error } = await this.db.rpc('consume_challenge', { p_id: id, p_thumb: thumb }); this.check(error); return Boolean(data);
  }
  async rateLimit(key: string, limit: number, seconds: number) {
    const { data, error } = await this.db.rpc('take_rate_limit', { p_key: key, p_limit: limit, p_seconds: seconds }); this.check(error); return Boolean(data);
  }
  async admin(token: string): Promise<Admin | null> {
    if (!token) return null;
    const { data: { user }, error } = await this.db.auth.getUser(token); if (error || !user) return null;
    const { data: membership, error: memberError } = await this.db.from('admin_memberships').select('role').eq('id', user.id).eq('enabled', true).maybeSingle();
    if (memberError || !membership) return null;
    // getUser verifies identity; getClaims verifies the JWT before reading its assurance level.
    const { data: claims, error: claimsError } = await this.db.auth.getClaims(token);
    if (claimsError || !claims) return null;
    return { id: user.id, role: membership.role, aal: String(claims.claims.aal || 'aal1') };
  }
  async mutateLicense(id: string, action: string, actor: string, days = 30) {
    const { error } = await this.db.rpc('mutate_license', { p_id: id, p_action: action, p_actor: actor, p_days: days }); this.check(error);
  }
}
