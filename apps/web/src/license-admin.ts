import { api, setAdminRenewer } from './api';
import { proof } from './device';
import { localStore, sessionStore } from './storage';
let renewing: Promise<string> | undefined;
export function licenseAdminSession() {
  return (renewing ??= (async () => {
    const license = JSON.parse(localStore.getItem('uhm-license') || 'null');
    if (!license?.id) throw new Error('ابتدا لایسنس مدیریتی را روی این دستگاه فعال کنید.');
    const result = await api<{ token: string }>('/admin/license-session', {
      license_id: license.id,
      ...(await proof('admin')),
    });
    sessionStore.setItem('uhm-admin', result.token);
    sessionStore.setItem('uhm-admin-mode', 'license');
    return result.token;
  })().finally(() => {
    renewing = undefined;
  }));
}
setAdminRenewer(licenseAdminSession);
