import { z } from 'zod';
import {
  CategoryInput,
  Id,
  PackageSpec,
  Version,
  compareVersions,
  validatePublication,
  type Admin,
  type Permission,
} from '../../packages/contracts/src/index.ts';
import type { Repository } from './repository.ts';
export async function packageAdmin(c: {
  path: string;
  method: string;
  body: unknown;
  repo: Repository;
  requireAdmin: (p: Permission | 'read') => Promise<Admin>;
  reply: (value: unknown, status?: number) => Response;
}) {
  const { path, method, body, repo, requireAdmin, reply } = c;
  const category = path.match(/^\/admin\/categories\/([a-z0-9-]{2,64})$/);
  if (category && method === 'POST') {
    const actor = await requireAdmin('categories.manage');
    const { expected_version, ...input } = CategoryInput.parse(body);
    await repo.saveCategory(
      { ...input, id: category[1], version: 1, updated_at: new Date().toISOString() },
      actor.id,
      expected_version,
    );
    return reply({ ok: true });
  }
  const operation = path.match(/^\/admin\/packages\/([a-f0-9-]+)\/(delete|restore)$/);
  if (operation && method === 'POST') {
    const actor = await requireAdmin(
      operation[2] === 'delete' ? 'content.delete' : 'content.versions',
    );
    const id = Id.parse(operation[1]);
    const all = await repo.list('packages');
    const current = all.find((p) => p.id === id && !p.deleted_at);
    if (!current) return reply({ error: 'NOT_FOUND' }, 404);
    if (operation[2] === 'delete') {
      const input = z
        .object({ confirm_slug: z.string(), expected_revision: z.number().int().positive() })
        .strict()
        .parse(body);
      if (input.confirm_slug !== current.slug)
        return reply({ error: 'CONFIRMATION_REQUIRED' }, 400);
      if ((await repo.published()).some((p) => p.id !== id && p.dependencies.includes(id)))
        return reply({ error: 'PACKAGE_IN_USE' }, 409);
      await repo.commitPackage(
        { ...current, status: 'archived' },
        actor.id,
        'delete',
        input.expected_revision,
      );
      return reply({ ok: true });
    }
    const input = z
      .object({
        release_version: Version,
        new_version: Version,
        expected_revision: z.number().int().positive(),
      })
      .strict()
      .parse(body);
    const releases = await repo.releases();
    const release = releases.find(
      (r) => r.package_id === id && r.version === input.release_version,
    );
    if (!release) return reply({ error: 'NOT_FOUND' }, 404);
    if (
      [current.version, ...releases.filter((r) => r.package_id === id).map((r) => r.version)].some(
        (v) => compareVersions(input.new_version, v) <= 0,
      )
    )
      return reply({ error: 'VERSION_MUST_INCREASE' }, 409);
    // Restore means an editable forward-version draft, never silently downgrade users' files.
    const candidate = PackageSpec.parse({
      ...release.manifest,
      version: input.new_version,
      status: 'draft',
      released_at: null,
      scheduled_at: null,
      revision: current.revision,
      deleted_at: null,
    });
    validatePublication(candidate, await repo.published());
    const saved = await repo.commitPackage(candidate, actor.id, 'restore', input.expected_revision);
    return reply({ package: saved });
  }
  return null;
}
