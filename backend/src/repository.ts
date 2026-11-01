import type { Table, Tables, License, Admin } from '../../packages/contracts/src/index.ts';
export interface Repository {
  list<T extends Table>(table: T): Promise<Tables[T][]>;
  insert<T extends Table>(table: T, rows: Tables[T][]): Promise<void>;
  update<T extends Table>(table: T, id: string, patch: Partial<Tables[T]>): Promise<void>;
  activate(hash: string, thumb: string, now: string): Promise<License>;
  consumeChallenge(id: string, thumb: string, now: string): Promise<boolean>;
  rateLimit(key: string, limit: number, seconds: number): Promise<boolean>;
  admin(token: string): Promise<Admin | null>;
  mutateLicense(id: string, action: string, actor: string, days?: number): Promise<void>;
}
