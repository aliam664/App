# UHM Launcher 0.1.0 — کاندید با آپدیت امضاشده

این انتشار **آزمایشی (prerelease)** است و جای legacy latest را نمی‌گیرد. کلید updater مستقل از لایسنس است؛ استفاده از آن به تنظیم دستی کلید توسط کاربر نیاز ندارد.

## دانلود

- فایل نصب: `UHM-Launcher-0.1.0-x64-setup.exe`، **16,442,533 bytes**.
- SHA-256: `e57d8d3abf17a1bffd34a6d5cdabd360a36c096700d3db600d01299acd1fd9f0`.
- امضای updater در `.exe.sig` و اطلاعات نسخه در `latest.json` ضمیمه‌اند.
- این امضا Authenticode نیست؛ تأیید SmartScreen یا گواهی ناشر ویندوز ادعا نمی‌شود.

نسخه‌های فاقد updater باید یک‌بار با این نسخه جایگزین شوند. پس از آن، دریافت پس‌زمینه و نصب روی خروج امن/اجرای بعدی بدون تأیید جدا انجام می‌شود؛ عملیات فعال و فرایند بازی مانع نصب‌اند. این binary delta نیست؛ فقط installer کوچک لانچر دریافت می‌شود، نه مودها و بازی.

## شواهد واقعی

- [Build و کیفیت 41522458902](https://github.com/aliam664/App/actions/runs/41522458902): ۱۳۰ تست واحد، ۳۱ تست Native، ۱۹ سناریوی مرورگر، audits و NSIS موفق.
- [انتشار 41523341912](https://github.com/aliam664/App/actions/runs/41523341912): API زنده، OIDC واقعی، امضا، انتشار و دانلود دوباره کامل فایل عمومی با اعتبارسنجی امضا/نسخه موفق.
- [Windows installed-upgrade 41523753287](https://github.com/aliam664/App/actions/runs/41523753287): نصب واقعی NSIS نسخه fixture 0.0.0، دریافت آپدیت عمومی 0.1.0، بستن پنجره واقعی، تعویق با فرایند کنترل‌شده acs.exe، نصب خودکار cache در اجرای بعدی، restart و حفظ settings/فایل محتوا همگی موفق.

فرایند acs.exe در این آزمون کپی cmd.exe سیستم بود، نه Assetto Corsa. آزمون‌ها از لایسنس مالک استفاده نکردند. بازی واقعی، تمام GUI تعاملی، انتقال یک لایسنس فعال و آپلودرهای کاربر در این run اعتبارسنجی نشده‌اند.

Source دقیق binary: `09ee6a4b52f3c793a6a56cdaba665defb5761daf`.

[گزارش کامل scope و موارد باقی‌مانده](https://github.com/aliam664/App/blob/arena/37af8e92-app/docs/release-readiness-audit-fa.md). موفقیت updater به معنی تکمیل کل specification یا انتشار تجاری نهایی نیست.
