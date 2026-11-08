import { expect, it } from 'vitest';
import { assetUrl, modeUrl, isAdminRoute } from '../apps/web/src/runtime';
it('resolves shared public assets for both desktop root and Pages project paths', () => {
  expect(assetUrl('/brand/logo.png', '/')).toBe('/brand/logo.png');
  expect(assetUrl('/brand/logo.png', '/App/')).toBe('/App/brand/logo.png');
  expect(assetUrl('/images/01.jpg', '/App/')).toBe('/App/images/01.jpg');
  expect(assetUrl('https://example.com/image.jpg', '/App/')).toBe('https://example.com/image.jpg');
});
it('uses reload-safe hash navigation without escaping the Pages project path', () => {
  expect(modeUrl(true, '/App/')).toBe('/App/#/admin');
  expect(modeUrl(false, '/App/')).toBe('/App/');
  expect(isAdminRoute('#/admin', '/App/')).toBe(true);
  expect(isAdminRoute('', '/App/admin')).toBe(true);
  expect(isAdminRoute('', '/App/')).toBe(false);
});
