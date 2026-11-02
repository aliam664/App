# آپدیت امضاشده و بدون تنظیم دستی کلید توسط مالک

## تصمیم و وضعیت واقعی

کاربر سیاست «دریافت خودکار پس‌زمینه، بررسی امضا و نصب هنگام خروج یا اجرای بعدی در زمان امن» را تأیید کرد و سپس صریحاً خواست هیچ مرحله ثبت/انتقال کلیدی به او واگذار نشود. کد فعال‌سازی مالک و کلید P-256 لایسنس تغییر نکرده‌اند.

کلید مستقل updater تولید و با ابزار مدیریت مجاز، در Secret اختصاصی `UHM_UPDATER_SIGNING_PRIVATE_KEY` همان پروژه UHM نگهداری شد. کلید خصوصی در Git، manifest، Windows binary، artifact یا این سند نیست. فقط کلید عمومی در `config/updater-public.json` و config Tauri قرار دارد. بکاپ خصوصی محلی اختیاری است؛ ادامه کار دیگر به دانلود آن یا تنظیم GitHub Secrets توسط مالک وابسته نیست.

GitHub integration مجوز Secrets ندارد (۴۰۳). به‌جای درج کلید در کد، `update-key-broker` روی Supabase مستقر شد. این endpoint، JWT واقعی GitHub OIDC را با JWKS رسمی بررسی می‌کند و فقط job مجاز انتشار را می‌پذیرد:

- issuer و audience ثابت؛ RS256؛ حداکثر سن token برابر ۱۲۰ ثانیه؛
- repository ID واقعی `1363261683` و نام دقیق `aliam664/App`؛
- branch و subject دقیق همین session، workflow مشخص `release-launcher.yml` و runner میزبان GitHub؛
- فقط رویداد push مورداعتماد یا workflow_dispatch، نه pull request/fork؛
- build موفق Platform checks از همین branch؛ هر تغییر اجرایی/CI پس از build باعث رد می‌شود. فقط docs، خروجی Pages و فایل درخواست داده‌ای انتشار مجازند؛
- پاسخ no-store و بدون CORS/لاگ کلید؛ کلید فقط در فایل موقت با دسترسی محدود job نوشته، در لاگ mask و پس از کار حذف می‌شود.

دسترسی به credential مثل Secrets معمول CI به اعتماد به کد workflow و مدیران مخزن وابسته است. مهار تکرار token در حافظه instance، best-effort است، نه تضمین سراسری ضد replay. Secrets در این پلن Supabase project-wide هستند؛ کلیدهای جدا به معنی ایزولاسیون کامل runtime توابع همان پروژه نیستند. سرویس پولی یا پروژه جدید ایجاد نشده است.

## Native و رابط واقعی

- plugin رسمی `tauri-plugin-updater` با نسخه pin‌شده، `requireSignedVersion=true` و `allowDowngrades=false`؛
- دریافت خودکار در شروع و هر شش ساعت؛ اتصال HTTPS به feed انتشار و artifact دقیق همین repository/version؛
- دریافت chunked با سقف ۱۲۸ MiB، کنترل فضا، اندازه، redirect محدود و بررسی امضا؛
- cache ماندگار metadata/installer و اعتبارسنجی مجدد آن هنگام شروع و پیش از اجرای NSIS؛
- نصب در خروج یا اجرای بعدی، نه قطع ناگهانی برنامه در زمان استفاده؛
- قفل مشترک lifecycle که تمام نصب و recovery را پوشش می‌دهد؛ quarantine/restore نیز با خروج updater هماهنگ‌اند؛
- بررسی فرایندهای واقعی Assetto Corsa؛ شکست بررسی فرایندها باعث تعویق نصب می‌شود، نه فرض بسته‌بودن بازی؛
- جلوگیری از چند instance لانچر، برای جلوگیری از بستن instance دیگر وسط نصب؛
- پنل واقعی وضعیت آپدیت در تنظیمات دسکتاپ و پیام روشن هنگام ممانعت از بستن حین عملیات؛ هیچ updater نمایشی در مرورگر اضافه نشده است.

فقط نصب‌کننده شناخته‌شده‌ای که با کلید updater معتبر و برای همان نسخه امضا شده اجرا می‌شود. سیاست «عدم اجرای EXE ناشناس پکیج» حفظ شده است؛ پیام‌های نصب پکیج به EXE مود مربوط‌اند، نه installer امضاشده خود لانچر.

## انتشار و آزمون

Workflow `release-launcher.yml` artifact ویندوزِ build سبز را دریافت، provenance را کنترل، با مجوز کوتاه‌عمر OIDC، کلید را موقتاً در runner دریافت و فایل واقعی EXE را امضا می‌کند. سپس امضا، کلید و نسخه امضاشده با Node Ed25519/BLAKE2b دوباره بررسی و `latest.json` و SHA256 ساخته می‌شوند. فعلاً خروجی candidate است؛ انتشار عمومی نهایی و جابه‌جایی latest تا عبور gateهای واقعی پروژه انجام نمی‌شود.

تست‌های Node با fixture امضاشده واقعی، تغییر bytes، کلید اشتباه، تغییر نسخه manifest و دست‌کاری trusted comment را رد می‌کنند. تست Rust از خود plugin رسمی با MockRuntime و فایل/امضای واقعی استفاده می‌کند؛ MockRuntime در این مورد فقط محیط برنامه است و امضای رمزنگاری mock نیست. آزمون نصب/ری‌استارت روی runner واقعی ویندوز در 41523753287 موفق شد؛ جزئیات و محدودیت fixture در گزارش آمادگی ثبت شده‌اند. این آزمون جای اجرای بازی واقعی را نمی‌گیرد.

- `npm run check` و مجموعه واحد محلی: ۱۳۰ تست / ۹ فایل موفق؛
- مرورگر: ۱۹ سناریو موفق؛ چهار تست bridge، mock IPC/API هستند؛
- اولین CI کامل updater: [41515645617](https://github.com/aliam664/App/actions/runs/41515645617)، web/API و Windows tests/audit/NSIS موفق؛
- [CI نهایی 41522458902](https://github.com/aliam664/App/actions/runs/41522458902): ۳۱ تست Native، ۱۳۰ تست واحد، ۱۹ سناریوی مرورگر، audit و build موفق؛
- [انتشار 41523341912](https://github.com/aliam664/App/actions/runs/41523341912): smoke زنده، OIDC واقعی، دریافت credential، امضای EXE، انتشار prerelease و دانلود/بررسی دوباره bytes از URL عمومی همگی موفق.

## حجم و محدودیت‌ها

راهبرد size optimization انتشار قدیمی (LTO، opt-level z، strip و یک codegen unit) بازاستفاده شد؛ unwind برای cleanup حفظ شد. ZIP اولین artifact جدید ۱۶٬۴۲۵٬۸۹۶ بایت است؛ این اندازه ZIP artifact است، نه اندازه مستقیم EXE. نتیجه نهایی اندازه پس از build نهایی گزارش می‌شود.

این مسیر **delta updater نیست**: فقط installer لانچر دریافت می‌شود و مودهای نصب‌شده یا فایل‌های حجیم بازی دوباره دانلود نمی‌شوند. plugin استاندارد، patch تفاضلی باینری ایجاد نمی‌کند. امضای updater نیز Authenticode ویندوز نیست؛ گواهی پولی Windows تهیه نشده است.

نسخه‌های قبلی فاقد updater، فرمان آنلاین نصب از راه دور را دریافت نمی‌کنند. یک بار دریافت نسخه مجهز به updater لازم است؛ پس از آن زنجیره آپدیت آنلاین برقرار می‌شود. کاربر اعلام کرده نسخه جدید هنوز به کاربران توزیع نشده است.

تکمیل این بخش به معنی تکمیل باقی specification یا آزمون واقعی بازی/آپلودر نیست. migration پکیج v2 در تولید با نسخه ثبت‌شده `20261102201702` اعمال و سه جدول و ستون‌ها با query تأیید شدند؛ اکنون ۱۴ جدول RLS فعال‌اند. API نیز به نسخه ۱۰ با capability جدید ارتقا داده شد؛ smoke زنده و غیرمخرب در workflow امضای candidate موفق شد. مالک موجود در بررسی read-only، active و bound با activation_count=1 بود؛ این مرحله آن را فعال، reset یا rotate نکرد.

## تکمیل pin وابستگی‌ها و هم‌ترازی migration

CIهای [41517752773](https://github.com/aliam664/App/actions/runs/41517752773) و [41518551631](https://github.com/aliam664/App/actions/runs/41518551631) موفق شدند؛ ۳۱ تست Windows شامل verify واقعی plugin اجرا شد. یک regression مخصوص Windows پیدا و رفع شد: checkout با CRLF، bytes فایل fixture امضاشده را تغییر می‌داد. فایل fixture اکنون `-text` است؛ فایل دست‌کاری‌شده همچنان رد می‌شود و امضا دور زده نشده است.

lock دقیق از artifact بررسی‌شده Windows توسط job مجاز GitHub در همین branch ذخیره شد و CI به `cargo test --locked` برگشت. migration محلی نیز به نسخه واقعی `20261102201702` تغییر نام یافت تا push بعدی آن را دوباره اجرا نکند؛ SQL جدیدی روی تولید برای این تغییر نام اجرا نشده است.

حداقل فضای آزاد مقصد خود لانچر پیش از نصب updater به‌صورت محافظه‌کارانه ۵۱۲ MiB بررسی می‌شود، جدا از ۲۵۶ MiB بودجه کش؛ خطای فضا/امضای نامعتبر با پیام فارسی در پنل وضعیت مشخص می‌شود. این برآورد محافظه‌کارانه است، نه تحلیل قطعی فضای بازشده هر NSIS آینده.


## کاندید واقعی منتشرشده و تفکیک نوع credential

[کاندید 0.1.0](https://github.com/aliam664/App/releases/tag/uhm-launcher-v0.1.0) از source `09ee6a4b52f3c793a6a56cdaba665defb5761daf` منتشر شد. EXE واقعی 16,442,533 بایت و SHA-256 آن `e57d8d3abf17a1bffd34a6d5cdabd360a36c096700d3db600d01299acd1fd9f0` است. فایل `.sig`، checksum و manifest نیز منتشر شده‌اند. Node همان فایل را از URL عمومی دوباره دانلود و امضا/نسخه را verify کرد.

خوراک مستقل: `https://github.com/aliam664/App/releases/download/uhm-launcher-updates/latest.json`. انتشار v1.0.0 همچنان legacy latest است؛ دو release جدید prerelease هستند و latest=false دارند. feed در بررسی GitHub `immutable=false` بود؛ workflow installerهای نسخه‌دار را دوباره جایگزین نمی‌کند و فقط asset JSON خوراک را برای نسخه بعد به‌روزرسانی می‌کند. حذف/آپلود asset هنگام تغییر خوراک ممکن است وقفه کوتاه ایجاد کند؛ retry کلاینت برقرار است، نه تضمین zero downtime.

**خود کلید خصوصی updater بلندمدت است.** چیزی که کوتاه‌عمر است مجوز OIDC و نگهداری موقت آن در runner است، نه اعتبار رمزنگاری کلید. broker سرویس remote-signing نیست؛ private key را فقط به job مورداعتماد می‌دهد. این مدل مانند Secrets معمول CI به کد workflow اعتماد دارد. کلید لایسنس و کد مالک در این مسیر استفاده یا تعویض نمی‌شوند.

گزارش دقیق آزمون Windows و موارد ناتمام: [release-readiness-audit-fa.md](release-readiness-audit-fa.md).
