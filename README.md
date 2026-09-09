# UHM Pack Installer

نصب‌کننده‌ی خودکار مودهای گرافیکی **UHM** برای بازی **Assetto Corsa** — ساخته‌شده با **Electron**.

---

## 🚀 اجرا (روی ویندوز خودت)

۱. **Node.js 18+** را نصب کن: https://nodejs.org

۲. در پوشه‌ی پروژه:
```bash
npm install
```

۳. اجرای حالت توسعه:
```bash
npm start
```

۴. ساخت فایل نصبی Windows (exe):
```bash
npm run dist
```
خروجی در پوشه‌ی `dist/` قرار می‌گیرد.

> اگر فقط می‌خواهی UI را در مرورگر ببینی (بدون Electron):
> ```bash
> npm run serve
> ```
> سپس `http://localhost:4173` را باز کن.

---

## ✅ وضعیت فعلی (تکمیل‌شده)

- ⭐ پنجره‌ی فریم‌لس، گردگوشه، قابل تغییر اندازه
- ⭐ تم شب/روز با ذخیره‌ی خودکار
- ⭐ زبان فارسی/انگلیسی با RTL/LTR کامل
- ⭐ صفحه‌ی Showcase با اسلایدشو و نقطه‌های تعاملی
- ⭐ تنظیمات (زبان، تم، مسیر بازی، اطلاعات نصب)
- ⭐ صفحه‌ی درباره ما با لینک‌های تماس
- ⭐ **وارد کردن مسیر بازی** (دستی + جستجوی خودکار Steam در همه‌ی درایوها)
- ⭐ **بررسی فایل‌های پایه** (CSP / PURE + تصمیم بازنویسی)
- ⭐ **انتخاب سطح سیستم** (Low / Medium / High / VeryHigh / Ultra)
- ⭐ **نصب خودکار مودها** با نوار پیشرفت، گزارش، انصراف و بکاپ‌گیری
- ⭐ **صفحه‌ی پایان** با خلاصه‌ی نصب
- ⭐ **مدیریت مودها** (حذف / بازگردانی با بکاپ)
- ⭐ موتور نصب **ZIP/RAR** + کپی پوشه‌ی تودرتو با بکاپ
- ⭐ فونت **Vazirmatn** همراه برنامه (آفلاین)
- ⭐ آیکون‌های **icon.ico / icon.png** (آماده‌ی بیلد)
- ⭐ **CSP** و **Context Isolation** امن برای Electron
- ⭐ تست‌های واحد + اسموک تست رندر (‎`npm run check`)

---

## 🗺 ساختار پروژه

```
main.js                     ← Main Process (پنجره، IPC، نصب/حذف)
preload.js                  ← Bridge امن window.uhm
src/
├── index.html
├── css/base.css            ← تم، فونت، دکمه، toast، modal، انیمیشن
├── css/pages.css           ← استایل صفحات
├── js/
│   ├── i18n.js             ← ترجمه‌ی متمرکز fa/en
│   ├── utils.js            ← توابع کمکی (escape، toast، confirm، date)
│   ├── modConfig.js        ← تعریف ۷ مود + سطوح سیستم
│   ├── app.js              ← appState، ناوبری با stack، bootstrap
│   └── browser-preview.js  ← شبیه‌ساز مرورگر برای npm run serve
├── lib/installer.js        ← موتور نصب مستقل و قابل تست
├── pages/
│   ├── showcase.js
│   ├── settings.js
│   ├── about.js
│   ├── gamePath.js
│   ├── baseModsCheck.js
│   ├── tierSelect.js
│   ├── install.js
│   ├── done.js
│   └── manageMods.js
└── assets/
    ├── fonts/              ← Vazirmatn (woff2)
    ├── images/             ← لوگو، آیکون، پس‌زمینه، showcase
    └── mod-files/          ← پوشه‌ی فایل‌های واقعی مودها (این‌جا قرار بده)
```

---

## 📦 محل قرار دادن فایل‌های مودها

هر مود باید داخل `src/assets/mod-files/<mod-id>` قرار بگیرد.
پوشه‌های پیش‌فرض:

| مود | پوشه |
|---|---|
| CSP | `src/assets/mod-files/csp` |
| PURE | `src/assets/mod-files/pure` |
| PP Filter | `src/assets/mod-files/ppfilter` |
| Chase Cam | `src/assets/mod-files/chasecam` |
| HUD | `src/assets/mod-files/hud` |
| SRP Light | `src/assets/mod-files/srp` |
| Video | `src/assets/mod-files/video` |

- اگر فایل‌ها در پوشه نباشند، نصب با وضعیت **⚠️ فایل مود موجود نیست** معلق می‌شود.
- پشتیبانی از فایل `.zip`، `.rar` و `.cbr` در `type: 'extract'` نیز وجود دارد.

---

## ⭐ نکات امنیتی و معماری

- `contextIsolation: true` + `nodeIntegration: false` + `sandbox: true`
- همه‌ی دسترسی‌های فایل‌سیستم از طریق `preload.js` (whitelist API)
- بررسی `https/http` قبل از باز کردن لینک خارجی
- مسیرهای مقصد در موتور نصب داخل پوشه‌ی بازی محدود شده‌اند (protection از path traversal)
- فایل‌های قبلی قبل از بازنویسی بکاپ می‌شوند و قابل بازگردانی هستند

---

## 🧪 تست‌ها

```bash
npm run check
```

اجرا می‌کند:
۱. بررسی سینتکس همه‌ی فایل‌های JS
۲. بررسی وجود فایل‌های ضروری (فونت، آیکون)
۳. تست واحد موتور نصب (`test/installer.test.js`)
۴. اسموک تست رندر صفحات (`test/renderer.test.js`)

---

## 🎯 نقشه‌ی راه بعدی

- [ ] افزودن فایل‌های واقعی مودها به پوشه‌های `mod-files`
- [ ] افزودن گزینه‌ی «انتخاب نسخه‌ی PURE» و گزینه‌های پیشرفته‌ی کاربر
- [ ] افزودن صفحه‌ی «تاریخچه‌ی نصب» و چند نسخه‌ی backup
- [ ] امضای کد برای توزیع Windows (code signing)
- [ ] آپدیت خودکار (auto-update) با electron-updater
