# راهنمای قرار دادن فایل‌های مود — UHM Pack Installer

این سند دقیقاً توضیح می‌دهد که برای هر **پری‌ست گرافیکی (سطح سیستم)**، فایل‌های
CSP، PURE، PP Filter، Chase Cam، HUD، SRP و Video را کجا باید بگذاری تا نصب‌کننده
بتواند آن‌ها را به‌صورت خودکار و با مسیر درست داخل بازی اعمال کند.

---

## ۱) دو جای مهم

| مکان | مسیر | نقش |
|---|---|---|
| **پوشهٔ فایل‌های مود (منبع)** | `src/assets/mod-files/` | این‌جا فایل‌های واقعی مود را می‌گذاری. نصب‌کننده از همین پوشه می‌خواند. |
| **پوشهٔ نصب بازی (مقصد)** | پوشهٔ اصلی Assetto Corsa (جایی که `acs.exe` هست) | نصب‌کننده فایل‌ها را با ساختار درست داخل این پوشه کپی می‌کند. |

> پوشهٔ منبع در ریپازیتوری از قبل ساخته شده و داخل هر زیرپوشه یک فایل `.gitkeep`
> هست تا پوشه در گیت بماند. فقط فایل‌های واقعی مود را به همان زیرپوشه اضافه کن.

---

## ۲) زیرپوشهٔ هر مود داخل `src/assets/mod-files/`

| مود | پوشهٔ منبع | مقصد داخل بازی (`dest`) | یعنی چه |
|---|---|---|---|
| **CSP** | `csp/` | ریشهٔ بازی `<game>` | محتوای پوشه مستقیماً در ریشهٔ بازی کپی می‌شود |
| **PURE** | `pure/` | ریشهٔ بازی `<game>` | محتوای پوشه در ریشهٔ بازی کپی می‌شود |
| **PP Filter** | `ppfilter/` | `<game>/system/cfg` | محتوای پوشه داخل `system/cfg` کپی می‌شود |
| **Chase Cam** | `chasecam/` | `<game>/system/cfg` | محتوای پوشه داخل `system/cfg` کپی می‌شود |
| **HUD** | `hud/` | ریشهٔ بازی `<game>` | محتوای پوشه در ریشهٔ بازی کپی می‌شود |
| **SRP Light** | `srp/` | `<game>/extension/config-ext/pure` | محتوای پوشه داخل پوشهٔ PURE کپی می‌شود |
| **Video** | `video/` | `<game>/system/cfg` | محتوای پوشه داخل `system/cfg` کپی می‌شود |

**قانون کلی:** ساختار داخلی هر پوشهٔ منبع باید دقیقاً همان ساختاری باشد که قرار است
داخل بازی ساخته شود؛ نصب‌کننده محتوای پوشه را «عیناً» به مقصد کپی می‌کند
(و اگر فایلی از قبل وجود داشت، اول از آن بکاپ می‌گیرد).

---

## ۳) راهنمای دقیق هر مود

### CSP (Custom Shaders Patch)

- **پوشهٔ منبع:** `src/assets/mod-files/csp/`
- **مقصد:** ریشهٔ بازی
- **فایل‌هایی که باید داخل `csp/` بگذاری (با همین ساختار):**
  ```
  src/assets/mod-files/csp/
  ├── dwrite.dll                  ← کنار acs.exe قرار می‌گیرد (ریشهٔ بازی)
  ├── dwrite.ini
  └── extension/
      ├── config/
      │   ├── data_manifest.ini   ← نشانگر اصلی تشخیص CSP
      │   └── ... (بقیهٔ فایل‌های پیکربندی CSP)
      └── ... (سایر بخش‌های CSP)
  ```
- **نشانگر تشخیص:** وجود `extension/config/data_manifest.ini` (یا پوشهٔ
  `extension/config/data_manifest`) یعنی CSP نصب است.

### PURE

- **پوشهٔ منبع:** `src/assets/mod-files/pure/`
- **مقصد:** ریشهٔ بازی
- **فایل‌هایی که باید داخل `pure/` بگذاری:**
  ```
  src/assets/mod-files/pure/
  └── extension/
      └── config-ext/
          └── Pure/               ← پوشهٔ اصلی PURE (با همهٔ محتوا)
              └── ...
  ```
- **نشانگر تشخیص:** وجود `extension/config-ext/Pure` (یا `extension/config-ext/pure`).
- **پیش‌نیاز:** برای کارکرد PURE باید CSP با قابلیت Weather FX نصب باشد.

### PP Filter

- **پوشهٔ منبع:** `src/assets/mod-files/ppfilter/`
- **مقصد:** `<game>/system/cfg`
- **فایل‌ها:**
  ```
  src/assets/mod-files/ppfilter/
  └── ppfilters/
      └── <نام-فیلتر>.ini          ← فایل(های) فیلتر پس‌پردازش
  ```
- یعنی چون مقصد `system/cfg` است، باید پوشهٔ `ppfilters/` را داخل `ppfilter/` بسازی
  تا در بازی به `<game>/system/cfg/ppfilters/...` برسد.

### Chase Cam

- **پوشهٔ منبع:** `src/assets/mod-files/chasecam/`
- **مقصد:** `<game>/system/cfg`
- **فایل‌ها:**
  ```
  src/assets/mod-files/chasecam/
  ├── camera.ini                   ← دوربین تعقیب‌کننده
  ├── cams.ini                     ← تنظیمات دوربین‌ها
  └── ...
  ```
- در بازی به `<game>/system/cfg/camera.ini` و `<game>/system/cfg/cams.ini` می‌رسد.
- اگر دوربین اختصاصی برای ماشین خاصی داری، آن را جداگانه (مثلاً از بخش نصب مود
  درگ‌اند‌دراپ) با ساختار `content/cars/<car>/cams.ini` نصب کن.

### HUD

- **پوشهٔ منبع:** `src/assets/mod-files/hud/`
- **مقصد:** ریشهٔ بازی
- **فایل‌ها (با همان ساختار داخل پوشهٔ `hud/`):**
  ```
  src/assets/mod-files/hud/
  ├── apps/ ...                    ← اپ‌های HUD داخل apps/
  ├── content/apps/ ...
  └── extension/apps/ ...
  ```

### SRP Light

- **پوشهٔ منبع:** `src/assets/mod-files/srp/`
- **مقصد:** `<game>/extension/config-ext/pure`
- **فایل‌ها:**
  ```
  src/assets/mod-files/srp/
  └── <فایل‌های افکت SRP که باید داخل پوشهٔ PURE قرار بگیرند>
  ```
- **پیش‌نیاز:** PURE باید نصب باشد.

### Video

- **پوشهٔ منبع:** `src/assets/mod-files/video/`
- **مقصد:** `<game>/system/cfg`
- **فایل‌ها:**
  ```
  src/assets/mod-files/video/
  └── video.ini                     ← تنظیمات بهینهٔ گرافیک/رزولوشن
  ```

---

## ۴) هر پری‌ست (سطح سیستم) چه فایل‌هایی لازم دارد؟

نصب‌کننده برای هر سطح فقط زیرمجموعهٔ مشخصی از مودها را نصب می‌کند. برای اینکه یک
سطح «کامل» نصب شود، فایل‌های مودهای همان ردیف باید در پوشهٔ منبع‌شان موجود باشند.

### Low — کم
- نصب می‌شود: **CSP · PP Filter · Video**
- فایل‌ها را در این پوشه‌ها بگذار:
  - `src/assets/mod-files/csp/` → (`dwrite.dll`, `dwrite.ini`, `extension/config/data_manifest.ini`, ...)
  - `src/assets/mod-files/ppfilter/ppfilters/<فیلتر>.ini`
  - `src/assets/mod-files/video/video.ini`

### Medium — متوسط
- نصب می‌شود: **CSP · PURE · PP Filter · Video**
- علاوه بر پوشه‌های Low:
  - `src/assets/mod-files/pure/extension/config-ext/Pure/...`

### High — بالا
- نصب می‌شود: **CSP · PURE · PP Filter · Chase Cam · Video**
- علاوه بر Medium:
  - `src/assets/mod-files/chasecam/camera.ini`, `cams.ini`

### Very High — خیلی بالا
- نصب می‌شود: **CSP · PURE · PP Filter · Chase Cam · HUD · Video**
- علاوه بر High:
  - `src/assets/mod-files/hud/` (با ساختار `apps/` و/یا `extension/apps/`)

### Ultra — فوق‌العاده
- نصب می‌شود: **CSP · PURE · PP Filter · Chase Cam · HUD · SRP · Video**
- علاوه بر Very High:
  - `src/assets/mod-files/srp/` (فایل‌های افکت SRP برای داخل پوشهٔ PURE)

---

## ۵) چک‌لیست پیش از نصب (سریع)

1. مسیر بازی را در برنامه تنظیم کن (پوشه‌ای که `acs.exe` داخلش است).
2. برای هر مودی که می‌خواهی نصب شود، فایل واقعی را در زیرپوشهٔ متناظر
   `src/assets/mod-files/<مود>/` بگذار.
3. ساختار داخلی را مطابق جدول بخش ۲ و ۳ بساز (نه یک پوشهٔ تودرتو با نام تکراری).
4. اگر فایل فشرده (ZIP/RAR) داری، یا محتوای آن را طبق ساختار بالا باز کن، یا از
   صفحهٔ **نصب مود** (درگ‌اند‌دراپ) استفاده کن که ساختار ماشین/مپ/اسکین/اپ/فیلتر
   را خودش تشخیص می‌دهد و در مسیر درست می‌نشاند.
5. دکمهٔ «تشخیص خودکار سیستم» را بزن تا بهترین سطح پیشنهاد شود (یا دستی انتخاب کن).

---

## ۶) بکاپ و بازگردانی

- قبل از بازنویسی هر فایل، نصب‌کننده از آن نسخهٔ پشتیبان می‌گیرد:
  `<UserData>/backups/<مود>/backup/<مسیر-نسبی>.bak`
- از بخش **مدیریت مودها** می‌توانی هر مود را حذف یا به حالت قبل بازگردانی کنی.

---

## ۷) اشتباه‌های رایج

- گذاشتن یک پوشهٔ تودرتو با نام تکراری (مثلاً `csp/CSP/...`): نصب‌کننده محتوا را
  عیناً کپی می‌کند؛ پس ساختار باید از همان سطحی شروع شود که باید داخل بازی باشد.
- گذاشتن PP Filter مستقیماً در `ppfilter/` بدون پوشهٔ `ppfilters/`: چون مقصد
  `system/cfg` است، فایل باید زیر `ppfilters/` قرار بگیرد.
- فراموش کردن `dwrite.dll` برای CSP: این فایل باید کنار `acs.exe` (ریشهٔ بازی) برود.
- نصب PURE بدون CSP (Weather FX): PURE بدون CSP کار نمی‌کند.
- نصب SRP بدون PURE: SRP فقط وقتی PURE موجود باشد نصب می‌شود.

> مسیرها و ساختارها بر اساس تعریف مودها در `src/js/modConfig.js` و منطق نصب در
> `src/lib/installer.js` است؛ اگر چیزی تغییر کرد، همین سند را هم به‌روز کن.
