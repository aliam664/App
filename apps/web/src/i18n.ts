import type { Permission } from '../../../packages/contracts/src/index';
import { localStore } from './storage';

export type Lang = 'fa' | 'en';

export function getLang(): Lang {
  if (typeof localStorage === 'undefined') return 'fa';
  return localStore.getItem('uhm-language') === 'en' ? 'en' : 'fa';
}

export function setLang(next: Lang) {
  if (typeof localStorage !== 'undefined') localStore.setItem('uhm-language', next);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next;
    document.documentElement.dir = next === 'fa' ? 'rtl' : 'ltr';
  }
}

export const L = <T>(faVal: T, enVal: T, lang = getLang()): T => (lang === 'en' ? enVal : faVal);

export const num = (n: number, lang = getLang()) =>
  new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'fa-IR').format(n);

export const fmtDate = (s: string | null, lang = getLang()) =>
  s
    ? new Date(s).toLocaleDateString(lang === 'en' ? 'en-US' : 'fa-IR', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '—';

export const fmtTime = (s: string | Date, lang = getLang()) =>
  new Date(s).toLocaleTimeString(lang === 'en' ? 'en-US' : 'fa-IR', {
    hour: '2-digit',
    minute: '2-digit',
  });

export const fmtDateTime = (s: string | Date, lang = getLang()) =>
  new Date(s).toLocaleString(lang === 'en' ? 'en-US' : 'fa-IR');

export const fmtSize = (bytes: number, lang = getLang()) => {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1000) return `${num(Math.round(bytes), lang)} B`;
  if (bytes < 1e6) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / (bytes >= 1e9 ? 1e9 : 1e6)).toFixed(1)} ${bytes >= 1e9 ? 'GB' : 'MB'}`;
};

export const categoryLabelsEn: Record<string, string> = {
  graphics: 'Graphics & Lighting',
  tracks: 'Tracks & Circuits',
  cars: 'Cars & GT',
  tools: 'Core Tools',
};

export const statusLabels = (lang = getLang()): Record<string, string> =>
  lang === 'en'
    ? {
        active: 'Active',
        unused: 'Unused',
        suspended: 'Suspended',
        revoked: 'Revoked',
        published: 'Published',
        draft: 'Draft',
        archived: 'Archived',
        scheduled: 'Scheduled',
        expired: 'Expired',
      }
    : {
        active: 'فعال',
        unused: 'فعال‌نشده',
        suspended: 'معلق',
        revoked: 'لغوشده',
        published: 'منتشرشده',
        draft: 'پیش‌نویس',
        archived: 'بایگانی',
        scheduled: 'شروع در آینده',
        expired: 'منقضی‌شده',
      };

export const roleLabels = (lang = getLang()): Record<string, string> =>
  lang === 'en'
    ? {
        owner: 'Owner',
        license_manager: 'License Manager',
        content_manager: 'Content Manager',
        support: 'Support',
        viewer: 'Viewer',
      }
    : {
        owner: 'مالک اصلی',
        license_manager: 'مدیر لایسنس',
        content_manager: 'مدیر محتوا',
        support: 'پشتیبان',
        viewer: 'مشاهده‌گر',
      };

export const permissionLabelsMap = (lang = getLang()): Record<Permission, string> =>
  lang === 'en'
    ? {
        'licenses.read': 'View license dossiers',
        'licenses.create': 'Generate licenses',
        'licenses.update': 'Edit profile, window & tier',
        'licenses.suspend': 'Suspend & resume access',
        'licenses.revoke': 'Permanently revoke license',
        'licenses.reset': 'Release bound device',
        'licenses.extend': 'Extend license duration',
        'licenses.archive': 'Archive licenses',
        'content.read': 'View catalog & drafts',
        'content.write': 'Legacy combined edit permission',
        'content.create': 'Create new packages',
        'content.update': 'Edit packages, links & passwords',
        'content.delete': 'Soft-delete packages (preserve history)',
        'content.versions': 'Restore previous release as draft',
        'categories.manage': 'Manage catalog categories',
        'users.read': 'View user profiles',
        'users.manage': 'Edit user profile metadata only',
        'devices.read': 'View bound device registry',
        'roles.manage': 'Create & edit custom roles',
        'content.publish': 'Validate, publish & archive releases',
        'analytics.read': 'View telemetry insights',
        'errors.read': 'View client incident reports',
        'errors.resolve': 'Resolve client incidents',
        'team.manage': 'Delegate administrator access',
        'service.manage': 'Control service maintenance state',
        'contact.manage': 'Manage public Contact Us channels',
        'audit.read': 'View immutable audit logs',
      }
    : {
        'licenses.read': 'مشاهده پرونده لایسنس',
        'licenses.create': 'صدور لایسنس',
        'licenses.update': 'ویرایش نام، توضیح و سطح',
        'licenses.suspend': 'تعلیق و رفع تعلیق',
        'licenses.revoke': 'لغو دائمی',
        'licenses.reset': 'آزادسازی دستگاه',
        'licenses.extend': 'تمدید اعتبار',
        'licenses.archive': 'بایگانی',
        'content.read': 'مشاهده محتوا',
        'content.write': 'مجوز ترکیبی قدیمی: ساخت و ویرایش محتوا',
        'content.create': 'ساخت پکیج جدید',
        'content.update': 'ویرایش پکیج و فایل‌های دانلود',
        'content.delete': 'حذف منطقی پکیج؛ حفظ سابقه',
        'content.versions': 'ساخت نسخهٔ جدید از انتشار قبلی',
        'categories.manage': 'مدیریت دسته‌بندی‌ها',
        'users.read': 'مشاهده پروفایل کاربران',
        'users.manage': 'ویرایش اطلاعات کاربران؛ نه اعتبار لایسنس',
        'devices.read': 'مشاهده دستگاه‌های متصل',
        'roles.manage': 'ساخت و ویرایش نقش‌های سفارشی',
        'content.publish': 'انتشار و بایگانی محتوا',
        'analytics.read': 'مشاهده تحلیل عملکرد',
        'errors.read': 'مشاهده خطاها',
        'errors.resolve': 'رسیدگی به خطاها',
        'team.manage': 'واگذاری دسترسی مدیران',
        'service.manage': 'کنترل نگهداری سرویس',
        'contact.manage': 'مدیریت اطلاعات تماس با ما',
        'audit.read': 'مشاهده ردپای مدیریتی',
      };

export const eventLabelsMap = (lang = getLang()): Record<string, string> =>
  lang === 'en'
    ? {
        app_open: 'Launcher opened',
        download_started: 'Download started',
        download_completed: 'Verified file downloaded',
        package_download_completed: 'Package download completed',
        download_failed: 'Download failed',
        install_started: 'Installation started',
        install_completed: 'Verified installation',
        install_failed: 'Installation failed',
        app_error: 'Application error',
      }
    : {
        app_open: 'اجرای برنامه',
        download_started: 'شروع دانلود',
        download_completed: 'دانلود فایل تأییدشده',
        package_download_completed: 'دانلود کامل پکیج',
        download_failed: 'خطای دانلود',
        install_started: 'شروع نصب',
        install_completed: 'نصب تأییدشده',
        install_failed: 'خطای نصب',
        app_error: 'خطای برنامه',
      };

export const errorMessages = (lang = getLang()): Record<string, string> =>
  lang === 'en'
    ? {
        ACTIVATION_DENIED: 'Activation failed; verify license validity or device binding status.',
        LICENSE_INVALID: 'License is no longer valid or this device binding was released.',
        GRANT_INVALID: 'Offline license grant requires online renewal.',
        TIER_REQUIRED: 'This package or a dependency requires a higher membership tier.',
        DEMO_FILES_NOT_CONFIGURED:
          'Demo catalog entry has no downloadable artifacts configured yet.',
        VALIDATION_ERROR: 'Submitted form values failed validation.',
        ROLE_DENIED: 'Your account permissions do not allow this action.',
        MFA_REQUIRED: 'Two-factor authentication (AAL2) is required.',
        ADMIN_REQUIRED: 'Sign in to the control room first.',
        ADMIN_LICENSE_DENIED:
          'This license does not hold active admin privileges or is bound to another device.',
        SELF_ACCESS_CHANGE: 'You cannot modify or suspend your own active admin access.',
        LAST_OWNER: 'The final enabled owner cannot be removed or demoted.',
        SERVICE_PAUSED: 'This operation is temporarily paused for maintenance.',
        RATE_LIMITED: 'Too many requests; please wait briefly and retry.',
        EMPTY_INSTALL_PLAN: 'Define at least one file and one install step before publishing.',
        DEPENDENCY_CYCLE: 'Circular package dependency detected.',
        DEPENDENCY_UNAVAILABLE: 'A required prerequisite package is not published.',
        RELEASE_IMMUTABLE: 'Published versions are immutable; increment the version string.',
        CHALLENGE_INVALID: 'Device verification challenge expired; retry the action.',
        SLUG_EXISTS: 'This slug is already assigned to another package.',
        DATABASE_ERROR: 'Database operation failed. Contact the platform administrator.',
        INVALID_ACTION: 'This state transition is not permitted.',
        EDIT_CONFLICT: 'This record was modified concurrently; refresh and verify latest state.',
        CATEGORY_UNAVAILABLE: 'Selected category is missing or disabled for new releases.',
        PACKAGE_IN_USE: 'A published package depends on this release.',
        PACKAGE_DELETED: 'This package has been soft-deleted and cannot be edited.',
        CONFIRMATION_REQUIRED: 'Confirmation slug did not match the target package.',
        DESTINATION_CONFLICT: 'Extraction paths overlap with another step destination.',
        VERSION_MUST_INCREASE: 'New version must be strictly higher than prior releases.',
        DRAFT_REQUIRED: 'Only saved drafts can be published.',
        INSTALL_PLAN_LIMIT: 'Maximum 30 transitive packages allowed per install plan.',
        ARTIFACT_SIZE_LIMIT: 'Combined artifact size exceeds the 100 GB package limit.',
        ROLE_NAME_EXISTS: 'A role with this name already exists.',
        NOT_FOUND: 'Requested item was not found; refresh the view.',
        NETWORK_ERROR: 'Connection failed; check your network and retry.',
        SAVE_AS_DRAFT: 'Save changes as a draft first.',
      }
    : {
        ACTIVATION_DENIED:
          'فعال‌سازی ممکن نشد؛ اعتبار کد یا اتصال آن به دستگاه دیگری را بررسی کنید.',
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
        DATABASE_ERROR:
          'ارتباط با پایگاه داده یا اجرای عملیات ناموفق بود. با مدیر سیستم تماس بگیرید.',
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

export const telemetryErrorLabels = (lang = getLang()): Record<string, string> =>
  lang === 'en'
    ? {
        HASH_MISMATCH: 'File SHA-256 did not match published manifest',
        DISK_FULL: 'Insufficient disk space',
        ARCHIVE_PASSWORD_OR_CORRUPT: 'Wrong archive password or unsupported/corrupt archive',
        DOWNLOAD_FAILED: 'Download transfer failed',
        INSTALL_FAILED: 'Transactional installer did not complete',
        RECOVERY_REQUIRED: 'Interrupted install requires recovery verification',
      }
    : {
        HASH_MISMATCH: 'هش فایل با نسخه منتشرشده مطابقت ندارد',
        DISK_FULL: 'فضای خالی کافی نیست',
        ARCHIVE_PASSWORD_OR_CORRUPT: 'رمز آرشیو نادرست است یا فایل خراب/پشتیبانی‌نشده است',
        DOWNLOAD_FAILED: 'ارتباط دانلود یا دریافت فایل ناموفق بود',
        INSTALL_FAILED: 'موتور نصب عملیات را کامل نکرد',
        RECOVERY_REQUIRED: 'نصب به بررسی و بازیابی نیاز دارد',
      };
