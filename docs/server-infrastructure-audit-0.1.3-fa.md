# Server & Infrastructure Audit — UHM 0.1.3

زمان بررسی: 2026-11-08 UTC. پروژهٔ Supabase: `ewjvnqlqacljflvjbpbv`.

## وضعیت سرویسها

هر هشت سرویس auth، db، db_postgres_user، pooler، realtime، rest، storage و pg_bouncer در `ACTIVE_HEALTHY` هستند. Realtime در health داخلی `db_connected:false` و بدون cluster متصل گزارش می‌دهد؛ برنامه از realtime برای مسیر حیاتی لایسنس استفاده نمی‌کند، اما این وضعیت باید در مانیتورینگ جداگانه دنبال شود.

## Edge Functions

- `api`: نسخهٔ 12، ACTIVE، `verify_jwt:false`؛ کنترل دسترسی داخل تابع انجام می‌شود.
- `update-key-broker`: نسخهٔ 3، ACTIVE، `verify_jwt:false`؛ فقط OIDC معتبر گیت‌هاب بامخزن/owner/ref/workflow/build سبز را می‌پذیرد.
- باندلهای محلی مستقرشده: API `c7f8141a988caf4760e3cf3963ed48f49c0be25274904a478b79a3e9781a7f5a` (40928 بایت)، broker `d8fd4ba70ee855e9af4c0f17bfad224cd5c3baaabf607008f63adf356114352c` (4080 بایت). وابستگیها pinned: zod 4.6.7، jose 6.2.14، supabase-js 2.118.0.
- آزمون زندهٔ CI `42507833091` نسخه/کلید/issuer، CORS، کاتالوگ، رد ناشناس و رد broker را تأیید کرد.

## پایگاه داده

هفت migration موجود بدون تغییر: `202611010001`, `202611010002`, `202611020003`, `20261102201702`, `20261104085627`, `20261104085636`, `20261104085700`. هیچ migration برای 0.1.3 لازم/اعمال نشد.

شمارش پس از استقرار: licenses=6، packages=2، package_releases=0، admin_access=5، service_settings=0. ساختار: 16 جدول RLS، 27 ایندکس، 9 FK، 2 trigger. یک job پاک‌سازی UHM وجود دارد و آخرین اجرای آن succeeded است.

## احراز هویت و دسترسی

ثبتنام عمومی ایمیل خاموش و TOTP فعال است؛ SMTP سفارشی تأیید نشده است. دسترسی مستقیم ناشناس به licenses و جداول محتوای/نقشها در آزمون زنده رد شد. مسیرهای ادمین بدون توکن 401 می‌دهند. secretهای سرویس فقط در لبه خوانده می‌شوند.

## انتشار و زنجیرهٔ اعتماد

کلید عمومی لایسنس و issuer تغییر نکردند. کلید خصوصی به‌روزرسانی در secret ابری است و broker آن را تنها به job واجد شرایط می‌دهد. نصب‌کنندهٔ 0.1.3 با امضای minisign/version binding منتشر شد. feed اختصاصی prerelease است و جایگزین Latest قدیمی `v1.0.0` نشده است.

## Rollback و نگهداری

کد مورد انتظار پیش از استقرار در `deployment/rollback/uhm-0.1.2/` موجود است. rollback داده‌ای انجام نشود. برای پایش، همین آزمون غیرمخرب پس از هر استقرار اجرا شود. محدودیت دسترسی sandbox به storage گیت‌هاب باعث شد artifact نتیجهٔ smoke مستقیماً دانلود نشود؛ خود job ویندوز با تمام assertionها SUCCESS است.

## ریسکها و توصیه‌ها

مانیتورینگ Realtime، آزمون بار/ظرفیت، تأیید روی ماشین کاربر واقعی، Authenticode در صورت نیاز، و بررسی مالک برای پیش‌نویسهای بدون فایل باقی می‌ماند. هیچ secret، لایسنس یا محتوای تولیدی در این ممیزی تغییر داده نشد.
