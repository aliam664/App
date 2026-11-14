import { sessionStore } from './storage';
import { staticPreview } from './runtime';
import { isTauri } from '@tauri-apps/api/core';
import { createClient } from '@supabase/supabase-js';
import { L, errorMessages } from './i18n';

export const base = import.meta.env.VITE_API_BASE || '/api';
export const supabase =
  !staticPreview &&
  import.meta.env.VITE_SUPABASE_URL &&
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
    ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
    : null;

export class ApiError extends Error {
  constructor(
    public code: string,
    public detail = '',
  ) {
    super(code);
  }
}

let sandbox:
  Promise<Awaited<ReturnType<typeof import('./static-preview').createStaticPreview>>> | undefined;
let adminRenewer: (() => Promise<string>) | undefined;
export function setAdminRenewer(renew: () => Promise<string>) {
  adminRenewer = renew;
}

export async function api<T = any>(path: string, body?: unknown, token?: string): Promise<T> {
  const isAdmin = path.startsWith('/admin/') && path !== '/admin/license-session';
  const licenseMode = isAdmin && !!token && sessionStore.getItem('uhm-admin-mode') === 'license';
  if (licenseMode) token = sessionStore.getItem('uhm-admin') || token;
  const send = async (bearer?: string) => {
    const result =
      staticPreview && !isTauri()
        ? await (
            await (sandbox ??= import('./static-preview').then((m) => m.createStaticPreview()))
          )(path, body, bearer)
        : await fetch(`${base}${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: {
              ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
              ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(20000),
          });
    return result;
  };
  let result = await send(token);
  if (result.status === 401 && licenseMode && adminRenewer) {
    try {
      result = await send(await adminRenewer());
    } catch {
      /* Surface original authorization failure. */
    }
  }
  const data = await result.json();
  if (!result.ok)
    throw new ApiError(
      data.error || 'NETWORK_ERROR',
      data.issues?.map((i: any) => `${i.path.join('.')}: ${i.message}`).join(' / ') ||
        data.message ||
        '',
    );
  return data;
}

export const messages = new Proxy({} as Record<string, string>, {
  get(_t, prop: string) {
    return errorMessages()[prop];
  },
});

export async function requireContentV2() {
  const health = await api<{ capabilities?: string[] }>('/health');
  if (!health.capabilities?.includes('content-packages-v2'))
    throw new Error(
      L(
        'این سرور هنوز API و migration جدید مدیریت محتوا را ندارد؛ برای جلوگیری از حذف بی‌صدای تنظیمات، ابتدا استقرار نسخه جدید سرور لازم است.',
        'This server does not expose content-packages-v2 yet; deploy the updated backend before saving advanced package metadata.',
      ),
    );
}
