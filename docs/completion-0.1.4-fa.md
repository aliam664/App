# گزارش تکمیل UHM Launcher 0.1.4

تاریخ گزارش: 2026-11-12 (UTC). شاخهٔ کاری: `arena/0274db12-app`. منبع ساخت/انتشار: `a62aada3793c0bcc74d4aaf0585ac0f84c5ff745`.

## ۱. خلاصهٔ اجرایی

نسخهٔ `0.1.4` شامل بازطراحی رابط لانچر و پنل مدیریت، دو-زبانه شدن فارسی/انگلیسی، بخش مدیریت‌پذیر «ارتباط با ما» (`uhm.contact_settings` و `/contact` + `/admin/contact`)، و رفع خطای نسخه در اسکریپت‌های تست دود ویندوز در Supabase مستقر، در CI کامل ویندوز/وب تأیید، و به‌صورت prerelease امضاشده (`uhm-launcher-v0.1.4`) همراه با به‌روزرسانی فید `uhm-launcher-updates` منتشر شد. آزمون ارتقای خودکار واقعی از نصب‌کنندهٔ عمومی `0.1.2` به `0.1.4` روی ویندوز با موفقیت کامل انجام شد و تمام داده‌های تولیدی، لایسنس‌ها، اتصال دستگاه‌ها و کلیدهای امضا بدون کوچک‌ترین تغییر حفظ شدند.

## ۲. استقرار سرور و Rollback

- بستهٔ بازگشت قبل از استقرار از `origin/main` (`d17ef10`) در `deployment/rollback/uhm-0.1.3/` ذخیره شد (`api.js` با SHA-256 `c7f8141a988caf4760e3cf3963ed48f49c0be25274904a478b79a3e9781a7f5a` و `update-key-broker.js` با SHA-256 `d8fd4ba70ee855e9af4c0f17bfad224cd5c3baaabf607008f63adf356114352c`).
- پروژهٔ Supabase `ewjvnqlqacljflvjbpbv`:
  - `update-key-broker` به نسخهٔ **6** (`ACTIVE`, `verify_jwt: false`) ارتقا یافت و متن بازخوانی‌شده بایت‌به‌بایت با `deployment/edge/update-key-broker.js` (`4,080` بایت، SHA-256 `8b47eda9df4e86f65b96afc0d99566c6f609cbbba3dfea3bc9bb7de22d023c55`) تطبیق داده شد.
  - `api` به نسخهٔ **13** (`ACTIVE`, `verify_jwt: false`, `46,487` بایت، SHA-256 محلی `acfb55905df1d7e6b921d363a3e47a505b58da6f7b787be55c860b71d53fd9c0`) ارتقا یافت.
  - مهاجرت هشتم `20261112101846_contact_settings.sql` از پیش اعمال‌شده و منطبق با فایل مخزن است (RLS فعال، دسترسی محدود به `service_role`).
  - شمارش داده‌های تولیدی قبل و بعد از استقرار و انتشار یکسان است: `6` لایسنس (`2` فعال، `5` دستگاه متصل)، `2` بسته، `0` انتشار بسته، `4` دسته‌بندی، `35` رویداد تله‌متری، `47` رویداد ممیزی، `0` رکورد `contact_settings`، و `14` سکرت سرور دست‌نخورده.

## ۳. شواهد CI، امضا و آزمون ارتقای ویندوز

- **Platform checks** (`43217722448` روی `a62aada`): **SUCCESS** (`web-and-api` + `windows-native` شامل 235 تست، Playwright، تست‌های Rust، clippy، زنجیرهٔ PostgreSQL واقعی، `cargo audit`، ساخت NSIS و نصب تازه + ارتقا از `0.1.2`).
- **Non-destructive production verification** (`43217722524`): **SUCCESS** (تأیید زندهٔ `/health` نسخهٔ `0.1.4`، `/catalog`، `/contact`، رد ناشناس `/admin/overview` و `/admin/contact`، CORS، RLS روی تمام جداول از جمله `contact_settings` و رد broker بدون مجوز).
- **Security and package permission audit** (`43217722452`): **SUCCESS**.
- **Publish shared app UI to GitHub Pages** (`43217725482`): **SUCCESS** (ساخت و تست کامل `dist-pages`).
- **Sign verified launcher candidate** (`43218849299` روی `b2ed10b`): **SUCCESS** — انتشار تگ `uhm-launcher-v0.1.4` (`UHM-Launcher-0.1.4-x64-setup.exe`، `5,068,402` بایت، SHA-256 `7a9702580113feb705e6711d2c884b39cb60e7867ae7b18ed8d0c7bcfaf78a2c`) و به‌روزرسانی فید `uhm-launcher-updates` (`latest.json`، SHA-256 `8361f1b2012cbb3ccc161097b79bc0871617dc0a3c1e0bd50643137c7984f1fa`).
- **Real Windows automatic-update smoke** (`43219122785` روی `837837d`): **SUCCESS** — نصب واقعی `0.1.2`، دانلود و تأیید امضای `0.1.4` از فید زنده، رد کش دست‌کاری‌شده/بریده با بازیابی آفلاین، تعویق هنگام فعال بودن `acs.exe`، ارتقای خودکار در اجرای بعدی به `0.1.4`، راه‌اندازی مجدد خودکار و حفظ تنظیمات و فایل‌های بازی.

## ۴. ریشه‌یابی و رفع موارد بررسی‌شده

1. **علت شکست تست دود نصب ویندوز نسخهٔ 0.1.3 (`43201107637`):** در کامیت `9b748d0`، فایل `.github/workflows/windows-update-smoke.yml` اسکریپت `../scripts/windows-update-smoke.ps1` را از `HEAD` بیرونی (که مقدار `0.1.4` در خط ۳۰ آن هاردکد شده بود) به جای `./scripts/windows-update-smoke.ps1` داخل `tested-source` اجرا کرد و ظرف ۱ ثانیه متوقف شد. مسیر فراخوانی در workflow اصلاح شد و هر دو اسکریپت `windows-update-smoke.ps1` و `windows-installer-upgrade.ps1` نسخهٔ مورد انتظار را پویا از `src-tauri/tauri.conf.json` می‌خوانند.
2. **علت ماندن GitHub Pages روی شاخهٔ قدیمی:** تنظیمات مخزن (`GET /repos/aliam664/App/pages`) روی `build_type: "legacy"` و شاخهٔ `arena/37af8e92-app` (آخرین ساخت `1340271066` در `2026-11-04`) قرار دارد و توکن یکپارچه‌سازی GitHub برای `PUT /repos/aliam664/App/pages` خطای `HTTP 403` دریافت می‌کند. تغییر یک‌بارهٔ **Settings → Pages → Source** به **GitHub Actions** (یا شاخهٔ `main` پس از ادغام PR) انتشار عمومی رابط جدید را فعال می‌کند.
