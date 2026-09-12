> **به‌روزرسانی v2.0.0:** برنامه از Electron به **Tauri 2** مهاجرت کرده است. اشاره‌های این سند به `main.js`/`preload.js`/Electron مربوط به نسخه‌ی ۱ است؛ معادل آن‌ها اکنون در `src-tauri/src/` و `src/js/tauri-bridge.js` قرار دارد. جزئیات حجم و بیلد: [RELEASE-GUIDE.md](RELEASE-GUIDE.md).

# UHM Pack Installer — تحلیل فنی + وضعیت نهایی

> تاریخ: 2026-09-09
> شاخه: `arena/01a0884d-app`

---

## ۱. خلاصه

**UHM Pack Installer** یک اپ دسکتاپ Electron برای نصـب خودکار مودهای گرافیکی UHM در Assetto Corsa است.
در نسخهی فعلی:
- ویزارد کامل **۵ مرحله‌ای** پیاده‌سازی شده
- موتور نصب ZIP/RAR + کپی پوشه‌ی تودرتو با **بکاپ/بازگردانی** ساخته شده
- UI با فونت **Vazirmatn**، تم شب/روز، انیمیشن، Toast و Modal بهبود یافته
- معماری امن Electron (`contextIsolation`, `sandbox`, whitelist IPC) حفظ شده
- تست‌های واحد + اسموک تست رندر (`npm run check`) اضافه شده

---

## ۲. معماری

```
main.js                 → Main Process  (پنجره، IPC، نصب/حذف)
preload.js              → Bridge امن window.uhm
src/lib/installer.js    → موتور نصب مستقل از Electron (قابل تست)
src/js/                 → i18n، utils، modConfig، appState/ناوبری
src/pages/              → ۹ صفحه (showcase, settings, about, gamePath,
                          baseModsCheck, tierSelect, install, done, manageMods)
src/css/                → base.css (تم/انیمیشن/فونت) + pages.css
src/assets/             → فونت، تصاویر، icon.ico/png، mod-files
scripts/serve.js        → سرور پیش‌نمایش مرورگر (npm run serve)
scripts/check.js        → بررسی سلامت + تست‌ها (npm run check)
```

---

## ۳. چه چیزهایی از نسخه‌ی قبلی تکمیل/رفع شد

### باگ‌ها / مشکلات فنی
- ✅ نشت `setInterval` اسلایدشو رفع شد (cleanup در `destroy`)
- ✅ ترجمه‌های پراکنده به `i18n.js` متمرکز شدند
- ✅ `alert()` با Toast و Modal سفارشی جایگزین شد
- ✅ جستجوی خودکار Steam به همه‌ی درایوها + `libraryfolders.vdf` گسترش یافت
- ✅ اعتبارسنجی مسیر، `acs.exe` **یا** `assettocorsa.exe` را می‌پذیرد
- ✅ URL خارجی فقط `http/https` باز می‌شود
- ✅ ناوبری stack دار شد (`goBack` به جای back ساده)
- ✅ فونت `Vazirmatn` به صورت آفلاین باندل شد
- ✅ `icon.ico` ساخته و در `package.json` تنظیم شد
- ✅ `.gitignore` و `package-lock.json` اضافه شد
- ✅ `node_modules` و خروجی build از گیت خارج شدند
- ✅ CSP + `sandbox` برای Electron اضافه شد

### صفحات جدید / تکمیل‌شده
- ✅ `tierSelect` — انتخاب سطح (Low/Medium/High/VeryHigh/Ultra) با کارت‌های انیمیشنی
- ✅ `install` — نصب با نوار پیشرفت، گزارش، انصراف و بکاپ
- ✅ `done` — خلاصه‌ی نصب + دکمه‌های اقدام
- ✅ `manageMods` — لیست مودها + حذف/بازگردانی با تایید و اطلاع‌رسانی

### موتور نصب (`src/lib/installer.js`)
- 📦 کپی ساده‌ی پوشه‌ی تودرتو
- 📦 اکسترکت ZIP با پشتیبانی از مسیرهای unsafe-guard
- 📦 اکسترکت RAR/CBR (in-memory + نوشتن خودمان برای کنترل بکاپ)
- 💾 بکاپ فایل‌های قبلی به `backups/<mod>/backup/...`
- 🔄 بازگردانی بکاپ یا حذف در `uninstall:run`
- 🛡 محدودسازی مقصد داخل پوشه‌ی بازی (`isWithin`/`resolveInside`)

---

## ۴. وضعیت پیشرفت نسبت به README اولیه

| مرحله | وضعیت |
|---|---|
| اسکلت / پنجره / تم | ✅ |
| دوزبانگی RTL/LTR | ✅ |
| Showcase | ✅ |
| تنظیمات | ✅ |
| درباره ما | ✅ |
| انتخاب مسیر بازی | ✅ |
| بررسی CSP/PURE | ✅ |
| انتخاب سطح سیستم | ✅ |
| نصب خودکار ۷ مود | ✅ |
| صفحه پایانی | ✅ |
| مدیریت / حذف مودها | ✅ |
| فونت و زیبایی | ✅ |
| آیکون exe | ✅ |

> ⚠️ تنها مورد مربوط به **فایل‌های واقعی مودها** است: فایل‌های CSP/PURE/... کپی‌رایت دارند و نمی‌توان به‌صورت خودکار تولیدشان کرد. پوشه‌های `src/assets/mod-files/<mod>` آماده‌اند و برنامه اگر فایل‌ها غایب باشند، با وضعیت «⚠️ فایل مود موجود نیست» اعلام می‌کند.

---

## ۵. اجرا و تست

```bash
npm install
npm start            # Electron روی ویندوز
npm run serve        # پیش‌نمایش UI در مرورگر (http://localhost:4173)
npm run check        # syntax + assets + تست installer + تست renderer
npm run dist         # ساخت NSIS installer (Windows)
```

---

## ۶. جمع‌بندی

پروژه از یک «اسکلت ناقص» به یک **اپ قابل استفاده‌ی کامل** ارتقا یافت:
- همه‌ی صفحات ویزارد حاضرند
- نصب و حذف مودها با بکاپ/بازگردانی واقعی انجام می‌شود
- امنیت و معماری Electron رعایت شده
- تست خودکار برای بخش‌های حیاتی نوشته شده
- تجربه‌ی کاربری (فونت فارسی، انیمیشن، Toast، Modal، تم‌ها) بهبود محسوسی دارد

قدم بعدی اصلی فقط **اضافه‌کردن فایل‌های واقعی مودها** داخل پوشه‌های `assets/mod-files` است.
