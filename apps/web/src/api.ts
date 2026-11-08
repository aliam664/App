import { sessionStore } from './storage';
import { staticPreview } from './runtime';
import { isTauri } from '@tauri-apps/api/core';
import { createClient } from '@supabase/supabase-js';
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
export const messages: Record<string, string> = {
  ACTIVATION_DENIED: 'فعال‌سازی ممکن نشد؛ اعتبار کد یا اتصال آن به دستگاه دیگری را بررسی کنید.',
  LICENSE_INVALID: 'اشتراک معتبر نیست یا دستگاه آزاد شده است. دوباره فعال‌سازی کنید.',
  GRANT_INVALID: 'مجوز نیاز به تمدید آنلاین دارد.',
  TIER_REQUIRED: 'این پکیج یا یکی از پیش‌نیازها به اشتراک بالاتری نیاز دارد.',
  DEMO_FILES_NOT_CONFIGURED:
    'این پکیج نمایشی است و هنوز فایل واقعی ندارد. در پنل مدیریت یک پکیج با فایل و SHA-256 معتبر منتشر کنید.',
  VALIDATION_ERROR: 'اطلاعات فرم معتبر نیست.',
  ROLE_DENIED: 'نقش شما اجازه این عملیات را ندارد.',
  MFA_REQUIRED: 'برای این عملیات تأیید دومرحله‌ای لازم است.',
  ADMIN_REQUIRED: 'ابتدا وارد پنل شوید.',
  ADMIN_LICENSE_DENIED: 'این لایسنس دسترسی مدیریت فعال ندارد یا به دستگاه دیگری متصل است.',
  SELF_ACCESS_CHANGE: 'تغییر دسترسی یا تعلیق حساب مدیریتی خودتان مجاز نیست.',
  LAST_OWNER: 'آخرین مالک را نمی‌توان حذف یا تنزل داد.',
  SERVICE_PAUSED: 'این عملیات موقتاً در حالت نگهداری متوقف است.',
  RATE_LIMITED: 'درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.',
  EMPTY_INSTALL_PLAN: 'پیش از انتشار، فایل و مرحله نصب را تعریف کنید.',
  DEPENDENCY_CYCLE: 'چرخه در پیش‌نیازها شناسایی شد.',
  DEPENDENCY_UNAVAILABLE: 'یکی از پیش‌نیازها منتشر نشده است.',
  RELEASE_IMMUTABLE: 'نسخه منتشرشده تغییرناپذیر است؛ شماره نسخه جدید وارد کنید.',
  CHALLENGE_INVALID: 'درخواست تأیید دستگاه منقضی شده است؛ دوباره تلاش کنید.',
  SLUG_EXISTS: 'این شناسه متنی قبلاً استفاده شده است؛ شناسه دیگری انتخاب کنید.',
  DATABASE_ERROR: 'ارتباط با پایگاه داده یا اجرای عملیات ناموفق بود. با مدیر سیستم تماس بگیرید.',
  INVALID_ACTION: 'این تغییر برای وضعیت فعلی مجاز نیست.',
  EDIT_CONFLICT: 'این اطلاعات هم‌زمان تغییر کرده است؛ صفحه را تازه و تغییرات را مقایسه کنید.',
  CATEGORY_UNAVAILABLE: 'دسته‌بندی انتخابی وجود ندارد یا برای انتشار جدید غیرفعال است.',
  PACKAGE_IN_USE: 'یک پکیج منتشرشده به این بسته وابسته است؛ ابتدا وابستگی را اصلاح کنید.',
  PACKAGE_DELETED: 'این پکیج حذف منطقی شده و دیگر قابل ویرایش نیست.',
  CONFIRMATION_REQUIRED: 'شناسهٔ تأیید با پکیج انتخابی مطابقت ندارد.',
  DESTINATION_CONFLICT: 'مقصد استخراج با فایل یا پوشهٔ دیگری هم‌پوشانی دارد.',
  VERSION_MUST_INCREASE: 'شمارهٔ نسخهٔ جدید باید از تمام نسخه‌های قبلی بالاتر باشد.',
  DRAFT_REQUIRED: 'فقط پیش‌نویس ذخیره‌شده قابل انتشار است.',
  INSTALL_PLAN_LIMIT: 'نصب هم‌زمان بیش از ۳۰ پکیج مجاز نیست.',
  ARTIFACT_SIZE_LIMIT: 'مجموع فایل‌های این پکیج از سقف ۱۰۰ میلیارد بایت بیشتر است.',
  ROLE_NAME_EXISTS: 'این نام نقش قبلاً ثبت شده است؛ نام دیگری انتخاب کنید.',
  NOT_FOUND: 'مورد انتخاب‌شده پیدا نشد؛ صفحه را تازه کنید.',
  NETWORK_ERROR: 'ارتباط برقرار نشد؛ اتصال را بررسی و دوباره تلاش کنید.',
  SAVE_AS_DRAFT: 'تغییرات را ابتدا به‌صورت پیش‌نویس ذخیره کنید.',
};

export async function requireContentV2() {
  const health = await api<{ capabilities?: string[] }>('/health');
  if (!health.capabilities?.includes('content-packages-v2'))
    throw new Error(
      'این سرور هنوز API و migration جدید مدیریت محتوا را ندارد؛ برای جلوگیری از حذف بی‌صدای تنظیمات، ابتدا استقرار نسخه جدید سرور لازم است.',
    );
}
