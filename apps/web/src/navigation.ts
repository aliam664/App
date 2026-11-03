import { isAdminRoute, modeUrl } from './runtime';
export const launcherPages = [
  'discover',
  'content',
  'library-settings',
  'library',
  'downloads',
  'settings',
];
export const adminPages = [
  'dashboard',
  'licenses',
  'packages',
  'versions',
  'devices',
  'analytics',
  'errors',
  'team',
  'service',
  'logs',
  'settings',
];
export function readRoute(hash = location.hash, pathname = location.pathname) {
  const admin = isAdminRoute(hash, pathname);
  const candidate = hash.replace(admin ? /^#\/admin\/?/ : /^#\/?/, '');
  const page = (admin ? adminPages : launcherPages).includes(candidate)
    ? candidate
    : admin
      ? 'dashboard'
      : 'discover';
  return { admin, page };
}
export function pageUrl(page: string, admin: boolean, base = import.meta.env.BASE_URL) {
  const valid = (admin ? adminPages : launcherPages).includes(page);
  if (!valid || page === (admin ? 'dashboard' : 'discover')) return modeUrl(admin, base);
  return `${modeUrl(admin, base)}${admin ? '/' : '#/'}${page}`;
}
