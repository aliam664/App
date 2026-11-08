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

تنظیم موجود Pages روی legacy source از ریشه همین شاخه است. ریشه TypeScript کامپایل‌نشده را به مرورگر نمی‌دهد؛ redirect به خروجی کامپایل‌شده `pages-preview/`، hash پنل را حفظ می‌کند. فونت‌ها، تصویر و ویدیو از `public/` مشترک خوانده می‌شوند. `.nojekyll` فعال است. تغییر دستی Settings برای مشاهده سایت لازم نیست. مجوز اتصال برای تغییر نوع Pages کافی نبود؛ تنظیم قبلی حفظ و مسیر انتشار موجود تعمیر شد. `/Uhm/` تغییر نکرد.

با push به شاخه فعال، workflow «Refresh compiled branch preview» ابتدا sandbox را build و چهار تست استاتیک را اجرا می‌کند، سپس `build:live-branch` را می‌سازد و generatedها را با bot روی **همان شاخه** ثبت می‌کند. درخواست legacy build داده می‌شود. workflow اصلی نیز پس از تست، `build:live-pages` می‌سازد؛ اگر بعدها Pages رسماً روی Actions تنظیم شود، همان artifact را deploy می‌کند.

خروجی generated را دستی ویرایش نکنید. `build-info.json` mode، revision و ورودی مشترک را ثبت می‌کند. برای legacy آن را در `/App/pages-preview/build-info.json` بخوانید؛ برای Actions در `/App/build-info.json`. نمایش تغییر پس از push، پایان workflow و build/CDN است، نه هم‌زمان با تایپ.

## مسیر و امنیت

- پنل hash route دارد؛ refresh/redirect مسیر را حفظ می‌کند.
- `assetUrl` و base Vite تصاویر، فونت‌ها و JS را به مسیر درست اشاره می‌دهند.
- در Actions، `404.html` از index همان build و `.nojekyll` ساخته می‌شود.
- GitHub Pages `_headers` و `_redirects` را به‌عنوان تنظیم سرور اجرا نمی‌کند؛ کنترل اصلی داده در API است.
- هیچ service-role، private JWK، pepper یا کد مالک در سایت/متغیرهای Vite قرار نمی‌گیرد.
- کلید مرورگر و کلید Windows یکی نیستند؛ برای استفاده در هر دو محیط مستقل، دو لایسنس مدیریتی صادر کنید.
