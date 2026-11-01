# راه‌اندازی و مرز انتشار

## ۱. آماده‌سازی Supabase

هیچ پروژه‌ای به‌صورت خودکار ایجاد نشده است. یک پروژه مجاز و مناسب با دسترسی مالک تعیین کنید. با CLI رسمی و اتصال شخصی امن:

```sh
supabase link --project-ref YOUR_REAL_PROJECT_REF
supabase db push
supabase functions deploy api
```

نام/شناسه نمونه بالا ورودی موردنیاز اپراتور است، نه پروژه ساخته‌شده. secrets را در داشبورد یا CLI امن تنظیم کنید؛ در chat، Git، `.env` عمومی و `VITE_*` قرار ندهید.

سرور نیاز دارد:

- `LICENSE_SIGNING_JWK`: کلید خصوصی EC P-256.
- `LICENSE_PUBLIC_JWK`: بخش عمومی همان کلید، بدون `d`.
- `LICENSE_PEPPER`: حداقل ۳۲ بایت تصادفی؛ تغییر بدون مهاجرت، lookup کدهای قبلی را خراب می‌کند.
- `LICENSE_KEY_ID`: شناسه نسخه کلید.
- `LICENSE_ISSUER`: صادرکننده ثابت و معتبر.
- `ALLOWED_ORIGINS`: originهای پنل و Tauri، جداشده با کاما؛ مطابق origin واقعی Windows WebView تنظیم شود، نه wildcard.
- URL و service-role به‌عنوان secrets سرور؛ تابع از متغیرهای استاندارد Supabase استفاده می‌کند.

برای تولید امن کلید در دستگاه اپراتور: `npm run keys:generate`. خروجی خصوصی در مسیر خارج Git و فایل با دسترسی محدود ذخیره می‌شود؛ خودکار upload نمی‌شود. نگهداری و rotation جدا لازم است.

`verify_jwt=false` فقط برای امکان challenge و فعال‌سازی اولیه بدون حساب است؛ API خودش هویت مدیر و proof دستگاه را بررسی می‌کند. تغییر آن به معنی حذف نیاز به authorization نیست.

schema `uhm` باید در Exposed Schemas باشد تا service-role repository کار کند. مجوز schema/table/function برای anon و authenticated بسته است؛ کلاینت مستقیماً به این schema متصل نمی‌شود. Migration این grants و RLS را تنظیم می‌کند. schema exposed بدون grants/کنترل جایگزین private data نیست.

## ۲. ایجاد مدیر اول

ثبت‌نام عمومی مدیران را غیرفعال کنید. کاربر واقعی را در فرایند امن Auth ایجاد/دعوت کنید و شناسه واقعی‌اش را وارد membership نمایید:

```sql
-- شناسه را فقط از کاربر واقعی Auth بگیرید.
insert into uhm.admin_memberships(id, role) values ('REAL_AUTH_USER_UUID', 'owner');
```

MFA TOTP باید پیش از تغییرات مدیر ثبت و تأیید شود. برای bootstrap امن می‌توان با SDK رسمی روی دستگاه اپراتور، `auth.mfa.enroll` و سپس `challengeAndVerify` را اجرا کرد. پنل تغییرات بدون نشست `aal2` را رد می‌کند. UI ثبت/دعوت مدیر جدید و بازیابی عوامل هنوز در این نسخه نیست. مالک باید روش بازیابی کنترل‌شده و مدیر اضطراری داشته باشد؛ هرگز service-role را برای رفع مشکل داخل مرورگر نگذارید.

## ۳. تنظیمات عمومی Frontend

- `VITE_API_BASE=https://PROJECT.supabase.co/functions/v1/api`
- `VITE_SUPABASE_URL=https://PROJECT.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY`: فقط publishable key.

برای production همه URLها HTTPS و از originهای تأییدشده باشند. build این مقادیر را عمومی می‌کند. CSP در Pages و Tauri باید با endpoint نهایی هماهنگ بماند؛ دامنه سفارشی را آگاهانه به allowlist اضافه کنید.

Pages: خروجی `dist/`، فرمان `npm run build`، Node 22.12+. `_redirects` برای SPA و `_headers` برای هدرهای امنیتی همراه خروجی هستند. CSP در Vite dev عمداً متفاوت است چون HMR دارد.

## ۴. ساخت Native

متغیرهای عمومی build:

- `UHM_LICENSE_PUBLIC_JWK`، `UHM_LICENSE_ISSUER`، `UHM_LICENSE_KEY_ID`.
- همان متغیرهای `VITE_*` بالا.

کلید خصوصی سرور، service-role و pepper هرگز در GitHub Actions متغیر build دسکتاپ نباشند. workflow فقط public vars را دریافت می‌کند.

نسخه بدون public vars می‌تواند برای بررسی build ساخته شود، ولی نصب به دلیل نبود trust معتبر رد می‌شود. artifact workflow unsigned و مخصوص آزمایش است؛ انتشار عمومی یا release خودکار انجام نمی‌شود.

## ۵. نگهداری اجباری

- بکاپ فایل‌های بازی در `.uhm/transactions` برای بازیابی حفظ می‌شود و می‌تواند بزرگ شود. ابزار پاک‌سازی کاربرمحور هنوز وجود ندارد؛ قبل از حذف دستی، journal باید committed/rolled_back باشد و بکاپ بیرونی لازم تهیه شود. هرگز تراکنش applying/committing یا journal ناشناخته را حذف نکنید.
- تابع `uhm.cleanup_ephemeral()` را با scheduler مورد اعتماد منظم اجرا کنید.
- audit/reportها retention دارند و نیازمند سیاست حذف/آرشیو با نقش نگهداری محدودند؛ API امکان حذف audit به مدیر عادی نمی‌دهد.
- limiter فعلی Edge از bucket مشترک محافظه‌کارانه استفاده می‌کند؛ برای عرضه عمومی باید ingress قابل اعتماد و IP semantics مشخص یا limiter لبه اضافه و تست شود. هدر IP دلخواه کاربر قابل اعتماد نیست.
- repository فعلی برای overview و برخی lookupها داده را در صفحه‌های ۱۰۰۰تایی می‌خواند؛ پیش از مقیاس بالا lookupهای indexمحور و pagination سمت API لازم است.
- هشدار سهمیه، مانیتورینگ خطا، پشتیبان بیرونی رمزگذاری‌شده، بازیابی account/keys و تمرین restore را تنظیم کنید.
- بکاپ قدیمی ممکن است activation/revocation جدید را از دست بدهد؛ پیش از بازکردن صدور مجوز پس از restore، تطبیق تاریخچه لازم است.

## ۶. آزمون انتشار

۱. رقابت فعال‌سازی دو دستگاه، retry، تعلیق و reset روی API واقعی.
۲. خواندن مستقیم schema با publishable/anon باید رد شود.
۳. Viewer/Support و ادمین بدون MFA نباید mutation انجام دهند.
۴. Native روی Windows واقعی: grant معتبر، دستگاه دیگر، ساعت عقب، archive traversal، hash غلط، قطع شبکه، فایل قفل‌شده و کمبود فضا.
۵. خاموش‌کردن برنامه در مراحل نصب و commit و سپس recovery.
۶. ZIP/RAR/7z با ابزار بسته‌بندی‌شده و مجوزهای آن، شامل نام فارسی و مسیرهای case-insensitive.
۷. کنترل CSP و CORS روی دامنه نهایی و WebView.
۸. آزمون شبکه ISP هدف، حقوق محتوا و پشتیبانی/بازپرداخت.

پیش از پایان این موارد، محصول نباید با ادعای ضدکرک یا دسترس‌پذیری تضمین‌شده فروخته شود.
