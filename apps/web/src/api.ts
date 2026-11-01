import { createClient } from '@supabase/supabase-js';
export const base = import.meta.env.VITE_API_BASE || '/api';
export const supabase = import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) : null;
export class ApiError extends Error { constructor(public code: string, public detail = '') { super(code); } }
export async function api<T = any>(path: string, body?: unknown, token?: string): Promise<T> {
  const result = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const data = await result.json();
  if (!result.ok) throw new ApiError(data.error || 'NETWORK_ERROR', data.issues?.map((i: any) => `${i.path.join('.')}: ${i.message}`).join(' / '));
  return data;
}
export const messages: Record<string, string> = {
  ACTIVATION_DENIED: 'فعال‌سازی ممکن نشد؛ اعتبار کد یا اتصال آن به دستگاه دیگری را بررسی کنید.',
  LICENSE_INVALID: 'اشتراک معتبر نیست یا دستگاه آزاد شده است. دوباره فعال‌سازی کنید.',
  GRANT_INVALID: 'مجوز نیاز به تمدید آنلاین دارد.',
  TIER_REQUIRED: 'این پکیج یا یکی از پیش‌نیازها به اشتراک بالاتری نیاز دارد.',
  DEMO_FILES_NOT_CONFIGURED: 'این پکیج نمایشی است و هنوز فایل واقعی ندارد. در پنل مدیریت یک پکیج با فایل و SHA-256 معتبر منتشر کنید.',
  VALIDATION_ERROR: 'اطلاعات فرم معتبر نیست.', ROLE_DENIED: 'نقش شما اجازه این عملیات را ندارد.',
  MFA_REQUIRED: 'برای این عملیات تأیید دومرحله‌ای لازم است.', ADMIN_REQUIRED: 'ابتدا وارد پنل شوید.',
  RATE_LIMITED: 'درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.',
  EMPTY_INSTALL_PLAN: 'پیش از انتشار، فایل و مرحله نصب را تعریف کنید.',
  DEPENDENCY_CYCLE: 'چرخه در پیش‌نیازها شناسایی شد.', DEPENDENCY_UNAVAILABLE: 'یکی از پیش‌نیازها منتشر نشده است.',
  RELEASE_IMMUTABLE: 'نسخه منتشرشده تغییرناپذیر است؛ شماره نسخه جدید وارد کنید.',
  CHALLENGE_INVALID: 'درخواست تأیید دستگاه منقضی شده است؛ دوباره تلاش کنید.',
  INVALID_ACTION: 'این تغییر برای وضعیت فعلی مجاز نیست.',
};
