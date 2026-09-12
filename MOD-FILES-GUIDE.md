# 📂 راهنمای کامل جای‌گذاری فایل‌های مود و ساخت EXE

این سند دقیقاً توضیح می‌دهد **کدام فایل را کجا بریزی**، بک‌اند با آن چه می‌کند، و بعد چطور EXE بسازی.
همه‌چیز بر اساس کد واقعی بک‌اند (`src-tauri/src/installer.rs`, `src/js/modConfig.js`, `src-tauri/tauri.conf.json`) نوشته شده است.

---

## ۱. بک‌اند چطور کار می‌کند؟ (خلاصه‌ی ۱ دقیقه‌ای)

1. هنگام بیلد، پوشه‌ی **`mod-files/`** (ریشه‌ی پروژه) به‌عنوان *resource* کنار برنامه بسته‌بندی می‌شود
   (`tauri.conf.json` → `"resources": { "../mod-files/": "mod-files/" }`).
2. کاربر یکی از ۵ سطح را انتخاب می‌کند: `low` / `medium` / `high` / `veryhigh` / `ultra`.
3. هر سطح **زیرمجموعه‌ی مشخصی از ۷ مود** را نصب می‌کند (جدول بخش ۳).
4. برای هر مود، بک‌اند محتوای `mod-files/<mod-id>/` را **با حفظ ساختار پوشه‌ها** به مسیر مقصد (`dest`) داخل پوشه‌ی بازی کپی می‌کند.
5. قبل از بازنویسی هر فایل موجود، از آن **بکاپ** می‌گیرد (`%APPDATA%\com.uhm.packinstaller\backups\`) تا حذف/بازگردانی ممکن باشد.
6. اگر پوشه‌ی یک مود خالی باشد → وضعیت «⚠️ فایل مود موجود نیست» (`MISSING_FILES`) نمایش داده می‌شود؛ خطا نیست، ولی چیزی نصب نمی‌شود.

> ⚠️ پوشه‌ی قدیمی `src/assets/mod-files/` دیگر استفاده نمی‌شود. فقط `mod-files/` در ریشه‌ی پروژه.

---

## ۲. هفت مود و مقصد دقیق هر کدام در پوشه‌ی بازی

`<AC>` = پوشه‌ی نصب Assetto Corsa (مثلاً `C:\Program Files (x86)\Steam\steamapps\common\assettocorsa`)

| شناسه (نام پوشه) | نام در برنامه | مقصد در بازی (`dest`) | یعنی محتوای پوشه دقیقاً کجا می‌ریزد |
|---|---|---|---|
| `csp` | CSP | *(ریشه‌ی بازی)* | `<AC>\` |
| `pure` | PURE | *(ریشه‌ی بازی)* | `<AC>\` |
| `ppfilter` | PP Filter | `system/cfg` | `<AC>\system\cfg\` |
| `chasecam` | Chase Cam | `system/cfg` | `<AC>\system\cfg\` |
| `hud` | HUD | *(ریشه‌ی بازی)* | `<AC>\` |
| `srp` | SRP Light | `extension/config-ext/pure` | `<AC>\extension\config-ext\pure\` |
| `video` | Video | `system/cfg` | `<AC>\system\cfg\` |

### قانون طلایی
> **ساختار داخل `mod-files/<mod-id>/` باید دقیقاً همان ساختاری باشد که می‌خواهی داخل `dest` ظاهر شود.**

مثال‌ها:

```text
mod-files/csp/extension/config/data_manifest.ini   →  <AC>\extension\config\data_manifest.ini
mod-files/csp/dwrite.dll                            →  <AC>\dwrite.dll
mod-files/pure/extension/config-ext/pure/...        →  <AC>\extension\config-ext\pure\...
mod-files/ppfilter/UHM.ini                          →  <AC>\system\cfg\UHM.ini
mod-files/ppfilter/ppfilters/UHM.ini                →  <AC>\system\cfg\ppfilters\UHM.ini
mod-files/video/video.ini                           →  <AC>\system\cfg\video.ini
mod-files/hud/apps/python/UHM_HUD/...               →  <AC>\apps\python\UHM_HUD\...
mod-files/srp/UHM_SRP_Light.ini                     →  <AC>\extension\config-ext\pure\UHM_SRP_Light.ini
```

❌ **اشتباه رایج:** ریختن یک فایل ZIP/RAR داخل پوشه. بک‌اند برای پک‌های تیری فقط **پوشه‌ی باز‌شده** را کپی می‌کند (نوع همه‌ی مودها `copy` است). آرشیو را اکسترکت کن و محتوایش را بریز.

---

## ۳. کدام سطح چه مودهایی نصب می‌کند؟

(از `TIER_MODS` در `src/js/modConfig.js`)

| سطح | مودهای نصب‌شونده |
|---|---|
| **Low** | csp, ppfilter, video |
| **Medium** | csp, pure, ppfilter, video |
| **High** | csp, pure, ppfilter, chasecam, video |
| **Very High** | csp, pure, ppfilter, chasecam, hud, video |
| **Ultra** | csp, pure, ppfilter, chasecam, hud, srp, video |

> اگر کاربر در مرحله‌ی «بررسی مودهای پایه» بگوید CSP/PURE فعلی‌اش را **نگه دارد**، آن مود از لیست حذف می‌شود (`overwrite: false` → `SKIPPED_KEEP_EXISTING`).

---

## ۴. پک گرافیکی ۵ حالته‌ی من را کجا بریزم؟ (مهم‌ترین بخش)

بک‌اند دو چیدمان را پشتیبانی می‌کند و **خودکار تشخیص می‌دهد** کدام را استفاده کرده‌ای:

### چیدمان A — یک نسخه برای همه‌ی سطح‌ها (ساده)

اگر فایل‌های یک مود برای هر ۵ سطح یکی است (مثلاً CSP، PURE، HUD):

```text
mod-files/
└── csp/
    ├── dwrite.dll
    └── extension/
        └── ...
```

هرچه داخل پوشه هست برای همه‌ی سطح‌ها کپی می‌شود. تمام.

### چیدمان B — فایل‌های متفاوت برای هر سطح (پک ۵ حالته)

اگر مودی (معمولاً `ppfilter` و `video`، گاهی `pure`/`srp`) برای هر سطح تنظیمات متفاوتی دارد، داخل پوشه‌ی همان مود، **زیرپوشه با نام دقیق سطح** بساز:

```text
mod-files/
├── video/
│   ├── common/                 ← (اختیاری) برای همه‌ی سطح‌ها
│   │   └── controls.ini
│   ├── low/
│   │   └── video.ini           ← فقط وقتی کاربر Low انتخاب کند
│   ├── medium/
│   │   └── video.ini
│   ├── high/
│   │   └── video.ini
│   ├── veryhigh/
│   │   └── video.ini
│   └── ultra/
│       └── video.ini
│
└── ppfilter/
    ├── common/
    │   └── ppfilters/UHM_Base.ini
    ├── low/
    │   └── ppfilters/UHM.ini
    ├── medium/
    │   └── ppfilters/UHM.ini
    ├── high/
    │   └── ppfilters/UHM.ini
    ├── veryhigh/
    │   └── ppfilters/UHM.ini
    └── ultra/
        └── ppfilters/UHM.ini
```

**قوانین چیدمان B:**

| قانون | توضیح |
|---|---|
| نام پوشه‌های سطح | دقیقاً و با حروف کوچک: `low` `medium` `high` `veryhigh` `ultra` (بدون فاصله، `veryhigh` سرهم) |
| فعال‌شدن این حالت | به‌محض اینکه حداقل یکی از پوشه‌های `common/` یا `<tier>/` وجود داشته باشد |
| ترتیب کپی | ۱) فایل‌های آزادِ ریشه‌ی مود → ۲) `common/` → ۳) `<سطح انتخابی>/` — **پوشه‌ی سطح همیشه برنده است** و فایل هم‌نام `common` را بازنویسی می‌کند |
| سطحی که پوشه ندارد | فقط `common/` + فایل‌های آزاد نصب می‌شود (اگر هیچ‌کدام نباشد → «فایل مود موجود نیست») |
| مسیر داخل پوشه‌ی سطح | نسبت به همان `dest` مود است: `video/ultra/video.ini` → `<AC>\system\cfg\video.ini` |
| خود پوشه‌ی `ultra/` | هرگز داخل بازی ساخته نمی‌شود؛ فقط محتوایش کپی می‌شود |

### نمونه‌ی کامل و پیشنهادی برای پک UHM

```text
mod-files/
├── csp/                        (چیدمان A — همه‌ی سطح‌ها)
│   ├── dwrite.dll
│   └── extension/…
├── pure/                       (چیدمان A)
│   └── extension/…
├── hud/                        (چیدمان A)
│   └── apps/…  یا  extension/…
├── chasecam/                   (چیدمان A)
│   └── camera_onboard*.ini / …
├── srp/                        (چیدمان A یا B)
│   └── *.ini
├── ppfilter/                   (چیدمان B — ۵ حالت)
│   ├── low/ppfilters/UHM.ini
│   ├── medium/ppfilters/UHM.ini
│   ├── high/ppfilters/UHM.ini
│   ├── veryhigh/ppfilters/UHM.ini
│   └── ultra/ppfilters/UHM.ini
└── video/                      (چیدمان B — ۵ حالت)
    ├── low/video.ini
    ├── medium/video.ini
    ├── high/video.ini
    ├── veryhigh/video.ini
    └── ultra/video.ini
```

---

## ۵. مسیر کامل: از فایل‌های خام تا EXE

### مرحله ۰ — پیش‌نیازها (یک‌بار)

```powershell
winget install OpenJS.NodeJS.LTS
winget install Rustlang.Rustup
winget install Microsoft.VisualStudio.2022.BuildTools   # سپس workload «Desktop development with C++» را تیک بزن
```

### مرحله ۱ — گرفتن پروژه

```powershell
git clone https://github.com/aliam664/App.git
cd App
git checkout arena/01a092d4-app     # شاخه‌ی نسخه‌ی Tauri (یا main بعد از merge)
npm install
```

### مرحله ۲ — ریختن مودها

فایل‌ها را طبق بخش ۲ و ۴ داخل `mod-files/<mod-id>/` بریز.
فایل `.gitkeep` داخل پوشه‌ها را می‌توانی نگه داری (کپی می‌شود ولی بی‌ضرر است) یا حذف کنی.

### مرحله ۳ — چک سریع (اختیاری ولی پیشنهادی)

```powershell
npm run check         # تست‌های فرانت‌اند
npm run test:rust     # تست‌های بک‌اند (شامل تست چیدمان ۵ سطحی)
npm run dev           # اجرای واقعی برنامه؛ نصب را روی یک کپی از بازی امتحان کن
```

### مرحله ۴ — ساخت EXE

```powershell
npm run build
```

خروجی:

```text
src-tauri\target\release\bundle\nsis\UHM Pack Installer_2.0.0_x64-setup.exe
```

حجم ≈ **۵–۸ مگابایت + حجم فشرده‌شده‌ی mod-files** (NSIS با LZMA فشرده می‌کند).

### مرحله ۵ — انتشار

```powershell
gh release create v2.0.0 "src-tauri\target\release\bundle\nsis\UHM Pack Installer_2.0.0_x64-setup.exe" --title "UHM Pack Installer v2.0.0" --generate-notes
```

یا از سایت گیت‌هاب: Releases → Draft new release → فایل را Attach کن.

### روش خودکار (بدون نصب Rust روی کامپیوتر خودت)

1. `docs/build.yml.example` را به `.github/workflows/build.yml` کپی کن.
2. مودها را داخل `mod-files/` بریز، commit و push کن.
3. گیت‌هاب روی سرور ویندوزی خودش EXE می‌سازد و در تب **Actions → Artifacts** قرار می‌دهد؛ برای تگ `v*` خودکار Release می‌سازد.

> اگر فایل‌های مود حجیم‌اند (>۵۰ مگ) بهتر است با **Git LFS** commit شوند: `git lfs install && git lfs track "mod-files/**"`.

---

## ۶. آیا باید مودها را commit کنم؟

| گزینه | مزیت | عیب |
|---|---|---|
| commit داخل ریپو (`mod-files/`) | بیلد خودکار CI کار می‌کند؛ هر کسی clone کند نسخه‌ی کامل دارد | ریپو سنگین می‌شود (Git LFS توصیه می‌شود) |
| فقط روی سیستم خودت قبل از `npm run build` | ریپو سبک می‌ماند | CI نسخه‌ی خالی می‌سازد |

فعلاً `.gitignore` مودها را **نادیده نمی‌گیرد**؛ هرچه بریزی commit می‌شود.

---

## ۷. چک‌لیست نهایی

- [ ] هر مود داخل `mod-files/<mod-id>/` است (نام پوشه دقیقاً از جدول بخش ۲)
- [ ] هیچ ZIP/RAR داخل پوشه‌ها نیست — همه اکسترکت‌شده
- [ ] ساختار داخلی هر پوشه نسبت به `dest` همان مود درست است
- [ ] برای مودهای ۵ حالته، پوشه‌های `low/medium/high/veryhigh/ultra` با املای دقیق
- [ ] `npm run dev` → نصب روی یک کپی از بازی امتحان شد و فایل‌ها سر جای درست نشستند
- [ ] `npm run build` → EXE ساخته شد و حجمش منطقی است
- [ ] Release در گیت‌هاب

---

## ۸. سؤال‌های متداول

**می‌خواهم مسیر مقصد یک مود را عوض کنم؟**
`src/js/modConfig.js` → فیلد `dest` همان مود. مسیر باید نسبی و داخل پوشه‌ی بازی باشد (بک‌اند مسیرهای `..` را رد می‌کند: `UNSAFE_DEST`).

**می‌خواهم مود جدید اضافه کنم؟**
۱) یک آیتم به `MOD_DEFINITIONS` اضافه کن، ۲) به `TIER_MODS` سطح‌های مربوطه را اضافه کن، ۳) `MOD_LABEL`/`MOD_LABEL_SHORT` را پر کن، ۴) ترجمه‌ی `modXxx`/`modXxxDesc` را در `src/js/i18n.js` بنویس، ۵) پوشه‌ی `mod-files/<id>/` بساز.

**کاربر چطور مود را حذف می‌کند؟**
صفحه‌ی «مدیریت مودها» → از روی `manifest.json` هر فایل نصب‌شده را پاک می‌کند و اگر بکاپ داشته باشد، نسخه‌ی قبلی را برمی‌گرداند.

**فایل‌های بازی کاربر کجا بکاپ می‌شود؟**
`%APPDATA%\com.uhm.packinstaller\backups\<mod-id>\backup\<مسیر نسبی>.bak`
