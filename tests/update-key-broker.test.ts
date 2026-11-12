import { describe, expect, it, vi } from 'vitest';
import { generateKeyPair, SignJWT } from 'jose';
import {
  assertReleaseIdentity,
  BROKER_URL,
  createUpdateKeyBroker,
  RELEASE_WORKFLOW,
  verifyReleaseIdentity,
} from '../backend/src/update-key-broker';
function claims() {
  const now = Math.floor(Date.now() / 1000);
  return {
    repository_id: '1363261683',
    repository_owner_id: '259944690',
    repository: 'aliam664/App',
    ref: 'refs/heads/main',
    ref_type: 'branch',
    workflow_ref: RELEASE_WORKFLOW,
    event_name: 'workflow_dispatch',
    runner_environment: 'github-hosted',
    sha: 'a'.repeat(40),
    run_id: '123',
    run_attempt: '1',
    sub: 'repo:aliam664@259944690/App@1363261683:ref:refs/heads/main',
    iat: now,
    exp: now + 300,
  };
}
function request(body: unknown = { build_run: '1234' }) {
  return new Request(BROKER_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer test' },
    body: JSON.stringify(body),
  });
}
describe('release signing credential trust boundary', () => {
  for (const field of [
    'repository_id',
    'repository_owner_id',
    'repository',
    'ref',
    'ref_type',
    'workflow_ref',
    'event_name',
    'runner_environment',
    'sha',
    'sub',
    'run_id',
  ]) {
    it(`rejects a different ${field}`, () => {
      expect(() => assertReleaseIdentity({ ...claims(), [field]: 'untrusted' })).toThrow();
    });
  }
  it('accepts the exact legacy-format subject only with pinned numeric repository and owner claims', () => {
    expect(() =>
      assertReleaseIdentity({
        ...claims(),
        sub: 'repo:aliam664/App:ref:refs/heads/main',
      }),
    ).not.toThrow();
  });
  it('accepts the fixed session branch with its matching workflow and subject', () => {
    const ref = 'refs/heads/arena/0274db12-app';
    expect(() =>
      assertReleaseIdentity({
        ...claims(),
        ref,
        workflow_ref: `aliam664/App/.github/workflows/release-launcher.yml@${ref}`,
        sub: `repo:aliam664@259944690/App@1363261683:ref:${ref}`,
      }),
    ).not.toThrow();
  });
  it('retires the old session branch and rejects unrelated refs', () => {
    for (const ref of [
      'refs/heads/arena/37af8e92-app',
      'refs/heads/arena/0b78cac4-app',
      'refs/heads/arena/a81c9815-app',
      'refs/heads/feature',
      'refs/tags/uhm-launcher-v0.1.3',
      'refs/tags/uhm-launcher-v0.1.4',
    ]) {
      expect(() =>
        assertReleaseIdentity({
          ...claims(),
          ref,
          workflow_ref: `aliam664/App/.github/workflows/release-launcher.yml@${ref}`,
          sub: `repo:aliam664@259944690/App@1363261683:ref:${ref}`,
        }),
      ).toThrow();
    }
  });
  it('rejects a modern subject with different immutable IDs even when the name matches', () => {
    expect(() =>
      assertReleaseIdentity({
        ...claims(),
        sub: 'repo:aliam664@259944690/App@999:ref:refs/heads/main',
      }),
    ).toThrow();
  });
  it('cryptographically verifies issuer/audience/algorithm and token age', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const sign = (audience: string, issuedAt = Math.floor(Date.now() / 1000)) =>
      new SignJWT({ ...claims(), iat: issuedAt, exp: issuedAt + 300 })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer('https://token.actions.githubusercontent.com')
        .setAudience(audience)
        .sign(privateKey);
    expect(
      (await verifyReleaseIdentity(await sign(BROKER_URL), async () => publicKey)).run_id,
    ).toBe('123');
    await expect(
      verifyReleaseIdentity(await sign('another service'), async () => publicKey),
    ).rejects.toThrow();
    await expect(
      verifyReleaseIdentity(
        await sign(BROKER_URL, Math.floor(Date.now() / 1000) - 180),
        async () => publicKey,
      ),
    ).rejects.toThrow();
    const different = await generateKeyPair('RS256');
    await expect(
      verifyReleaseIdentity(await sign(BROKER_URL), async () => different.publicKey),
    ).rejects.toThrow();
  });
  it('never reads signing secrets for anonymous, wrong-workflow or failed-build requests', async () => {
    const privateKey = vi.fn(() => 'fixture-not-a-real-key');
    const handler = createUpdateKeyBroker({
      privateKey,
      verifyIdentity: async () => claims(),
      verifyBuild: async () => {
        throw Error('failed');
      },
    });
    expect((await handler(new Request(BROKER_URL))).status).toBe(405);
    expect((await handler(new Request(BROKER_URL, { method: 'POST' }))).status).toBe(401);
    expect((await handler(request())).status).toBe(409);
    const wrong = createUpdateKeyBroker({
      privateKey,
      verifyIdentity: async () => ({ ...claims(), repository: 'someone/else' }),
    });
    expect((await wrong(request())).status).toBe(401);
    expect(privateKey).not.toHaveBeenCalled();
  });
  it('issues credentials only after build proof, without CORS/cache, and rejects repeat issuance', async () => {
    const check = vi.fn(async () => {});
    const handler = createUpdateKeyBroker({
      privateKey: () => 'fixture-not-a-real-key',
      verifyIdentity: async () => claims(),
      verifyBuild: check,
    });
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(check).toHaveBeenCalledWith('1234', 'a'.repeat(40));
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect((await response.json()).private_key).toBe('fixture-not-a-real-key');
    expect((await handler(request())).status).toBe(409);
  });
  it('rejects unbounded/invalid bodies and does not release an absent key', async () => {
    const handler = createUpdateKeyBroker({
      privateKey: () => undefined,
      verifyIdentity: async () => claims(),
      verifyBuild: async () => {},
    });
    expect((await handler(request({ build_run: '../private' }))).status).toBe(400);
    expect((await handler(request({ build_run: '1', padding: 'x'.repeat(1100) }))).status).toBe(
      400,
    );
    expect((await handler(request())).status).toBe(503);
  });
});
