# سایت زنده و سورس مشترک برنامه

سایت **https://aliam664.github.io/App/** و پنل **https://aliam664.github.io/App/#/admin** اکنون به API واقعی UHM متصل‌اند؛ ورود نمایشی عمومی ندارند. برای شروع، [راهنمای عملیات](operations-fa.md) را بخوانید.

## یک UI، دو مقصد اجرا

`index.html` ریشه، همان `apps/web/src/main.ts` و CSS/کامپوننت‌ها را برای مرورگر و Tauri build می‌کند. طراحی دوم وجود ندارد. GitHub Pages فقط UI را سرو می‌کند؛ API در Supabase و نصب واقعی بازی فقط در Windows اجرا می‌شوند.

| مقصد | فرمان | خروجی |
| --- | --- | --- |
| توسعه با API و داده محلی | `npm run dev` | توسعه محلی |
| UI production معمولی/دسکتاپ | `npm run build` | `dist/` |
| سایت متصل برای Pages Actions | `npm run build:live-pages` | `dist-pages/` |
| fallback متصل روی شاخه | `npm run build:live-branch` | `pages-preview/` |
| sandbox برای آزمون بدون backend | `npm run build:pages` و `npm run build:branch` | همان مسیرهای build، ولی mode نمایشی |

نام `pages-preview` تاریخی است؛ خروجی منتشرشده اکنون `connected-production` است. خود فرمان‌های sandbox عمداً تغییر معنا نداده‌اند تا تستِ بدون سرور معتبر بماند. کدهای sandbox در سرور واقعی اعتبار ندارند.

## صفحه سفید و تنظیم فعلی

تنظیم فعلی Pages در مخزن (`GET /repos/aliam664/App/pages`) روی `build_type: "legacy"` و شاخهٔ قدیمی `arena/37af8e92-app` (`/`) مانده است (آخرین ساخت ثبت‌شده: `1340271066` روی کامیت `2a5ce138` در تاریخ `2026-11-04`)؛ به همین دلیل سایت عمومی هنوز نسخهٔ قبلی را نشان می‌دهد و توکن یکپارچه‌سازی GitHub اجازهٔ تغییر مستقیم `PUT /repos/aliam664/App/pages` را ندارد (`HTTP 403 Resource not accessible by integration`).

برای انتشار دائمی نسخهٔ جدید (`0.1.4` و نسخه‌های بعدی) بدون وابستگی به نام شاخه‌های موقت، مالک مخزن کافی است یک‌بار در **Settings → Pages → Build and deployment → Source** گزینهٔ **GitHub Actions** را انتخاب کند؛ workflow آمادهٔ `.github/workflows/pages.yml` در هر push به `main` (و همچنین اجرای دستی `workflow_dispatch`) خروجی `dist-pages/` (`connected-production`) را مستقیماً منتشر می‌کند. (در صورت تمایل به حفظ حالت `Deploy from a branch`، پس از ادغام PR در `main`، تغییر شاخهٔ Pages به `main` و مسیر `/` نیز از طریق redirect به `pages-preview/` کار می‌کند.)

خروجی generated را دستی ویرایش نکنید. `build-info.json` mode، revision و ورودی مشترک را ثبت می‌کند. برای legacy آن را در `/App/pages-preview/build-info.json` بخوانید؛ برای Actions در `/App/build-info.json`. نمایش تغییر پس از push، پایان workflow و build/CDN است، نه هم‌زمان با تایپ.

## مسیر و امنیت

- پنل hash route دارد؛ refresh/redirect مسیر را حفظ می‌کند.
- `assetUrl` و base Vite تصاویر، فونت‌ها و JS را به مسیر درست اشاره می‌دهند.
- در Actions، `404.html` از index همان build و `.nojekyll` ساخته می‌شود.
- GitHub Pages `_headers` و `_redirects` را به‌عنوان تنظیم سرور اجرا نمی‌کند؛ کنترل اصلی داده در API است.
- هیچ service-role، private JWK، pepper یا کد مالک در سایت/متغیرهای Vite قرار نمی‌گیرد.
- کلید مرورگر و کلید Windows یکی نیستند؛ برای استفاده در هر دو محیط مستقل، دو لایسنس مدیریتی صادر کنید.
