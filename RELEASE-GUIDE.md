# 📦 راهنمای ساخت و انتشار EXE (ویندوز) — نسخه‌ی Tauri

این راهنما برای ساخت فایل نصبی **UHM Pack Installer** روی ویندوز است.
از نسخه‌ی ۲ به بعد برنامه روی **Tauri 2** ساخته می‌شود و به‌جای Electron از **WebView2** ویندوز استفاده می‌کند؛
به همین دلیل حجم فایل نصبی از ~۸۰ مگ (و ~۲۳۰ مگ بعد از نصب) به **حدود ۵ تا ۸ مگ** رسیده است.

---

## ۱. پیش‌نیازها (فقط برای ساخت)

| ابزار | نسخه | لینک |
|---|---|---|
| [Node.js](https://nodejs.org) | 18 یا بالاتر | https://nodejs.org |
| [Rust](https://rustup.rs) | stable (1.77+) | `winget install Rustlang.Rustup` یا https://rustup.rs |
| Visual Studio Build Tools | «Desktop development with C++» | https://visualstudio.microsoft.com/visual-cpp-build-tools/ |
| WebView2 Runtime | روی Win10/11 از قبل نصب است | https://developer.microsoft.com/microsoft-edge/webview2/ |
| **فایل‌های مود UHM** | — | داخل `mod-files/` قرار بگیرد |

> کاربر نهایی به هیچ‌کدام از این‌ها نیاز ندارد؛ فقط فایل `.exe` را اجرا می‌کند.
> اگر WebView2 روی سیستم کاربر نباشد (خیلی نادر)، نصب‌کننده خودش آن را دانلود و نصب می‌کند.

---

## ۲. دریافت پروژه

```powershell
git clone https://github.com/aliam664/App.git
cd App
```

---

## ۳. قرار دادن فایل‌های مودها (خیلی مهم)

فایل‌های واقعی مودها را **قبل از بیلد** داخل پوشه‌ی صحیح بگذار؛ این پوشه به‌عنوان *resource* کنار برنامه بسته‌بندی می‌شود:

```text
mod-files/
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
> **حجم مودها مستقیماً به حجم exe اضافه می‌شود** (NSIS آن‌ها را با LZMA فشرده می‌کند).

---

## ۴. نصب وابستگی‌ها

```powershell
npm install
```

(فقط `@tauri-apps/cli` و `linkedom` برای تست نصب می‌شود — وابستگی‌های Rust را خودِ Cargo هنگام بیلد می‌گیرد.)

---

## ۵. تست سلامت

```powershell
npm run check        # تست‌های فرانت‌اند (رندر صفحات، i18n، داده‌ی کتابخانه)
npm run test:rust    # تست‌های هسته‌ی Rust (نصب، RAR/ZIP، کتابخانه، تشخیص سخت‌افزار)
```

---

## ۶. اجرای برنامه در حالت توسعه

```powershell
npm run dev
```

پنجره‌ی واقعی برنامه با بک‌اند Rust باز می‌شود (اولین بار ۲ تا ۵ دقیقه کامپایل می‌کند؛ دفعات بعد چند ثانیه).

---

## ۷. ساخت فایل نصبی

```powershell
npm run build
```

خروجی:

```text
src-tauri/target/release/
├── uhm-pack-installer.exe                          ← باینری خام (~۴–۶ مگ)
└── bundle/nsis/
    └── UHM Pack Installer_2.0.0_x64-setup.exe      ← فایل نصبی برای انتشار
```

### حجم مورد انتظار

| فایل | حجم تقریبی (بدون مودها) |
|---|---|
| `uhm-pack-installer.exe` | ۴ – ۶ MB |
| `…_x64-setup.exe` (NSIS/LZMA) | **۵ – ۸ MB** |
| فضای اشغالی بعد از نصب | ~۸ MB |

اگر عدد خیلی بالاتر بود، اول `mod-files/` را چک کن — مودها داخل نصب‌کننده هستند.

---

## ۸. انتشار در GitHub Releases

### روش الف) با GitHub CLI

```powershell
gh release create v2.0.0 `
  "src-tauri/target/release/bundle/nsis/UHM Pack Installer_2.0.0_x64-setup.exe" `
  --repo aliam664/App --title "UHM Pack Installer v2.0.0" --generate-notes
```

### روش ب) از وب‌سایت

1. **Releases → Draft a new release**
2. Tag: `v2.0.0`
3. فایل `…_x64-setup.exe` را در **Attach binaries** بکش و رها کن.
4. **Publish release**

---

## ۹. بیلد خودکار با GitHub Actions (پیشنهادی)

فایل `docs/build.yml.example` را به `.github/workflows/build.yml` کپی کن و push کن.
هر push روی هر شاخه:

- تست‌های فرانت‌اند و Rust را روی لینوکس اجرا می‌کند
- روی `windows-latest` فایل نصبی می‌سازد و **حجم دقیق exe را در Summary** گزارش می‌کند
- برای تگ‌های `v*` به‌طور خودکار Release می‌سازد

> این فایل عمداً داخل `docs/` است چون توکن ربات دسترسی `workflows` نداشت؛ کپی کردنش یک ثانیه کار دارد.

---

## ۱۰. عیب‌یابی

### `error: linker link.exe not found`
Visual Studio Build Tools با workload «Desktop development with C++» نصب نشده. بعد از نصب، PowerShell را ببند و دوباره باز کن.

### `failed to run custom build command for unrar_sys`
همان مشکل بالا (کامپایلر C++ لازم است، چون کتابخانه‌ی unrar از سورس کامپایل می‌شود).

### پنجره‌ی خالی/سفید باز می‌شود
WebView2 Runtime نصب نیست: https://go.microsoft.com/fwlink/p/?LinkId=2124703

### `npm run dev` می‌گوید `tauri: command not found`
`npm install` را اجرا نکرده‌ای.

### درگ‌اند‌دراپ فایل کار نمی‌کند
مسیر فایل‌ها از رویداد بومی Tauri (`onDragDropEvent`) می‌آید نه از DOM. اگر برنامه را «Run as administrator» اجرا کرده‌ای، ویندوز اجازه‌ی درگ از پروسه‌های عادی به پروسه‌ی ادمین را نمی‌دهد — بدون ادمین اجرا کن.

---

## چک‌لیست قبل از انتشار

- [ ] فایل‌های مود داخل `mod-files/` قرار دارد
- [ ] `npm run check` و `npm run test:rust` سبز است
- [ ] `npm run build` با موفقیت اجرا شد
- [ ] فایل `…_x64-setup.exe` روی یک ویندوز تمیز نصب و اجرا شد
- [ ] حجم فایل نصبی منطقی است (۵–۸ مگ + مودها)
- [ ] Release در گیت‌هاب ساخته شد
