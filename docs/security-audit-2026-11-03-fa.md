# ممیزی امنیت سرور، لانچر و موتور پکیج — ۲۰۲۶-۱۱-۰۳

## نتیجهٔ مدیریتی

**این نسخه را «غیرقابل کرک» یا «آمادهٔ بی‌قیدوشرط نصب هر مود» تأیید نمی‌کنم.** مرزهای اصلی امضا، سطح اشتراک و مجوزهای API در سناریوهای آزمایش‌شده برقرارند؛ با این حال ۶ ایراد بازتولیدپذیر و چند ریسک معماری/عملیاتی مشخص شد. بررسی فعلی ممیزی کد، پیکربندی واقعی و تست منفی است؛ نه گواهی امنیت، fuzzing جامع یا تست نفوذ تهاجمی روی تولید.

این مرحله **فقط ممیزی و افزودن تست** است: کد اجرایی backend/Native تغییر نکرد، deploy سرور و انتشار installer جدید انجام نشد، feed عوض نشد و لایسنس/کلید مالک دست‌نخورده ماند. push گزارش می‌تواند workflow معمول Pages را برای بازنشر همان UI اجرا کند. بنابراین یافته‌ها هنوز بازند. سبز بودن job ممیزی، برطرف‌شدن یافته‌های expected-failure نیست.

Source شروع بررسی: `b11b819` در `arena/37af8e92-app`. نسخهٔ نصب‌شدنی 0.1.0 از source `09ee6a4b52f3c793a6a56cdaba665defb5761daf` است؛ تست‌های ممیزی بعدی داخل آن binary نبوده‌اند.

## دامنه و روش

بررسی این مسیرها انجام شد:

- `backend/src/{api,admin-services,crypto,supabase-repository,update-key-broker}.ts` و adapter تولید؛
- `packages/contracts/src/index.ts`؛ نقش‌ها، پکیج، فایل، لینک، گراف و اعتبارسنجی انتشار؛
- Native: `security.rs`، `main.rs`، `installer.rs`، lifecycle، updater و capabilities؛
- پنل `admin.ts`، دستگاه/ذخیره‌سازی/API و پیش‌نمایش نصب؛
- migrationهای RLS/RPC/نسخه‌های immutable، تست‌ها و تنظیمات CI؛
- queryهای **فقط خواندنی** روی پروژه UHM و تنظیمات Auth/توابع فعال. پروژهٔ دیگر بررسی یا تغییر داده نشد.

هیچ flood، تلاش brute-force، نصب آرشیو مخرب، دریافت credential امضا یا فعال‌سازی لایسنس روی تولید انجام نشد. بازتولیدهای مخرب/تغییردهنده فقط با کلید، دستگاه و repository موقت محلی انجام شدند.

## ۱. آیا قابل کرک است؟

### تفکیک لازم

| موضوع | ارزیابی دقیق |
|---|---|
| تغییر ظاهر اپ و بازکردن دکمه‌ها در یک نسخهٔ دست‌کاری‌شده | قابل انجام توسط کسی که binary/محیط دستگاه را کنترل می‌کند؛ تضمین ضدکرک نداریم. |
| جعل grant/plan/admin JWT با تغییر tier/role یا امضای نامعتبر | در تست‌های انجام‌شده پذیرفته نشد. ES256، نوع token، issuer/audience و کلید معتبر لازم‌اند. |
| گرفتن plan جدید بدون اشتراک/دستگاه معتبر | در مسیر آزمایش‌شده رد شد؛ لغو اشتراک حتی با grant منقضی‌نشده، درخواست آنلاین plan را مسدود می‌کند. |
| تبدیل viewer به Owner با گذاشتن role=owner داخل token | نقش و permissions از DB خوانده می‌شوند؛ حتی claims اضافه در token امضاشدهٔ fixture اجازهٔ نوشتن ندادند. |
| یک دستگاه فیزیکی به‌صورت غیرقابل کپی | تضمین نمی‌شود؛ هویت فعلی کلید نرم‌افزاری P-256 با حفاظت DPAPI است، نه کلید TPM/attestation سخت‌افزاری. |
| جلوگیری از کپی مود بعد از دانلود مجاز | وجود ندارد؛ این برنامه کنترل تحویل/نصب است، نه DRM فایل‌های بازی. |

### محدودیت‌های مهم ضدکرک

- `security.rs::device_key/protect` کلید نرم‌افزاری را برای همان کاربر ویندوز با DPAPI ذخیره و برای امضا در حافظه بازیابی می‌کند. این کار کپی سادهٔ blob به PC دیگر را سخت می‌کند، ولی در مقابل کنترل کامل همان حساب/سیستم یا استخراج کلید در حافظه تضمین سخت‌افزاری نیست. سرور کلید را می‌شناسد، نه اثبات مستقل PC فیزیکی را. این **ریسک معماری** است؛ در این ممیزی استخراج کلید یا کلون واقعی روی دو PC انجام نشد.
- هویت مرورگر در IndexedDB (`apps/web/src/device.ts`) با هویت DPAPI دسکتاپ مشترک نیست؛ حتی روی یک PC یکسان، مرورگر دیگر/حساب ویندوز دیگر/دسکتاپ می‌توانند کلید متفاوت داشته باشند. پس مدل موجود دقیقاً «یک کلید ثبت‌شده» است، نه تشخیص قطعی «یک PC». فعال‌سازی اولیه روی وب می‌تواند ورود بعدی همان کد در اپ را به reset/فرایند انتقال نیازمند کند. پذیرش عملی وب→دسکتاپ با لایسنس مالک امتحان نشد و binding آن تغییر نکرد.
- grant آفلاین تا سقف ۱۰ روز معتبر است و refresh پیشنهادی بعد از ۳ روز است (`crypto.ts::grant`). لغو آنلاین فوراً plan جدید را می‌بندد؛ اما اپ آفلاین نمی‌تواند همان لحظه از لغو باخبر شود. تغییر/حذف state ساعت و patch کردن اپ روی دستگاه مهاجم نیز مرز اعتماد محلی را ضعیف می‌کند.
- plan امضاشده، لینک‌ها و رمز لازم برای استخراج را به کاربر مجاز می‌دهد؛ دانلودر باید آن‌ها را ببیند. رمز آرشیو ماسک‌شده در UI به معنی مخفی‌ماندن دائمی آن از همان کاربر نیست. لینک عمومی/طولانی‌عمر آپلودر پس از افشا لزوماً با revoke لایسنس باطل نمی‌شود.
- plan در شروع Native اعتبارسنجی می‌شود؛ ادامهٔ عملیات طولانی/paused، بررسی تازهٔ وضعیت لایسنس در هر فایل ندارد. انقضای plan با پاک‌کردن فایل‌های قبلاً دریافت‌شده یکی نیست.
- `main.rs::install_plan` تطابق license/device را کنترل می‌کند، اما tier و entitlement_version را بین plan و grant مقایسه نمی‌کند؛ payload فعلی plan هم entitlement_version ندارد و tier در metadata پکیج‌هاست. plan قبلی تا ۱۵ دقیقه و grant قدیمی طبق lease آفلاین می‌تواند معتبر بماند. داشتن grant جدیدِ تنزل‌یافته، به‌تنهایی plan قدیمی را در Native باطل نمی‌کند. این مشاهدهٔ کد است، نه بازتولید Runtime روی Windows یا جعل امضا؛ باید سیاست lease/revocation صریح شود و binding claimها در هر دو سمت به‌عنوان دفاع تکمیلی اضافه شود. حتی آن تغییر هم revoke فوریِ دستگاه کاملاً آفلاین را تضمین نمی‌کند.
- admin session یک bearer token پانزده‌دقیقه‌ای است. ورود device proof دارد و هر درخواست دوباره نقش/نسخهٔ دسترسی/وضعیت لایسنس را از DB می‌سنجد، ولی برای هر عملیات امضای تازهٔ دستگاه لازم نیست. سرقت session/XSS در مبدأ مورداعتماد می‌تواند در محدودهٔ همان دسترسی اثر بگذارد؛ چنین XSS موفقی در این بررسی اثبات نشد.
- امضای updater جلوی اجرای فایل با امضای غلط/نسخهٔ جعل‌شده را می‌گیرد؛ مانع patch کردن کلاینت توسط صاحب دستگاه یا توزیع clone آلوده بیرون از کانال رسمی نیست. Authenticode هنوز وجود ندارد.

**نتیجه:** هیچ دورزدن موفقِ سمت سرور با token جعلی در تست‌ها پیدا نشد؛ اما «کلاینت غیرقابل‌کرک»، «قفل فیزیکی غیرقابل کلون» و «جلوگیری قطعی از بازنشر مود» ادعای درستی برای معماری فعلی نیستند.

## ۲. یافته‌های بازتولیدشده

### AUD-01 — بالا: bucket مشترک و امکان محروم‌کردن کاربران دیگر از API

- محل: `supabase/functions/api/index.ts` و `backend/src/api.ts`.
- adapter تولید همیشه trustedIp=`unknown` می‌فرستد. HMAC کردن این مقدار هویت جدا ایجاد نمی‌کند؛ تمام درخواست‌های مشمول محدودیت در یک bucket با بودجهٔ ۱۲۰/۶۰ ثانیه قرار می‌گیرند.
- بازتولید محلی: ۱۲۰ درخواست catalog ناشناس موفق؛ درخواست معتبر مدیریت بعدی **429** شد. health بیرون این محدودیت است و می‌تواند همچنان سالم نشان داده شود.
- این DoS واقعی روی تولید امتحان نشد. نتیجه از همان کد adapter و تست محلی به دست آمد؛ به معنی نفوذ به DB یا شکستن رمزنگاری نیست.
- اصلاح لازم: هویت ingress واقعاً معتبر و محدودیت تفکیک‌شدهٔ anonymous/device/license به‌همراه سقف محافظتی کلی. **اعتماد ساده به X-Forwarded-For ارسالی کاربر، اصلاح امنی نیست.**

### AUD-02 — متوسط: ناشرِ بدون ویرایش از پنل نمی‌تواند انتشار دهد

- محل: `apps/web/src/admin.ts::editPackage`.
- نقش سفارشی `content.read + content.publish` در API مجاز به validate/publish است و اجازهٔ تغییر فایل/رمز ندارد؛ این جداسازی درست است.
- اما کل فرم با writable=`content.write` داخل fieldset disabled است؛ دکمه‌های validate/test/publish/archive نیز داخل همان fieldset هستند.
- بازتولید با ورود واقعی لایسنس آزمایشی در مرورگر: فیلد نام درست disabled بود، ولی `#publish-package` هم برخلاف مجوز API disabled بود.
- اصلاح لازم: ناحیهٔ داده‌های فقط‌خواندنی از عملیات انتشار با permission مستقل جدا شود؛ دادن content.write صرفاً برای دورزدن این UI، جداسازی وظایف را ضعیف می‌کند.

### AUD-03 — متوسط: content.write تنها در API اجازه می‌دهد، در UI راه ورود ندارد

- محل: navPermissions/renderAdmin و شرط packages در `/admin/overview`.
- owner می‌تواند permission مستقل content.write بدون content.read بدهد. API اجازهٔ ساخت draft می‌دهد؛ اما تب پکیج‌ها با content.read پنهان و package overview خالی است.
- تست مرورگر با ورود واقعی staff محلی، پنهان‌شدن تب را تأیید کرد؛ تست API مستقل مجوز write را تأیید می‌کند.
- باید تصمیم صریح گرفته شود: read پیش‌نیاز write/publish باشد، یا UI/API دسترسی مؤثر یکسانی تعریف کنند. بدون تصمیم مالک، permissionهای تولید خودکار تغییر نکردند.

### AUD-04 — متوسط: سرور plan با بیش از سقف Native امضا می‌کند

- محل: `resolvePlan` و `/install/plan` در برابر `main.rs::install_plan`.
- هر پکیج حداکثر ۳۰ dependency مستقیم دارد، ولی گراف انتقالی محدود نیست. chain با ۳۱ پکیج در تست، **200 و JWT معتبر با ۳۱ پکیج** گرفت؛ Native بیشتر از ۳۰ را رد می‌کند.
- این امضای جعلی یا دسترسی بدون اشتراک نیست؛ ناسازگاری قرارداد است که انتشار معتبر ظاهری را در دسکتاپ غیرقابل نصب می‌کند.
- اصلاح لازم: سقف plan نهایی و بودجهٔ token قبل از امضا بررسی شوند، نه فقط هر ردیف پکیج.

### AUD-05 — متوسط: انتشار حجمی که Native از ابتدا قبول نمی‌کند

- محل: `FileSpec/validatePublication` در برابر `installer.rs::install`.
- سقف هر فایل ۱۰۰ میلیارد بایت است، ولی مجموع files هنگام انتشار محدود نشده است. دو فایل ۶۰ میلیارد بایتی در تست محلی منتشر شدند (**200**)، در حالی که Native مجموع بیشتر از MAX_EXPANDED=۱۰۰ میلیارد را رد می‌کند.
- اصلاح لازم: سقف مجموع، حجم استخراج، فضای cache و budget نهایی plan بین server و Native هم‌تراز شوند. «فضای ناکافی» برای نقض سقف قرارداد هم پیام دقیقی نیست.

### AUD-06 — پایین تا متوسط، وابسته به route شبکه: تشخیص public IP کامل نیست

- محل: `isPrivateHost` و `installer.rs::public_ip`.
- URL `https://198.18.0.1/file.zip` که آدرس benchmarking است، از قرارداد عبور می‌کند؛ Native نیز عمدتاً private/loopback/link-local/multicast و چند range مشخص را رد می‌کند، نه همهٔ rangeهای special-use.
- پذیرش URL در تست اثبات شد؛ اتصال واقعی به سرویس داخلی/SSRF روی دستگاه یا شبکهٔ کاربر امتحان نشد. بهره‌برداری به مسیریابی آن range وابسته است.
- نقاط مثبت: DNS روی آدرس‌های تأییدشده pin می‌شود، هر redirect دوباره بررسی می‌شود، proxy غیرفعال و پورت فقط ۴۴۳ است. این ضعف معادل دورزدن عمومی همهٔ RFC1918ها نیست.
- اصلاح لازم: policy یکسان و آزموده‌شده برای IPv4/IPv6 special-use. فعلاً وجود حتی یک IPv6 در جواب DNS کل دانلود را رد می‌کند؛ این fail-closed است ولی بعضی هاست‌های سالم dual-stack را هم از کار می‌اندازد.

## ۳. سرور و DB واقعی چه وضعی دارند؟

بررسی read-only این مرحله:

| مورد | نتیجه |
|---|---|
| پروژه UHM | ACTIVE_HEALTHY |
| API / broker | ACTIVE، نسخه‌های ۱۰ / ۲ |
| RLS | هر ۱۴ جدول فعال |
| table grants برای anon/authenticated/PUBLIC در schema uhm | هیچ‌کدام در query مشاهده نشد |
| اجرای RPCهای uhm توسط anon/authenticated | هیچ‌کدام مجاز نبود |
| signup عمومی / anonymous Auth | غیرفعال |
| staff مبتنی بر لایسنسِ enabled | یک Owner با ۱۷ permission |
| عضویت legacy Authِ enabled | صفر |
| پکیج تولید | یک draft، صفر فایل، صفر مرحله و صفر dependency |
| release پکیج | صفر |

`verify_jwt=false` روی توابع در این معماری به‌تنهایی به معنی بی‌احرازهویت بودن نیست: API tokenهای ES256 سفارشی، proof و DB permissions را بررسی می‌کند و broker نیز RS256 GitHub را. غیرفعال‌بودن gateway verification را نباید با نبود auth در handler یکی گرفت.

سیاست‌های RLS و مجوز RPC دفاع مهمی هستند، ولی service_role عمداً آن‌ها را دور می‌زند و فقط باید در سرور بماند. این ممیزی نیازی به خواندن private key یا service-role value نداشت.

### ریسک‌های عملیاتیِ باقی‌مانده

- repository.list کل جدول را page به page می‌خواند. authentication و overview چند خواندن کامل دارند؛ بعضی limitها **پس از** خواندن همهٔ telemetry اعمال می‌شوند. برای رشد کاربران/رویدادها باید lookup ایندکس‌دار، pagination واقعی و محدودسازی هزینه بررسی شود؛ تست بار این مرحله انجام نشد.
- Secrets در سطح همین پروژه در اختیار توابع آن پروژه‌اند. broker پس از OIDC/provenance، **کلید بلندمدت updater** را موقتاً به CI می‌دهد؛ remote signing بدون خروج کلید نیست. compromise پروژه، runner، dependency یا مدیر مخزن ریسک مهم supply-chain است؛ compromise واقعی مشاهده نشد.
- actionهای CI عمدتاً با tag نسخه و نه commit SHA فراخوانی می‌شوند. branch protection، MFA حساب‌های مدیریتی GitHub/Supabase، restore خارج سایت و دفاع DDoS/CDN در این ممیزی به‌طور کامل قابل اثبات نبودند.
- npm audit بدون آسیب‌پذیری گزارش‌شده بود؛ این به معنی audit کامل 7-Zip، business logic یا صفر بودن آسیب‌پذیری نیست. محیط محلی cargo ندارد، ولی CI تازهٔ Windows روی source ممیزی f48b76a برای Native tests، cargo audit و ساخت NSIS موفق شد؛ جزئیات در بخش شواهد. این job هم جای تست بازی واقعی را نمی‌گیرد.
- زیرساخت رایگان فعلی سقف ظرفیت/مصرف دارد و تضمین always-on این ممیزی نیست؛ برنامهٔ بازیابی از توقف سرویس، مانیتورینگ و restore باید برای پذیرش نهایی روشن باشد. سرویس پولی یا محل ذخیرهٔ جدیدی ایجاد نشد.

## ۴. برای نصب مود مناسب است؟

**برای نصب کنترل‌شدهٔ پکیجِ مشخص روی یک Assetto Corsa آزمایشی، پایهٔ واقعی و مفیدی دارد؛ برای «هر مود و هر سناریو روی نصب اصلی» هنوز تأیید نهایی ندارد.**

### حفاظت‌های موجود

- HTTPS، کنترل redirect/DNS، size و SHA-256، cache و Range؛ پاسخ HTML صفحهٔ اشتراک‌گذاری، فایل معتبر محسوب نمی‌شود.
- ZIP داخلی و RAR/7z/ZIP رمزدار با 7z.exe و DLL دارای hash pin‌شده؛ آرشیوهای چندبخشی نام اصلی و همهٔ volumeهای لازم را می‌خواهند.
- رد traversal، مسیر مطلق/UNC/ADS، نام‌های رزروشده، symlink/reparse، بسیاری از لینک‌های آرشیو؛ سقف تعداد/اندازه/نسبت استخراج.
- staging، فهرست واقعی فایل‌ها و رضایت قبل از apply؛ hash مقصد قبل/بعد از رضایت و پیش از جایگزینی دوباره سنجیده می‌شود.
- backup، journal، atomic replacement، rollback/recovery، قفل نصب و ownership conflict.
- فایل EXE مود اجرا نمی‌شود؛ تنها خود updater با امضای معتبر مسیر اجرای کنترل‌شده دارد.

### مواردی که هنوز باید بسته شوند

1. **اعتماد به ناشر مهم است:** hash فقط همان bytes تأییدشده را نشان می‌دهد، نه سالم‌بودن مود. ناشر مجاز می‌تواند فایل بازی، DLL/ASI یا script بگذارد. عدم اجرای مستقیم EXE توسط لانچر جلوی اجرای کد مود در بازی/CM را نمی‌گیرد. preview فعلی عمدتاً `.exe` را به‌عنوان executable علامت می‌زند؛ هشدار برای DLL/ASI/Python/Lua و فایل‌های فعال باید کامل‌تر شود.
2. **گیت فرایند بازی برای نصب مود:** guard فرایند در updater وجود دارد، ولی مسیر installer مود کنترل مشابهی نشان نمی‌دهد. تغییر فایل‌های unlocked هنگام اجرای بازی هنوز ممکن است. این مورد code-review است، نه آزمایش با بازی واقعی.
3. **کش روی volume دیگر:** preflight اصلی فضای download از root بازی حساب می‌شود. اگر download_path روی درایو دیگری باشد، بودجهٔ کافی روی همان volume کش پیش از شروع تضمین نشده است؛ خطای I/O ممکن است دیر رخ دهد.
4. **Compatibility:** وجود acs.exe و content اعتبار ساختاری مسیر است، نه اثبات اصالت Steam/ورژن بازی. نوع محتوا metadata است؛ سازگاری skin با car، نسخه CSP/CM، یا سلامت مدل KN5 تضمین نشده. dependencies فقط ID هستند، نه constraints نسخهٔ دقیق.
5. **آرشیو و sandbox:** child extractor محدودیت زمان/لاگ و preflight دارد، ولی sandbox سیستم‌عامل/سهمیهٔ سخت دیسک ندارد و اندازهٔ نهایی بعد از استخراج هم سنجیده می‌شود. fuzzing آرشیو مخرب و مقاومت در برابر تمام parser bugs انجام نشد.
6. **Recovery و uninstall:** recovery در مسیر نصب و با فرمان جدا موجود است، اما سیاست startup اجباری کامل، uninstall گراف dependency، پاک‌سازی فایل‌های حذف‌شده در upgrade و مدیریت حذف layout/retention کامل نیست. نسخه جدید می‌تواند فایل‌های قدیمیِ دیگر لازم‌نبوده را در ownership نگه دارد.
7. **تست draft sandbox جدا نیست:** روی game_path واقعی انتخاب‌شده نصب می‌شود؛ UI هشدار می‌دهد. باید کپی آزمایشی بازی انتخاب شود.
8. **لینک‌ها:** URL باید download مستقیم با فایل/hash/size معلوم باشد. موتور عمومی دورزدن captcha، login، timer یا تبدیل هر share-link آپلودر وجود ندارد. تشخیص خودکار پوشه مقصد/هش از هر لینک نیز وجود ندارد.
9. **multipart:** همه volumeها باید موجود و نام‌ها صحیح باشند؛ معمولاً extract از volume اول تعریف می‌شود. ساختن مرحله استخراج برای هر part ممکن است استخراج تکراری/تعارض مقصد بدهد. تست فرم چندفایل، اثبات استخراج هر آرشیو واقعی کاربر نیست.

در این مرحله بازی واقعی، فایل مود کاربر و upload host واقعی در اختیار تست نبود. موفقیت قبلی Windows update smoke صرفاً چرخه updater را ثابت می‌کند، نه نصب صحیح مود در Assetto Corsa.

## ۵. موتور افزودن بازی / لینک / فایل و دسترسی‌ها

### سیستم فعلی یک‌‎بازی است

فرم و DB برای **پکیج Assetto Corsa** هستند. `PackageSpec` دارای game_id یا Game registry مستقل نیست و Native مسیر را با acs.exe/content اعتبارسنجی می‌کند. چند game_path یعنی چند نصب/کپی همین بازی، نه مدیریت بازی‌های متفاوت. افزودن بازی مستقل دیگر بدون توسعهٔ قرارداد، مسیر، قوانین و installer adapter آن قابل تأیید نیست.

### جدول نقش‌های پیش‌فرض

| نقش | مشاهده محتوا | ساخت/ویرایش draft، لینک، فایل و رمز | validate/test/publish/archive | مدیریت تیم |
|---|---:|---:|---:|---:|
| Owner | بله | بله | بله | بله |
| content_manager | بله | بله | بله | خیر |
| license_manager | خیر | خیر | خیر | خیر |
| support | بله؛ بدون لینک/رمز/steps | خیر | خیر | خیر |
| viewer | بله؛ بدون لینک/رمز/steps | خیر | خیر | خیر |

این جدول default است؛ **permissions صریح staff می‌تواند با اسم role متفاوت باشد**. Owner همواره همهٔ permissionها را دارد. به همین دلیل فقط آزمایش اسم role کافی نیست؛ editor/publisher سفارشی نیز تست شدند.

سایر مجوزهای پیش‌فرض، مطابق `rolePermissions`:

- **Owner:** هر ۱۷ مجوز، شامل تیم، service/maintenance، audit، محتوا، لایسنس و خطاها.
- **license_manager:** هشت `licenses.*` یعنی read/create/update/suspend/revoke/reset/extend/archive، به‌علاوه analytics.read و errors.read؛ مجموع ۱۰ مجوز. مجوز تیم یا انتشار محتوا ندارد.
- **content_manager:** content.read/write/publish و analytics.read و errors.read؛ مجموع ۵.
- **support:** licenses.read/update، content.read، analytics.read و errors.read/resolve؛ مجموع ۶. `licenses.update` فقط ویرایش نام/یادداشت نیست؛ مسیر تغییر tier لایسنس عادی نیز از همین permission استفاده می‌کند. اگر Support باید صرفاً نام/یادداشت را تغییر دهد، این permission نیازمند تفکیک است.
- **viewer:** content.read و analytics.read؛ مجموع ۲.

تغییر وضعیت/reset/tier/archive یک لایسنسِ دارای staff فعال برای non-owner محدود شده است؛ self-access change نیز محدودیت جدا دارد. این محافظت با مجازبودن تغییر tier یک کاربر عادی یکسان نیست. permissionها را باید بر اساس عملیات واقعی انتخاب کرد، نه صرفاً اسم نمایشی نقش.

### مجوز واقعی هر مسیر API

| عملیات | permission |
|---|---|
| نمایش جزئیات مدیریتی پکیج و history | content.read؛ files/steps کامل فقط با content.write |
| POST /admin/packages | content.write |
| validate، publish، archive | content.publish |
| test-plan | content.publish + grant فعال + proof دستگاه؛ tier dependencyها هم بررسی می‌شود |
| تغییر/اعطای دسترسی staff | team.manage؛ non-owner نمی‌تواند Owner بسازد یا permission بیرون از دسترسی خودش بدهد |
| نصب عادی | grant فعال، proof plan، سطح اشتراک و گراف منتشرشده |

فقط پنهان‌کردن دکمه نیست: تغییر مستقیم request با viewer/support/license_manager نیز در ماتریس ۲۵ سناریویی رد شد. تغییر Owner در JSON/JWT به‌تنهایی نقش DB را عوض نکرد.

### جریان و محدودیت موتور

فرم واقعی نام/slug/version/tier/نوع/تصاویر/زمان/کانال، چند فایل و mirror، hash/size/password، action/destination/overwrite/source_subdir و ترتیب stepها را ذخیره می‌کند؛ child tableها با trigger هم‌تراز می‌شوند. draft سپس ساختاری validate، با دستگاه واقعی test-plan و بعد منتشر می‌شود؛ snapshot منتشرشده immutable است و draft جدید نسخه stable قبلی را از catalog حذف نمی‌کند.

اما validate سرور **فایل را از آپلودر دانلود و باز نمی‌کند**؛ hash واردشده را از روی فایل واقعی محاسبه نمی‌کند و وجود/safety/قابلیت resume آن لینک را اثبات نمی‌کند. بدون آزمایش واقعی آرشیو، یک manifest با ساختار صحیح می‌تواند غیرقابل نصب باشد. AUD-04/05 نمونهٔ مشخص ناسازگاری server/native هستند.

پکیج فعلی تولید خالی است و هیچ release پکیج وجود ندارد؛ در این ممیزی بدون اجازه آن را پر/منتشر/حذف نکردم. این وضعیت برای تأیید آماده‌بودن یک مود واقعی کافی نیست.

## ۶. شواهد تست و معنای نتیجه

فایل‌های تازه:

- `tests/security-audit.test.ts`: **۳۲ تست عادی موفق + ۴ expected failure**، از جمله ماتریس ۵ نقش × ۵ عملیات، permission سفارشی، جداسازی tokenها، revoke و redaction.
- `tests/security-browser/package-permissions.spec.ts`: **۱ سناریوی موفق + ۲ expected failure** با ورود واقعی device-proof در adapter محلی. نقاط شکست دقیق همان دکمهٔ disabled و تب hidden بودند، نه شکست setup.
- `playwright.security.config.ts` و دو فرمان `audit:security` و `audit:browser` برای اجرای ایزوله.
- `.github/workflows/security-audit.yml`: تست‌ها + کنترل غیرمخرب API تولید؛ بدون id-token/write permission، بدون دریافت کلید امضا یا تغییر تولید.

نتیجه محلی نهایی: `npm run check`، typecheck/build/format موفق؛ **۱۶۲ تست عادی + ۴ expected failure** در ۱۰ فایل. browser audit: ۱ عادی + ۲ expected failure. همچنین **۱۹ تست مرورگر قبلی** دوباره موفق شدند؛ بخش native-bridge آن‌ها IPC را شبیه‌سازی می‌کند و اجرای واقعی Rust/نصب فایل بازی نیست. build:edge موفق و diff خروجی deploy صفر بود. npm audit: صفر آسیب‌پذیری گزارش‌شده. به هیچ عنوان نباید این اعداد را «۱۶۶ تست امنیتی موفق و صفر ایراد» خواند.

تست‌های known-failure عمداً ادعای امنِ فعلاً نادرست را علامت می‌زنند؛ بعد از اصلاح باید از expected-failure خارج و عادی شوند. اصلاح بدون تغییر این علامت هم باید در CI دیده شود.

### اجرای مجدد

```sh
npm ci
npm run audit:security
npm run audit:browser
npm run check
npm audit --audit-level=high
```

مرورگر باید نصب باشد. در محیط sandbox این جلسه Chromium بسته npm با `CHROMIUM_PATH=/tmp/chromium` و `LD_LIBRARY_PATH=/tmp/lib` استفاده شد؛ در CI Playwright مرورگر رسمی نصب می‌کند.

### نتیجهٔ CI و کنترل HTTP واقعیِ این مرحله

هر دو اجرا برای source `f48b76a7ad82bb16d2fb2251d0d34cd1ee3e52e8` **SUCCESS** شدند:

- [Security and package permission audit — 41615226906](https://github.com/aliam664/App/actions/runs/41615226906): تست API و مرورگر، npm audit و مرحلهٔ HTTP غیرمخرب واقعی موفق. health/کلید عمومی/identity/capability، catalog، رد دسترسی ناشناس مدیریت و DB، CORS و رد GET/POST ناشناس broker کنترل شدند. هیچ owner license یا signing credential در این workflow مصرف نشد. موفقیت CI شامل همان ۴+۲ expected-failure باز است.
- [Platform checks — 41615227212](https://github.com/aliam664/App/actions/runs/41615227212): web/API/format/build/edge-diff/npm-audit/۱۹ تست مرورگر و job Windows شامل Native security/recovery tests، cargo audit و ساخت NSIS موفق شدند. نصب‌کنندهٔ خروجی artifact آزمایش CI است؛ release/feed عمومی جدید منتشر نشد.

خواندن status/step conclusionها موفق بود؛ دریافت لاگ کامل jobها در sandbox به خطای شبکهٔ EOF خورد. بنابراین شمار تازهٔ تست‌های Rust را از لاگ جدید نقل نمی‌کنم. محدودیت لاگ، نتیجهٔ SUCCESS گزارش‌شدهٔ خود job را تغییر نمی‌دهد؛ همچنین آن نتیجه اثبات پذیرش روی بازی واقعی نیست.

queryهای read-only پیکربندی/RLS/permissions/Auth همین جلسه جداگانه انجام شدند. در کنار آن‌ها، مرحلهٔ HTTP بالا واقعاً اجرا شد؛ نتیجه صرفاً از metadata فعال بودن سرویس استنباط نشده است.

## ۷. ترتیب پیشنهادی اصلاح

1. P0: bucket مشترک تولید را با هویت معتبر و سیاست تفکیک‌شده ببندیم؛ raw forwarded header را trusted نکنیم.
2. P1: مدل read/write/publish را صریح و UI publisher را مستقل از fieldset ویرایش اصلاح کنیم؛ سپس ماتریس role/custom را عادی کنیم.
3. P1: بودجهٔ مشترک plan/token/files/extraction و volume کش، و guard اجرای بازی برای نصب مود.
4. P1: بستهٔ واقعی Cars/Tracks/Skins/CSP و آرشیو رمزدار/multipart از هاست‌های واقعی روی کپی بازی Windows؛ failure/rollback/AV/permissions/space و recovery startup.
5. P2: هشدار کد فعال، محدودیت extractor، version constraints، مدیریت uninstall/retention و queryهای scale.
6. P2: ضدسوءاستفادهٔ تجاری: concurrent-session policy و در صورت نیاز TPM/attestation؛ هیچ‌کدام وعدهٔ مطلق ضدکرک نمی‌دهند. محل فایل‌های مود روی آپلودر فعلی باقی می‌ماند؛ سرویس پولی/میزبان جدیدی در این ممیزی ایجاد نشد.

**پیش از تغییر مدل بازی:** باید روشن شود منظور از «افزودن بازی»، بازی‌های مستقل دیگر است یا پکیج/نسخه برای همین Assetto Corsa. در این ممیزی آن تصمیم محصول به‌جای مالک گرفته نشده است.
