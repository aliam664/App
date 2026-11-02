/** Build/runtime differences only. The rendered UI is shared by Pages and Tauri. */
export const staticPreview = import.meta.env.MODE === 'pages';
export const buildRevision: string = import.meta.env.VITE_BUILD_REVISION || 'local';

export function assetUrl(path: string, base = import.meta.env.BASE_URL): string {
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  return `${base}${path.replace(/^\/+/, '')}`;
}
export function modeUrl(admin = false, base = import.meta.env.BASE_URL): string {
  return `${base}${admin ? '#/admin' : ''}`;
}
export function isAdminRoute(hash = location.hash, pathname = location.pathname): boolean {
  return hash === '#/admin' || hash.startsWith('#/admin/') || /\/admin\/?$/.test(pathname);
}
