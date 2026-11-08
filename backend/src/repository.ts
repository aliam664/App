import type { Table, Tables, License, Admin } from '../../packages/contracts/src/index.ts';
export interface Repository {
  published(): Promise<import('../../packages/contracts/src/index.ts').PackageSpec[]>;
  releases(): Promise<
    {
      package_id: string;
      version: string;
      manifest: import('../../packages/contracts/src/index.ts').PackageSpec;
      published_at: string;
    }[]
  >;
  list<T extends Table>(table: T): Promise<Tables[T][]>;
  insert<T extends Table>(table: T, rows: Tables[T][]): Promise<void>;
  update<T extends Table>(table: T, id: string, patch: Partial<Tables[T]>): Promise<void>;
  activate(hash: string, thumb: string, now: string): Promise<License>;
  consumeChallenge(id: string, thumb: string, now: string): Promise<boolean>;
  rateLimit(key: string, limit: number, seconds: number): Promise<boolean>;
  admin(token: string): Promise<Admin | null>;
  resolveError(licenseId: string, id: string, actor: string): Promise<void>;
  errorsPage(
    status: 'open' | 'all' | 'resolved',
    before?: { at: string; id: string },
  ): Promise<import('../../packages/contracts/src/index.ts').TelemetryEvent[]>;
  licenseStats(id: string): Promise<{
    totals: { type: string; count: number }[];
    first_seen: string | null;
    last_seen: string | null;
  }>;
  auditPage(
    id: string,
    before?: { at: string; id: string },
  ): Promise<import('../../packages/contracts/src/index.ts').AuditEvent[]>;
  analytics(since: string): Promise<ReturnType<typeof import('./analytics.ts').summarizeEvents>>;
  eventsPage(
    licenseId: string,
    before?: { at: string; id: string },
  ): Promise<import('../../packages/contracts/src/index.ts').TelemetryEvent[]>;
  saveAccess(
    access: import('../../packages/contracts/src/index.ts').AdminAccess,
    actor: string,
    expectedVersion?: number,
  ): Promise<void>;
  saveRole(
    role: import('../../packages/contracts/src/index.ts').CustomRole,
    actor: string,
    expectedVersion: number,
  ): Promise<void>;
  ingestEvents(
    events: import('../../packages/contracts/src/index.ts').TelemetryEvent[],
  ): Promise<void>;
  setLicenseWindow(
    id: string,
    window: import('zod').infer<
      typeof import('../../packages/contracts/src/index.ts').LicenseWindowInput
    >,
    actor: string,
  ): Promise<void>;
  saveCategory(
    category: import('../../packages/contracts/src/index.ts').PackageCategory,
    actor: string,
    expectedVersion: number,
  ): Promise<void>;
  commitPackage(
    pkg: import('../../packages/contracts/src/index.ts').PackageSpec,
    actor: string,
    action: 'save' | 'publish' | 'archive' | 'delete' | 'restore',
    expectedRevision?: number,
  ): Promise<import('../../packages/contracts/src/index.ts').PackageSpec>;
  saveProfile(
    id: string,
    input: import('zod').infer<typeof import('../../packages/contracts/src/index.ts').ProfileInput>,
    actor: string,
  ): Promise<void>;
  mutateLicense(id: string, action: string, actor: string, days?: number): Promise<void>;
}
