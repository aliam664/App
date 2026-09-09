# 📦 راهنمای ساخت و انتشار EXE (ویندوز)

این راهنما برای ساخت فایل نصبی **UHM Pack Installer** روی ویندوز و انتشار آن در بخش **GitHub Releases** است.

> اگر روی ویندوز هستی، همه‌ی مراحل را می‌توانی مستقیم اجرا کنی.
> اگر روی لینوکس/مک هستی، از `npm run dist` هم می‌توانی استفاده کنی (ساخت ویندوز در برخی حالت‌ها ممکن است به Wine نیاز داشته باشد؛ راحت‌ترین راه، سیستم ویندوز است).

---

## ۱. پیش‌نیازها

| ابزار | نسخه | لینک |
|---|---|---|
| [Node.js](https://nodejs.org) | 18 یا بالاتر | https://nodejs.org |
| Git (اختیاری، برای انتشار) | جدیدترین | https://git-scm.com |
| GitHub CLI (اختیاری، برای انتشار) | جدیدترین | https://cli.github.com |
| **فایل‌های مود UHM** | — | داخل `src/assets/mod-files` قرار بگیرد |

---

## ۲. دریافت پروژه

اگر از گیت استفاده می‌کنی:

```powershell
git clone https://github.com/aliam664/App.git
cd App
```

اگر نه، فایل‌های پروژه را از گیت‌هاب دانلود و استخراج کن.

---

## ۳. قرار دادن فایل‌های مودها (خیلی مهم)

فایل‌های واقعی مودها را **قبل از بیلد** داخل پوشه‌ی صحیح بگذار، چون در نصب‌کننده بسته‌بندی می‌شوند:

```text
src/assets/mod-files/
├── csp/          ← Custom Shaders Patch
├── pure/         ← PURE
├── ppfilter/     ← PP Filter
├── chasecam/     ← Chase Cam
├── hud/          ← HUD
├── srp/          ← SRP Light
└── video/        ← Video
```

> هر مود می‌تواند پوشه‌ی تودرتو باشد. موتور نصب ساختار آن‌ها را حفظ می‌کند.
> اگر پوشه‌ای خالی باشد، هنگام نصب وضعیت «⚠️ فایل مود موجود نیست» نمایش داده می‌شود.

---

## ۴. نصب وابستگی‌ها

```
npm install
```

> اگر هنگام نصب، خطای «unable to verify the first certificate» یا SSL دیدی، معمولاً به‌خاطر دانلود باینری Electron است. در ویندوز معمولاً رخ نمی‌دهد؛ اما اگر دیدی:
> ```powershell
> $env:ELECTRON_SKIP_BINARY_DOWNLOAD="1"
> npm install
> npm install -D electron@31
> ```

---

## ۵. تست سلامت (اختیاری اما پیشنهادی)

```powershell
npm run check
```

خروجی موفق باید این باشد:

```text
✔ Syntax & assets OK
ALL TESTS PASSED
RENDERER TESTS PASSED
```

---

## ۶. ساخت فایل نصبی EXE

```powershell
npm run dist
```

خروجی در پوشه‌ی `dist/` ساخته می‌شود:

```text
dist/
├── UHM Pack Installer-1.0.0-x64.exe   ← همین فایل، نصب‌کننده‌ی NSIS
└── UHM Pack Installer-1.0.0-x64.exe.blockmap
```

### مشخصات نصب‌کننده

- **نام:** `UHM Pack Installer-1.0.0-x64.exe`
- **تارگت:** NSIS (نصب‌کننده‌ی استاندارد ویندوز)
- **آیکون:** از `src/assets/images/icon.ico`
- **ویژگی‌ها:** انتخاب پوشه‌ی نصب، میان‌بر دسکتاپ، میان‌بر منوی استارت
- فونت **وزیرمتن** داخل exe بسته‌بندی می‌شود (آفلاین)

---

## ۷. آزمون فایل نصب

1. فایل `dist/UHM Pack Installer-1.0.0-x64.exe` را اجرا کن.
2. برنامه را نصب کن.
3. اگر دسترسی لازم را داری، `npm run serve` را اجرا کن و `http://localhost:4173` را باز کن تا UI را بدون نصب واقعی ببینی.
4. اگر می‌خواهی نصب واقعی را تست کنی، مسیر Assetto Corsa را انتخاب کن و مراحل ویزارد را کامل کن.

---

## ۸. انتشار در GitHub Releases

### روش ۱: با GitHub CLI (سریع‌تر)

```powershell
# وارد حساب شو (اگر قبلاً وارد نشده‌ای)
gh auth login

# یک Release بساز و فایل exe را آپلود کن
gh release create v1.0.0 `
  "dist/UHM Pack Installer-1.0.0-x64.exe" `
  "dist/UHM Pack Installer-1.0.0-x64.exe.blockmap" `
  --repo "aliam664/App" `
  --title "UHM Pack Installer 1.0.0" `
  --notes "نسخه‌ی ۱.۰.۰ — نصب‌کننده‌ی خودکار مودهای UHM برای Assetto Corsa"
```

### روش ۲: از داخل GitHub (بدون CLI)

1. در مرورگر به `https://github.com/aliam664/App/releases` برو.
2. روی **Draft a new release** کلیک کن.
3. برچسب را مثلاً `v1.0.0` بگذار.
4. یک عنوان و توضیحات بنویس.
5. در بخش **Attach binaries**, فایل `dist/UHM Pack Installer-1.0.0-x64.exe` را بکش و رها کن.
6. روی **Publish release** کلیک کن.

### روش ۳: آپلود به یک Release موجود

```powershell
gh release upload <tag-name> "dist/UHM Pack Installer-1.0.0-x64.exe" --repo "aliam664/App"
```

---

## ۹. انتشار خودکار با GitHub Actions (اختیاری)

فایل نمونه `docs/build-release.yml.example` در پروژه آماده شده است. این workflow:

- روی سرور ویندوز گیت‌هاب اجرا می‌شود
- `npm ci` و `npm run check` و `npm run dist` را اجرا می‌کند
- خروجی `exe` را به‌صورت Artifact آپلود می‌کند
- اگر برچسب `v*` پوش شود، خودش یک GitHub Release می‌سازد

برای فعال‌سازی، به‌صورت دستی آن را در مسیر واقعی قرار بده:

```powershell
New-Item -ItemType Directory -Force .github/workflows
Copy-Item docs/build-release.yml.example .github/workflows/build-release.yml
git add .github/workflows/build-release.yml
git commit -m "Add CI workflow for Windows build"
git push origin arena/01a0884d-app
```

> ﴿نکته: اگر از GitHub App استفاده می‌کنی، باید در تنظیمات GitHub App دسترسی **Workflows** فعال باشد؛ وگرنه پوش این فایل رد می‌شود. این نسخه به‌صورت فایل نمونه نگه داشته شده تا بتوانی خودت با دسترسی مناسب فعالش کنی.﴾

---

## ۱۰. نکات عیب‌یابی

### الف) `npm run dist` خطای آیکون می‌دهد

مطمئن شو این فایل وجود دارد:

```text
src/assets/images/icon.ico
```

اگر نبود، از لوگو بساز:

```powershell
magick src/assets/images/logo.jpg -resize 256x256 src/assets/images/icon.ico
```

### ب) خروجی خالی است / فایل مود نصب نشد

فایل‌های مود را داخل `src/assets/mod-files/<mod-id>` گذاشته باش. برنامه برای پوشه‌ی خالی وضعیت «Missing» نشان می‌دهد.

### ج) فایل exe توسط Windows Defender مسدود می‌شود

- فایل را روی همه‌ی سیستم‌ها امتحان نکن؛ ابتدا دانلود از Releases و امضای کد (Code Signing) برای توزیع عمومی توصیه می‌شود.
- برای تست داخلی، می‌توانی فایل را از Properties → Unblock باز کنید.

---

## ۱۱. چک‌لیست نهایی پیش از انتشار

- [ ] فایل‌های مودها داخل `src/assets/mod-files` هستند
- [ ] `npm run check` با موفقیت اجرا شد
- [ ] `npm run dist` با موفقیت اجرا شد
- [ ] `dist/UHM Pack Installer-1.0.0-x64.exe` ساخته شد
- [ ] exe روی یک ویندوز واقعی تست شد
- [ ] فایل به GitHub Releases آپلود شد

---

## ۱۲. چرا در این محیط سندباکس نتوانستم خودم exe بسازم؟

- دانلود باینری ویندوز Electron از CDN گیت‌هاب (objects.githubusercontent.com) در این سندباکس با خطای TLS قطع می‌شود.
- توکن GitHub App این محیط اجازه‌ی ساخت/ویرایش `.github/workflows` را ندارد (`workflows` permission فعال نیست).

برای همین، بهترین و مطمئن‌ترین مسیر، بیلد و انتشار روی ویندوز (طبق راهنمای بالا) است.
