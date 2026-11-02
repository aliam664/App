# استقرار عملیاتی UHM

راهنمای کاربر: [operations-fa.md](operations-fa.md) • وضعیت/شواهد: [production-status.md](production-status.md).

## مقصد واقعی

در ۲۰۲۶-۱۱-۰۲ پروژه مستقل **UHM Launcher** با گزینه free ساخته شد:
`ewjvnqlqacljflvjbpbv`، منطقه `us-east-1`.

API: `https://ewjvnqlqacljflvjbpbv.supabase.co/functions/v1/api`

سه migration موجود در `supabase/migrations` واقعاً اجرا و history با نسخه فایل‌ها تطبیق داده شد. RLS و grants هر ۱۱ جدول، دسترسی مستقیم anon/authenticated را بسته‌اند. schema `uhm` فقط از طریق API با service-role قابل استفاده است. ثبت‌نام عمومی Auth بسته است. مالک اول مستقیماً لایسنس‌محور ایجاد شد؛ حساب Auth/MFA کاربر جعلی نساختیم.

تنظیمات فقط ابری و job ساعتی در `supabase/operations/production.sql` مستندند؛ آن فایل migration قابل اجرای PGlite نیست. Cron صرفاً ephemeralها را پاک می‌کند.

## secrets سرور

- `LICENSE_SIGNING_JWK_B64` و `LICENSE_PUBLIC_JWK_B64`: JSON کلید EC P-256 با base64 معمولی؛ base64 رمزگذاری امنیتی نیست. اتصال cloud مقدار JSON خام را نپذیرفت، بنابراین انتقال base64 انجام شد. ورودی JSON خام با نام‌های بدون `_B64` نیز برای CLI پشتیبانی می‌شود.
- `LICENSE_PEPPER`، `LICENSE_KEY_ID` و `LICENSE_ISSUER` ثابت نگه داشته شوند.
- `ALLOWED_ORIGINS`: `https://aliam664.github.io,http://tauri.localhost,https://tauri.localhost,tauri://localhost`؛ wildcard ندارد.
- `SUPABASE_URL` و `SUPABASE_SERVICE_ROLE_KEY`: متغیرهای استاندارد سرور Supabase.

**secretها را ترتیبی تغییر دهید و در انتها نام‌ها/هش‌ها را تطبیق دهید.** هنگام commissioning، نوشتن هم‌زمان چند درخواست secret باعث از دست‌رفتن یک مقدار شد؛ بازبینی metadata و راه‌اندازی مجدد آن را رفع کرد. مقدار خصوصی/pepper/service-role/database password/کد مالک نباید در Git، issue، `VITE_*` یا public vars باشد.

## deploy مجدد API

مسیر استاندارد با CLI رسمی و احراز هویت اپراتور:

```sh
npm ci
npm run check
supabase link --project-ref ewjvnqlqacljflvjbpbv
supabase db push
supabase functions deploy api --no-verify-jwt
```

`verify_jwt=false` برای درخواست نخست بدون حساب ضروری است. خود API اثبات دستگاه و JWT مدیریتی را کنترل می‌کند؛ آن را حذف authorization تلقی نکنید.

در این راه‌اندازی اتصال cloud فقط body یک فایل را می‌پذیرفت و import مستقیم فایل GitHub با BOOT_ERROR اجرا نشد. راه صحیحِ استفاده‌شده:

```sh
npm run build:edge
```

فایل **`deployment/edge/api.js`** همه ماژول‌های خود برنامه را یکجا دارد و سه وابستگی را با `npm:` و نسخه دقیق import می‌کند. محتوای کامل همین فایل در body تابع `api` deploy شده است؛ هیچ دانلود/eval از شاخه متحرک در startup نداریم. `cloud-integrity.json` هش و نسخه‌ها را نگه می‌دارد. `runtime.js` یک bundle کامل برای بازتولید محلی است، نه فایل مستقر فعلی. فایل‌های خروجی را دستی ویرایش نکنید.

برای به‌روزرسانی با connector، نسخه جدید API را فقط پس از تست و بررسی diff به همان project و slug بفرستید؛ body فایل `api.js`، نه مسیر فایل. push سورس، جای deploy API را نمی‌گیرد. پس از deploy، health، CORS، کاتالوگ و عملیات با لایسنس آزمایشی جدا بررسی شوند؛ کد اصلی مالک برای تست استفاده نشود. تست طولانی HTTP را در background مورد اعتماد با `EdgeRuntime.waitUntil` و ذخیره نتیجه اجرا کنید تا timeout ابزار مشاهده با شکست API اشتباه نشود. تابع و secrets موقت را بعد از تست حذف و لایسنس تست را revoke کنید.

## وب و Windows

تمام مقادیر عمومی و public JWK متناظر در `config/production-public.json` هستند. `d` خصوصی ندارد. اتصال GitHub مجوز نوشتن Actions variables/secrets را نداشت (403)؛ هیچ دورزدن احراز هویت یا انتشار secret انجام نشد. workflow متغیرهای **عمومی** را از همین فایل به محیط build می‌برد.

- `npm run build`: UI production در `dist`؛ اتصال واقعی.
- `npm run build:live-pages`: سایت واقعی در `dist-pages`، base `/App/`.
- `npm run build:live-branch`: fallback واقعی در `pages-preview`، assets مشترک `public`.
- `npm run build:pages` و `build:branch`: sandbox جدا برای آزمون، نه build مورد انتشار نهایی.
- `npm run desktop:build:production`: installer با public trust نسخه‌ثبت‌شده؛ به Windows/Rust/ابزار استخراج آماده‌شده نیاز دارد.

workflowهای Pages اول sandbox را تست و سپس build متصل را منتشر می‌کنند. Pages فعلی legacy branch است و redirect ریشه به fallback کامپایل‌شده، hash مسیر admin را حفظ می‌کند. `build-info.json` mode/source/revision را ثبت می‌کند. فایل `_headers` توسط GitHub Pages اجرا نمی‌شود؛ موتور Native CSP خودش را دارد و تغییر دامنه باید در CORS/CSP بررسی شود.

نسخه Windows unsigned است؛ signing/updater امضاشده و تست نصب در محیط واقعی بازی هنوز gate انتشار تجاری‌اند. [راهنمای عملیات](operations-fa.md) موارد backup/restore، ظرفیت، retention و recovery را توضیح می‌دهد.
