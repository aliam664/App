import { describe, expect, it } from 'vitest';
import { readRoute, pageUrl, adminPages, launcherPages } from '../apps/web/src/navigation';
describe('shared launcher and console routes', () => {
  for (const admin of [true, false])
    for (const page of admin ? adminPages : launcherPages) {
      it(`round trips ${admin ? 'admin' : 'launcher'} ${page} on a Pages subpath`, () => {
        const url = new URL(pageUrl(page, admin, '/App/'), 'https://example.test');
        expect(url.pathname).toBe('/App/');
        expect(readRoute(url.hash, url.pathname)).toEqual({ admin, page });
      });
    }
  it('rejects unknown routes without interpolating untrusted markup', () => {
    expect(readRoute('#/admin/<script>', '/App/')).toEqual({ admin: true, page: 'dashboard' });
    expect(readRoute('#/unknown', '/App/')).toEqual({ admin: false, page: 'discover' });
    expect(pageUrl('https://evil.invalid', true, '/App/')).toBe('/App/#/admin');
  });
  it('retains the legacy admin path', () =>
    expect(readRoute('', '/admin')).toEqual({ admin: true, page: 'dashboard' }));
});
