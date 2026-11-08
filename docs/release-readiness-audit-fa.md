# گزارش آمادگی انتشار و آپدیت مدیریت‌شده — ۲۰۲۶-۱۱-۰۲

این گزارش بین «پیاده‌سازی»، «تست خودکار» و «اعتبارسنجی روی بازی واقعی» تفاوت می‌گذارد. موفقیت build به‌تنهایی تأیید انتشار نهایی تمام specification نیست.

## لایسنس و مدیریت کلید

- لایسنس فعلی مالک، binding دستگاه و کلید P-256 آن عوض نشدند. بررسی اخیر فقط read-only بود: active، bound، activation_count=1. هیچ فعال‌سازی، reset یا صدور کد جایگزین در این مرحله انجام نشد.
- کلید updater مستقل است؛ همان کلید تولیدشده در Secret اختصاصی Supabase نگهداری می‌شود. checksum نسخه سرور با فایل اصلی تطبیق داده شد، بدون چاپ کلید. ثبت دستی GitHub Secret یا انتقال کلید توسط مالک لازم نیست.
- broker فقط JWT امضاشده RS256 از GitHub، audience دقیق، repository/owner ID ثابت، branch و workflow مجاز و build موفق با source همسان را می‌پذیرد. نام مشابه مخزن یا subject دلخواه پذیرفته نمی‌شود.
- تست واقعی یک ناسازگاری کشف کرد: GitHub در این مخزن subject دارای شناسه‌های immutable می‌فرستد. policy با pin کردن owner ID `259944690` و repository ID `1363261683` اصلاح شد؛ تنها دو شکل دقیق legacy/ID-bound مجازند. آزمون واقعی cloud OIDC در [41522458747](https://github.com/aliam664/App/actions/runs/41522458747) گذشت. آن probe عمداً build نامعتبر می‌فرستد و هیچ کلیدی صادر نمی‌کند؛ توقف بعدی source gate در همان run موردانتظار بود.
- فایل موقت کلید CI mask می‌شود، در artifact نیست و cleanup حتی در شکست اجرا می‌شود. دسترسی مدیران مخزن و پروژه همچنان بخشی از مدل اعتماد است؛ replay cache سراسری و ایزولاسیون کامل Secrets میان توابع ادعا نمی‌شود.

## تولید و پایگاه داده

- پروژه موجود UHM/free؛ پروژه دیگر تغییر نکرد. API نسخه ۱۰ و broker نسخه ۲ مستقرند.
- migration واقعی `20261102201702_content_packages` و ۱۴ جدول RLS با query بررسی شدند. فایل محلی با تاریخچه cloud هم‌نام شد؛ تغییر نام باعث اجرای مجدد SQL نشد.
- smoke زنده و غیرمخرب در [41520980017](https://github.com/aliam664/App/actions/runs/41520980017) گذشت: هویت تولید، public trust لایسنس، capability پکیج v2، catalog، رد مدیریت ناشناس، CORS و منع دسترسی مستقیم publishable-key به لایسنس‌ها و سه جدول جدید. GET/POST ناشناس broker نیز رد شدند. شکست بعدی همان run مربوط به subject قدیمی OIDC بود، نه موفقیت کل انتشار.
- هیچ پکیج/مود ساختگی به catalog تولید اضافه نشد. تست خواندن catalog خالی، آزمون نصب مود واقعی محسوب نمی‌شود.

## مسیر updater

- دریافت خودکار پس‌زمینه؛ بررسی bytes، امضا و نسخه امضاشده؛ نصب فقط هنگام خروج امن یا اجرای بعدی. عملیات فعال و فرایند بازی مانع نصب می‌شوند.
- plugin رسمی updater، جلوگیری از downgrade، cache پایدار با بازبینی امضا در شروع و پیش از نصب، single-instance و lifecycle gate مشترک با نصب/بازیابی/quarantine.
- سقف دریافت ۱۲۸ MiB؛ حداقل فضای کش ۲۵۶ MiB و فضای مقصد واقعی نصب ۵۱۲ MiB. این بودجه محافظه‌کارانه است، نه تخمین قطعی NSIS آینده.
- خوراک اختصاصی `releases/download/uhm-launcher-updates/latest.json` از legacy latest جداست. نسخه‌های installer دارای tag مستقل و غیرقابل جایگزینی در workflow هستند؛ فقط manifest خوراک عمداً قابل تغییر است. انتشار candidate با prerelease و latest=false انجام می‌شود.
- تغییر metadata، لینک و نسخه پکیج‌ها از سرور انجام می‌شود و عموماً build لانچر نمی‌خواهد. تغییر خود کد اجرایی، installer امضاشده جدید می‌خواهد.
- این **binary delta** نیست؛ فقط خود لانچر دریافت می‌شود، نه نصب مجدد مودها یا بازی. امضای updater هم **Authenticode** نیست و تأیید SmartScreen ادعا نمی‌شود.
- نسخه‌های قبلی که updater ندارند یک‌بار باید با نسخه مجهز جایگزین شوند. پس از bootstrap، تنظیم کلید یا تأیید جدا برای هر آپدیت لازم نیست.

## شواهد خودکار

- [41519684103](https://github.com/aliam664/App/actions/runs/41519684103): web/API و Windows موفق؛ `cargo test --locked`، ۳۱ تست Native، cargo audit، NSIS واقعی، ۱۲۷ تست واحد و ۱۹ سناریوی مرورگر. بعضی سناریوهای مرورگر bridge را mock می‌کنند و جایگزین GUI ویندوز نیستند.
- محلی پس از اصلاح OIDC: ۱۳۰ تست در ۹ فایل، typecheck/build/format و bundle تکرارپذیر Edge موفق؛ npm audit بدون آسیب‌پذیری گزارش‌شده.
- fixture امضاشده واقعی با plugin رسمی Rust و verifier مستقل Node آزمایش می‌شود؛ bytes دست‌کاری‌شده، کلید/نسخه/trusted-comment نامعتبر رد می‌شوند. CRLF در checkout ویندوز واقعاً کشف و با `-text` برای fixture رفع شد، نه دور زدن امضا.
- Cargo.lock اکنون با LF و artifact native هم‌تراز می‌شود؛ job bot دیگر نباید صرفاً line ending را تغییر دهد.
- زنجیره واقعی credential، امضای installer، انتشار و دانلود مجدد HTTP در 41523341912 موفق شد؛ جزئیات در بخش نتیجه انتشار آمده است.

## آزمایش Windows نصب/آپدیت

`windows-update-smoke.yml` و `windows-update-smoke.ps1` برای runner یک‌بارمصرف اضافه شده‌اند: ساخت fixture نسخه 0.0.0 از source دقیق کاندید، نصب واقعی NSIS، دریافت آپدیت عمومی، بستن پنجره واقعی، تعویق با فرایند کنترل‌شده‌ای به نام acs.exe، نصب cache در اجرای بعدی، restart و بررسی حفظ settings و فایل محتوای آزمایشی. این فرایند acs.exe، کپی cmd.exe سیستم برای تست است، **بازی واقعی نیست**. این زنجیره در run 41523753287 واقعاً موفق شد. هیچ لایسنس مالک در این تست استفاده نمی‌شود.

## وضعیت scope گسترده‌تر

سیستم فعلی مسیر واقعی license/device/offline events، catalog/admin، پکیج v2، دانلود و cache/Range/hash، preview/install journal/backup/recovery، استخراج محدود ZIP/RAR/7z با ابزار pin‌شده، scanner و quarantine را دارد. UI و معماری Tauri/Rust موجود حفظ شده‌اند. انتشار قدیمی v1.0.0 نیز واقعاً Tauri/Rust بود، نه Electron؛ منطق سالم تشخیص metadata و بهینه‌سازی اندازه بازاستفاده شد، نه کپی بدون قید امنیتیِ فرمان‌های فایل قدیمی.

موارد زیر هنوز مانع ادعای تکمیل کل specification/انتشار تجاری‌اند:

1. آزمون واقعی بازی، Content Manager، میزبان‌های فایل و آرشیوهای واقعی کاربر، مجوز/AV و سناریوهای خرابی/کمبود فضا روی PC واقعی.
2. تکمیل مدیریت حذف layout، اندازه‌ها و مسیرها/rename wizard، retention و uninstall کامل dependency graph؛ quarantine موجود معادل آن سیستم کامل نیست.
3. recovery اجباری کامل در startup، virtualization کتابخانه بزرگ و مهار هم‌زمانی تصاویر. ownership/وجود فایل معادل بررسی forensic یا SHA تمام کتابخانه نیست.
4. draft/test package روی مسیر انتخاب‌شده واقعی کار می‌کند؛ sandbox جدا برای test registry وجود ندارد. پیش‌نمایش و رضایت همچنان لازم‌اند.
5. تست update در CI، حتی اگر موفق شود، جای اجرای Assetto Corsa واقعی، انتقال مجوز معتبر و ارزیابی جامع GUI کاربر نیست.
6. backup/restore خارج از سایت، ظرفیت/بار، retention عملیاتی و پایش uptime هنوز باید ارزیابی شوند. Free Supabase محدودیت و امکان pause دارد؛ سرویس نامحدود/همیشه‌روشن وعده داده نمی‌شود.

## فایل‌های اصلی این مرحله

- `src-tauri/src/{updater,lifecycle,installer,quarantine,main}.rs` و config/dependencies/fixtures Native؛
- `apps/web/src/{main,update-status}.ts`؛
- `backend/src/update-key-broker.ts` و function/bundle متناظر؛
- `.github/workflows/{quality,branch-preview,release-launcher,windows-update-smoke}.yml`؛
- `scripts/{request-update-key,update-signature,verify-update-artifact,check-live-public,check-release-feed}.ts` و `windows-update-smoke.ps1`؛
- migration canonical و تست‌های database/contracts/broker/signature؛
- `.gitattributes`، README و گزارش‌های production/implementation/updater.

فهرست دقیق diff نسبت به base این branch از `git diff --name-status 82e0abbbc94c00ab1e1604fd47050beb7ab44cdc HEAD` قابل استخراج است؛ این baseline کل کار این branch را شامل می‌شود، نه فقط چند تغییر updater آخر.

## نتیجه انتشار

- [CI 41522458902](https://github.com/aliam664/App/actions/runs/41522458902) موفق: source `09ee6a4b52f3c793a6a56cdaba665defb5761daf`، ۱۳۰ تست واحد، ۳۱ Native و ۱۹ مرورگر؛ audits/build موفق.
- [انتشار 41523341912](https://github.com/aliam664/App/actions/runs/41523341912) موفق: smoke غیرمخرب تولید، probe و درخواست واقعی OIDC، دریافت همان کلید مستقل، امضای version-bound، verifier مستقل، انتشار و دانلود دوباره کامل از feed عمومی.
- [release کاندید 0.1.0](https://github.com/aliam664/App/releases/tag/uhm-launcher-v0.1.0) prerelease است، نه انتشار نهایی. EXE: **16,442,533 bytes**. SHA-256: `e57d8d3abf17a1bffd34a6d5cdabd360a36c096700d3db600d01299acd1fd9f0`.
- feed مستقل و واقعی منتشر شد. GitHub برای feed، immutable=false گزارش کرد؛ legacy latest همچنان v1.0.0 ماند.
- کلید خصوصی updater بلندمدت است؛ فقط مجوز OIDC و عمر فایل runner کوتاه‌اند. این broker، remote-signing بدون خروج کلید نیست.
- [آزمون Windows 41523753287](https://github.com/aliam664/App/actions/runs/41523753287) موفق: نصب واقعی 0.0.0 fixture → دانلود واقعی 0.1.0 → تعویق با acs.exe کنترل‌شده → بستن پنجره → نصب خودکار cache در اجرای بعدی → restart → حفظ settings و فایل محتوا. [artifact نتیجه](https://github.com/aliam664/App/actions/runs/41523753287/artifacts/13179501577)، 459 bytes ZIP، SHA-256 `0724fd2e18ac022abe6071a601778d8cae419ab050d929423983fef4b552124c`. این سند تأیید نهایی کل specification یا اجرای واقعی Assetto Corsa نیست.


## فهرست دقیق مسیرهای تغییرکرده نسبت به base

این فهرست snapshot پایان همین مرحله است؛ فایل‌های خروجی Pages طبق قرارداد موجود مخزن نگهداری می‌شوند. secret یا installer تولیدی در فهرست نیست.

```text
A	.env.example
A	.gitattributes
A	.github/release-request.json
A	.github/update-smoke-request.json
A	.github/workflows/branch-preview.yml
A	.github/workflows/pages.yml
A	.github/workflows/quality.yml
A	.github/workflows/release-launcher.yml
A	.github/workflows/release-pilot.yml
A	.github/workflows/windows-update-smoke.yml
A	.gitignore
A	.nojekyll
A	.prettierrc.json
M	README.md
A	apps/web/src/admin-console.ts
A	apps/web/src/admin.ts
A	apps/web/src/api.ts
A	apps/web/src/brand-theme.css
A	apps/web/src/device.ts
A	apps/web/src/download-preferences.ts
A	apps/web/src/library-model.ts
A	apps/web/src/license-admin.ts
A	apps/web/src/local-library.ts
A	apps/web/src/main.ts
A	apps/web/src/outbox.ts
A	apps/web/src/reference.css
A	apps/web/src/runtime.ts
A	apps/web/src/static-preview.ts
A	apps/web/src/storage.ts
A	apps/web/src/style.css
A	apps/web/src/ui.ts
A	apps/web/src/update-status.ts
A	backend/dev/server.ts
A	backend/dev/store.ts
A	backend/src/admin-services.ts
A	backend/src/analytics.ts
A	backend/src/api.ts
A	backend/src/crypto.ts
A	backend/src/repository.ts
A	backend/src/seed.ts
A	backend/src/supabase-repository.ts
A	backend/src/update-key-broker.ts
A	config/production-public.json
A	config/updater-public.json
A	deployment/edge/api.js
A	deployment/edge/cloud-integrity.json
A	deployment/edge/commissioning.js
A	deployment/edge/integrity.json
A	deployment/edge/runtime.js
A	deployment/edge/smoke.js
A	deployment/edge/update-key-broker.js
A	docs/admin-console-fa.md
A	docs/architecture-review-fa.md
A	docs/completion-plan-fa.md
A	docs/deployment-fa.md
A	docs/design-notes-fa.md
A	docs/design-reference-fa.md
A	docs/github-pages-fa.md
A	docs/images/admin-analytics.webp
A	docs/images/admin.webp
A	docs/images/launcher.webp
A	docs/images/team-permissions.webp
A	docs/implementation-report-fa.md
A	docs/legacy-v1-review-fa.md
A	docs/operational-risk-review-fa.md
A	docs/operations-fa.md
A	docs/production-status.md
A	docs/release-candidate-notes-fa.md
A	docs/release-pilot-fa.md
A	docs/release-readiness-audit-fa.md
A	docs/security-design-fa.md
A	docs/updater-setup-fa.md
A	index.html
A	package-lock.json
M	package.json
A	packages/contracts/src/index.ts
A	pages-preview/.nojekyll
A	pages-preview/assets/index-4nmjD-m8.js
A	pages-preview/assets/index-Bk1VThvO.css
A	pages-preview/assets/index-CEegXRO6.js
A	pages-preview/build-info.json
A	pages-preview/index.html
A	playwright.config.ts
A	playwright.pages.config.ts
A	public/_headers
A	public/_redirects
A	public/brand/README.md
A	public/brand/fonts/OFL-Outfit.txt
A	public/brand/fonts/OFL-Vazirmatn.txt
A	public/brand/fonts/README.md
A	public/brand/fonts/outfit-latin-variable.woff2
A	public/brand/fonts/vazirmatn-arabic-variable.woff2
A	public/brand/images/2ec1805b-df61-4db6-beed-1c8c08ac0ee5.jpg
A	public/brand/images/696b6a00-90f5-4d43-bc9a-5ee390368cb6.jpg
A	public/brand/images/830c39f4-b1ff-4d2b-94a0-7ea5549e7f28.jpg
A	public/brand/images/c439ae92-1ebe-4683-9f65-8713cf560a28.jpg
A	public/brand/logo.png
A	public/brand/media/uhm-showcase.mp4
A	public/images/01.jpg
A	public/images/02.jpg
A	public/images/03.jpg
A	public/images/04.jpg
A	public/images/05.jpg
A	public/images/06.jpg
A	public/images/07.jpg
A	public/images/08.jpg
A	public/images/09.jpg
A	public/images/logo.jpg
A	scripts/build-edge.ts
A	scripts/check-live-public.ts
A	scripts/check-release-feed.ts
A	scripts/desktop-production.ts
A	scripts/finish-branch.ts
A	scripts/finish-pages.ts
A	scripts/generate-keys.ts
A	scripts/live-smoke.ts
A	scripts/prepare-extractor.ps1
A	scripts/public-ci-env.ts
A	scripts/request-update-key.ts
A	scripts/serve-branch.ts
A	scripts/update-signature.ts
A	scripts/verify-builds.ts
A	scripts/verify-update-artifact.ts
A	scripts/windows-update-smoke.ps1
A	src-tauri/Cargo.lock
A	src-tauri/Cargo.toml
A	src-tauri/build.rs
A	src-tauri/capabilities/main.json
A	src-tauri/icons/icon.ico
A	src-tauri/icons/icon.png
A	src-tauri/resources/extractor/README.md
A	src-tauri/src/content.rs
A	src-tauri/src/content_rules.rs
A	src-tauri/src/discovery.rs
A	src-tauri/src/installer.rs
A	src-tauri/src/jobs.rs
A	src-tauri/src/lifecycle.rs
A	src-tauri/src/main.rs
A	src-tauri/src/quarantine.rs
A	src-tauri/src/security.rs
A	src-tauri/src/updater.rs
A	src-tauri/tauri.conf.json
A	src-tauri/tests/fixtures/COPYING.libarchive.txt
A	src-tauri/tests/fixtures/COPYRIGHT-fixtures.txt
A	src-tauri/tests/fixtures/README.md
A	src-tauri/tests/fixtures/sample.7z
A	src-tauri/tests/fixtures/sample.rar
A	src-tauri/tests/fixtures/updater-payload.txt
A	src-tauri/tests/fixtures/updater-payload.txt.sig
A	src-tauri/tests/fixtures/updater-public.txt
A	supabase/config.toml
A	supabase/functions/api/index.ts
A	supabase/functions/commissioning/index.ts
A	supabase/functions/import_map.json
A	supabase/functions/update-key-broker/index.ts
A	supabase/migrations/202611010001_platform.sql
A	supabase/migrations/202611010002_live_catalog.sql
A	supabase/migrations/202611020003_admin_telemetry.sql
A	supabase/migrations/20261102201702_content_packages.sql
A	supabase/operations/production.sql
A	tests/api.test.ts
A	tests/branch/branch.spec.ts
A	tests/contracts.test.ts
A	tests/database.test.ts
A	tests/e2e/console.spec.ts
A	tests/e2e/native-bridge.spec.ts
A	tests/e2e/platform.spec.ts
A	tests/library.test.ts
A	tests/native-contract.test.ts
A	tests/pages/pages.spec.ts
A	tests/production-config.test.ts
A	tests/runtime.test.ts
A	tests/update-key-broker.test.ts
A	tests/update-signature.test.ts
A	tsconfig.json
A	vite.config.ts
A	vitest.config.ts
```
