# 📂 راهنمای کامل پوشه‌ی `mods/` — پک گرافیکی ۵ حالته + افزونه‌ها + ساخت EXE

این سند مرجع رسمی جای‌گذاری محتواست. همه‌چیز بر اساس کد واقعی بک‌اند نوشته شده:
`src-tauri/src/installer.rs` (نصب)، `src-tauri/src/catalog.rs` (خواندن افزونه‌ها)، `src/pages/addons.js` (صفحه‌ی افزونه‌ها).

---

## ۱. نقشه‌ی کلی

```text
App/                                  ← ریشه‌ی پروژه
└── mods/                             ← همه‌ی محتوا اینجاست (کنار exe باندل می‌شود)
    ├── graphics/                     ← پک گرافیکی (یک واحد نصب)
    │   ├── common/                   ← اختیاری: برای همه‌ی ۵ سطح، اول کپی می‌شود
    │   ├── low/                      ← حالت ۱
    │   ├── medium/                   ← حالت ۲
    │   ├── high/                     ← حالت ۳
    │   ├── veryhigh/                 ← حالت ۴
    │   └── ultra/                    ← حالت ۵
    │       └── (آینه‌ی پوشه‌ی بازی)
    └── addons/                       ← افزونه‌های جانبی (هر تعداد)
        ├── _example-addon/           ← الگو (با _ شروع می‌شود → در برنامه مخفی است)
        └── hud-gas/                  ← نمونه‌ی یک افزونه‌ی واقعی
            ├── mod.json              ← اختیاری: نام/توضیح/نسخه/…
            ├── preview.png           ← عکس کارت در برنامه
            └── files/                ← آینه‌ی پوشه‌ی بازی
```

### مفهوم «آینه‌ی پوشه‌ی بازی» (مهم‌ترین قانون)

> هر پوشه‌ی منبع (`graphics/<سطح>/`، `graphics/common/`، `addons/<id>/files/`) **دقیقاً همان ساختار پوشه‌ی Assetto Corsa** را دارد و **عیناً روی ریشه‌ی بازی کپی می‌شود.**

`<AC>` = پوشه‌ی بازی، مثلاً `C:\Program Files (x86)\Steam\steamapps\common\assettocorsa`

| اگر این را بگذاری | این‌جا نصب می‌شود |
|---|---|
| `mods/graphics/ultra/dwrite.dll` | `<AC>\dwrite.dll` |
| `mods/graphics/ultra/extension/config/general.ini` | `<AC>\extension\config\general.ini` |
| `mods/graphics/ultra/extension/config-ext/pure/…` | `<AC>\extension\config-ext\pure\…` |
| `mods/graphics/ultra/system/cfg/video.ini` | `<AC>\system\cfg\video.ini` |
| `mods/graphics/ultra/system/cfg/ppfilters/UHM.ini` | `<AC>\system\cfg\ppfilters\UHM.ini` |
| `mods/graphics/ultra/apps/python/UHM_HUD/…` | `<AC>\apps\python\UHM_HUD\…` |
| `mods/addons/hud-gas/files/apps/python/GasHUD/…` | `<AC>\apps\python\GasHUD\…` |

---

## ۲. پک گرافیکی — ۵ حالت را کجا بریزم؟

### قدم‌به‌قدم
1. پک هر حالت را روی کامپیوتر خودت **اکسترکت** کن (ZIP/RAR نه!).
2. ببین فایل‌ها نسبت به ریشه‌ی بازی کجا می‌نشینند.
3. با همان ساختار داخل `mods/graphics/<سطح>/` بریز.

### مثال کامل برای حالت Ultra
```text
mods/graphics/ultra/
├── dwrite.dll                          ← CSP
├── extension/
│   ├── config/                         ← تنظیمات CSP
│   ├── config-ext/pure/                ← PURE + SRP
│   ├── lua/ …
│   └── weather/ …
├── system/cfg/
│   ├── video.ini                       ← تنظیمات ویدیو
│   ├── camera_onboard_free.ini         ← Chase Cam
│   └── ppfilters/UHM_Ultra.ini         ← PP Filter
└── apps/python/UHM_HUD/                ← HUD
```
همین کار را برای `low/`، `medium/`، `high/`، `veryhigh/` تکرار کن.

### `common/` — برای این‌که فایل تکراری نریزی (اختیاری)
اگر بخشی از پک (مثلاً کل CSP یا PURE) در هر ۵ حالت **یکسان** است، یک‌بار در `mods/graphics/common/` بگذار و در پوشه‌ی هر سطح فقط فایل‌های متفاوت (video.ini، PP filter…) را بگذار.

**ترتیب کپی:** اول `common/` بعد `<سطح>/` → **فایل هم‌نام در پوشه‌ی سطح همیشه برنده است.**

### قوانین پک گرافیکی

| قانون | توضیح |
|---|---|
| نام پوشه‌ها | دقیقاً `low` `medium` `high` `veryhigh` `ultra` `common` (حروف کوچک، `veryhigh` سرهم) |
| سطح بدون فایل | اگر کاربر سطحی را انتخاب کند که پوشه‌اش خالی است و `common` هم خالی باشد → وضعیت «فایل موجود نیست» (خطا نیست، چیزی هم نصب نمی‌شود) |
| فایل‌های نادیده‌گرفته‌شده | `.gitkeep`, `Thumbs.db`, `desktop.ini`, `.DS_Store` هرگز کپی نمی‌شوند |
| بکاپ | قبل از بازنویسی هر فایلِ موجود، **فقط اولین بار** نسخه‌ی اصلی کاربر در `%APPDATA%\com.uhm.packinstaller\backups\graphics\backup\<مسیر>.bak` ذخیره می‌شود؛ تعویض سطح بعدی بکاپ اصلی را خراب نمی‌کند |
| «CSP/PURE فعلی‌ام را نگه دار» | اگر کاربر در مرحله‌ی بررسی این را انتخاب کند، مسیرهای CSP (`dwrite.dll`, `extension/config`, `extension/lua`, …) یا PURE (`extension/config-ext/pure`, …) از کپی **حذف** می‌شوند؛ لیست دقیق در `BASE_MOD_PATHS` فایل `src/js/modConfig.js` |
| پیشرفت | نوار پیشرفت فایل‌به‌فایل است و نام فایل جاری را نشان می‌دهد |
| حذف | صفحه‌ی «مدیریت مودها» → همه‌ی فایل‌های نصب‌شده حذف و بکاپ‌ها برگردانده می‌شوند |

### چیپ‌های روی کارت هر سطح
متن «CSP · PURE · PP · …» روی کارت‌ها فقط **نمایشی** است و از `TIER_MODS` در `src/js/modConfig.js` می‌آید. اگر محتوای واقعی حالت‌هایت فرق دارد، آن جدول را ویرایش کن.

---

## ۳. افزونه‌ها (`mods/addons/`) — هر وقت خواستی چیزی اضافه کن

### ساخت یک افزونه‌ی جدید در ۴ قدم
1. پوشه‌ی `mods/addons/_example-addon/` را کپی کن و نامش را بگذار مثلاً `hud-gas`
   (فقط حروف انگلیسی، عدد، `-` `_` `.` — بدون فاصله؛ نام‌هایی که با `_` یا `.` شروع شوند مخفی‌اند).
2. فایل‌های افزونه را با ساختار آینه‌ی بازی داخل `files/` بریز.
3. یک عکس **`preview.png`** (یا `.jpg`/`.webp`، ترجیحاً ۱۶:۹، مثلاً ۱۲۸۰×۷۲۰) کنار آن بگذار.
4. `mod.json` را ویرایش کن (اختیاری — اگر نباشد نام پوشه نمایش داده می‌شود: `hud-gas` → «Hud Gas»).

```text
mods/addons/hud-gas/
├── mod.json
├── preview.png
└── files/
    └── apps/python/GasHUD/
        ├── GasHUD.py
        └── icon.png
```

### `mod.json` — همه‌ی فیلدها اختیاری‌اند
```json
{
  "name": { "fa": "نمایشگر گاز", "en": "Gas HUD" },
  "description": { "fa": "نمایش زنده‌ی گاز و ترمز", "en": "Live throttle & brake HUD" },
  "version": "1.2",
  "author": "UHM",
  "category": "hud",
  "requires": ["csp"],
  "recommendedTiers": ["high", "veryhigh", "ultra"],
  "order": 10,
  "preview": "preview.png"
}
```

| فیلد | نوع | کاربرد در برنامه |
|---|---|---|
| `name` | متن یا `{fa, en}` | عنوان کارت (اگر فقط یک زبان بدهی برای هر دو استفاده می‌شود) |
| `description` | متن یا `{fa, en}` | توضیح زیر عنوان (حداکثر ۳ خط نمایش) |
| `version` | متن/عدد | چیپ `v1.2` |
| `author` | متن | «سازنده: …» |
| `category` | متن | چیپ آبی (مثلاً hud, weather, sound, camera) |
| `requires` | لیست | چیپ‌های زرد «نیازمند csp» — فقط اطلاع‌رسانی |
| `recommendedTiers` | لیست از ۵ سطح | چیپ‌های سبز نام سطح‌ها |
| `order` | عدد | ترتیب نمایش (کوچک‌تر = بالاتر؛ پیش‌فرض ۱۰۰۰، بعد الفبایی) |
| `preview` | مسیر نسبی | اگر عکس نام دیگری دارد؛ وگرنه خودکار `preview.png/jpg/jpeg/webp/gif` |

### رفتار در برنامه
- دکمه‌ی **«مودهای جانبی»** در صفحه‌ی اصلی → کارت‌های عکس‌دار.
- هر کارت: عکس، نام، توضیح، چیپ‌ها، تعداد/حجم فایل‌ها، مسیرهای سطح بالای بازی (`apps/`, `extension/`…)، وضعیت (نصب‌شده / نصب‌نشده / فایل موجود نیست).
- دکمه‌ها: **نصب** (با نوار پیشرفت فایل‌به‌فایل) / **نصب مجدد** / **حذف** (بازگردانی بکاپ + پاک‌کردن پوشه‌های خالی).
- افزونه‌ی بدون فایل (پوشه‌ی `files/` خالی) نمایش داده می‌شود ولی دکمه‌اش غیرفعال است.
- افزونه‌ها مستقل از پک گرافیکی‌اند و در همان `manifest.json` با `kind: "addon"` ثبت می‌شوند.
- `mod.json` و `preview.png` **هرگز** داخل بازی کپی نمی‌شوند.

---

## ۴. از فایل خام تا EXE

### پیش‌نیاز (یک‌بار)
```powershell
winget install OpenJS.NodeJS.LTS
winget install Rustlang.Rustup
winget install Microsoft.VisualStudio.2022.BuildTools   # workload: Desktop development with C++
```

### مراحل
```powershell
git clone https://github.com/aliam664/App.git
cd App
git checkout arena/01a092d4-app
npm install

# ۱) محتوا را طبق بخش ۲ و ۳ داخل mods/ بریز

# ۲) تست
npm run check          # فرانت‌اند (شامل تست صفحه‌ی افزونه‌ها و پلن نصب)
npm run test:rust      # بک‌اند (نصب ۵ سطحی، exclude، افزونه‌ها، خواندن mod.json)
npm run dev            # اجرای واقعی — روی یک کپی از بازی امتحان کن

# ۳) ساخت EXE
npm run build
#   → src-tauri\target\release\bundle\nsis\UHM Pack Installer_2.0.0_x64-setup.exe

# ۴) انتشار
gh release create v2.0.0 "src-tauri\target\release\bundle\nsis\UHM Pack Installer_2.0.0_x64-setup.exe" --generate-notes
```

حجم exe ≈ **۵–۸ مگ + حجم فشرده‌ی `mods/`**. اگر `mods/` حجیم شد (>۵۰ مگ) از Git LFS استفاده کن:
`git lfs install && git lfs track "mods/**" && git add .gitattributes`

### بیلد خودکار (بدون نصب Rust)
`docs/build.yml.example` را به `.github/workflows/build.yml` کپی و push کن؛ گیت‌هاب exe را می‌سازد و برای تگ `v*` Release می‌گذارد.

---

## ۵. چک‌لیست قبل از بیلد

- [ ] `mods/graphics/low|medium|high|veryhigh|ultra/` هر کدام محتوای اکسترکت‌شده‌ی همان حالت
- [ ] هیچ ZIP/RAR داخل `mods/` نیست
- [ ] ساختار داخل هر پوشه = ساختار پوشه‌ی بازی (`system/cfg/…`, `extension/…`, `apps/…`)
- [ ] هر افزونه: `files/` پر + `preview.png` + (اختیاری) `mod.json` معتبر
- [ ] `npm run check` و `npm run test:rust` سبز
- [ ] `npm run dev` → صفحه‌ی افزونه‌ها کارت‌ها را با عکس نشان می‌دهد؛ نصب یک سطح روی کپی بازی درست است
- [ ] `npm run build` → exe ساخته شد

---

## ۶. سؤال‌های متداول

**می‌خواهم افزونه‌ای فقط در یک زیرپوشه‌ی خاص نصب شود؟**
همان مسیر را داخل `files/` بساز: `files/system/cfg/ppfilters/X.ini`.

**می‌توانم عکس preview را برای پک گرافیکی هم بگذارم؟**
کارت سطح‌ها از تصاویر ثابت `src/assets/images/tiers/*.webp` استفاده می‌کنند؛ برای عوض‌کردن، همان فایل‌ها را جایگزین کن.

**کاربر سطح را عوض می‌کند؛ فایل‌های سطح قبلی چه می‌شوند؟**
فایل‌های هم‌نام بازنویسی می‌شوند؛ بکاپ اصلی کاربر (از اولین نصب) دست‌نخورده می‌ماند. برای برگشت کامل به حالت قبل از UHM، از «مدیریت مودها → حذف» استفاده کند.

**فایل‌های داده کجا ذخیره می‌شوند؟**
`%APPDATA%\com.uhm.packinstaller\` → `settings.json`, `manifest.json`, `backups\`, `trash\`.
