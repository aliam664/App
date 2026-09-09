const translations = {
  fa: {
    appName: 'UHM Pack Installer',
    dir: 'rtl',
    common: {
      back: 'بازگشت',
      next: 'ادامه',
      cancel: 'انصراف',
      version: 'نسخه',
      backHome: 'بازگشت به خانه',
      confirm: 'تأیید',
      loading: 'در حال بارگذاری...',
      hide: 'مخفی',
      step1: 'مرحله ۱ از ۵',
      step2: 'مرحله ۲ از ۵',
      step3: 'مرحله ۳ از ۵',
      step4: 'مرحله ۴ از ۵',
      step5: 'مرحله ۵ از ۵',
      pageMissing: 'این بخش هنوز ساخته نشده است'
    },
    toast: {
      success: 'با موفقیت انجام شد',
      error: 'خطایی رخ داد',
      saved: 'ذخیره شد',
      invalidGamePath: 'این پوشه معتبر به نظر نمی‌رسد (acs.exe پیدا نشد).',
      theme: 'تم تغییر کرد',
      lang: 'زبان تغییر کرد'
    },
    window: {
      theme: 'تغییر تم',
      settings: 'تنظیمات',
      minimize: 'کوچک کردن',
      maximize: 'بزرگ کردن',
      close: 'بستن'
    },
    showcase: {
      startInstall: '🚀 شروع نصب',
      manageMode: '🗂 مدیریت مودها',
      subtitle: 'نصب خودکار مودهای گرافیکی UHM'
    },
    settings: {
      title: 'تنظیمات',
      language: 'زبان برنامه',
      theme: 'تم برنامه',
      night: 'شب',
      day: 'روز',
      gamePath: 'مسیر نصب بازی',
      change: 'تغییر',
      notSet: 'مشخص نشده',
      about: 'درباره ما',
      installInfo: 'اطلاعات آخرین نصب',
      installInfoNone: 'هنوز نصبی انجام نشده است',
      tier: 'سطح سیستم',
      lastInstall: 'آخرین نصب',
      modsCount: 'تعداد مودهای نصب‌شده'
    },
    about: {
      title: 'درباره ما',
      tagline: 'ساخته‌شده با 💙 برای جامعه‌ی Assetto Corsa فارسی',
      contactTitle: 'راه‌های ارتباطی:',
      telegramId: 'آیدی تلگرام',
      telegramChannel: 'کانال تلگرام',
      youtube: 'کانال یوتیوب'
    },
    gamePath: {
      title: 'مسیر نصب Assetto Corsa را مشخص کن',
      autoDetect: '🔍 جستجوی خودکار',
      browse: 'مرور...',
      placeholder: 'مسیری انتخاب نشده',
      validOk: '✅ مسیر معتبر است',
      invalidNoExe: '❌ فایل acs.exe در این مسیر پیدا نشد',
      invalidNoContent: '❌ پوشه content در این مسیر پیدا نشد',
      searching: 'در حال جستجو...',
      notFound: 'مسیر به‌صورت خودکار پیدا نشد. لطفاً دستی انتخاب کن.',
      continueBtn: 'ادامه',
      tip: 'مسیر پوشه‌ی اصلی Assetto Corsa را انتخاب کنید (پوشه‌ای که فایل acs.exe داخل آن است).'
    },
    baseModsCheck: {
      title: 'بررسی فایل‌های پایه بازی',
      checking: 'در حال بررسی مسیر بازی...',
      cspFound: '✅ Custom Shaders Patch (CSP) — نصب شده است',
      cspNotFound: '⬜ Custom Shaders Patch (CSP) — نصب نیست',
      pureFound: '✅ PURE — نصب شده است',
      pureNotFound: '⬜ PURE — نصب نیست',
      overwriteQuestion: 'نسخه‌ای از این قبلاً نصب شده. آیا با نسخه‌ی UHM بازنویسی شود؟',
      yes: 'بله، بازنویسی کن',
      no: 'خیر، حفظ کن',
      continueBtn: 'ادامه',
      noteInstalled: 'این مودها قبلاً موجودند؛ اگر نسخه‌ی UHM را انتخاب کنید، فایل‌های قبلی بکاپ می‌شوند.'
    },
    tierSelect: {
      title: 'سطح سیستم را انتخاب کن',
      subtitle: 'بر اساس قدرت سخت‌افزار، بهترین ترکیب گرافیکی را انتخاب می‌کنیم.',
      low: 'کم',
      medium: 'متوسط',
      high: 'بالا',
      veryhigh: 'خیلی بالا',
      ultra: 'فوق العاده',
      lowDesc: 'مناسب سیستم‌های ضعیف — کیفیت پایین، بالاترین FPS',
      mediumDesc: 'مناسب سیستم‌های متوسط — تعادل بین کیفیت و کارایی',
      highDesc: 'مناسب سیستم‌های قوی — کیفیت بالا',
      veryhighDesc: 'مناسب سیستم‌های حرفه‌ای — کیفیت بسیار بالا',
      ultraDesc: 'مناسب سیستم‌های قدرتمند — کیفیت نهایی',
      continueBtn: 'شروع نصب'
    },
    install: {
      title: 'در حال نصب مودها',
      preparing: 'در حال آماده‌سازی...',
      statusInstalled: 'نصب شد',
      statusMissing: 'فایل مود موجود نیست',
      statusError: 'خطا در نصب',
      statusSkipped: 'نسخه‌ی قبلی حفظ شد',
      statusPending: 'در انتظار',
      statusRunning: 'در حال نصب',
      cancelBtn: 'انصراف',
      cancelled: 'نصب متوقف شد',
      progress: 'پیشرفت',
      log: 'گزارش نصب',
      noteMissing: 'برخی مودها فایل ندارند. فایل‌های موردنیاز را در src/assets/mod-files قرار دهید.'
    },
    done: {
      title: 'نصب با موفقیت انجام شد',
      subtitle: 'مودهای گرافیکی UHM آماده‌ی استفاده هستند.',
      partialTitle: 'نصب تا حدی انجام شد',
      partialSubtitle: 'برخی مودها نصب شدند؛ موارد باقی‌مانده را بررسی کنید.',
      cancelledTitle: 'نصب متوقف شد',
      cancelledSubtitle: 'هیچ تغییری از این مرحله اعمال نشد.',
      errorTitle: 'نصب با خطا تمام شد',
      errorSubtitle: 'یک یا چند مود با خطا مواجه شدند. به گزارش نصب مراجعه کنید.',
      statusSuccess: 'موفق',
      statusPartial: 'ناقص',
      statusCancelled: 'لغو شد',
      statusError: 'خطا',
      tier: 'سطح سیستم',
      installedCount: 'مود نصب‌شده',
      missingCount: 'مود بدون فایل',
      errorCount: 'مود خطادار',
      skippedCount: 'مود حفظ‌شده',
      backHome: 'بازگشت به صفحه اصلی',
      manage: 'مدیریت مودها',
      note: 'برای تغییر یا حذف مودها از بخش مدیریت استفاده کنید.'
    },
    manageMods: {
      title: 'مدیریت مودها',
      empty: 'هنوز مودی نصب نشده است.',
      installed: 'نصب شده',
      missing: 'فایل ندارد',
      tier: 'سطح',
      date: 'تاریخ نصب',
      uninstall: 'حذف / بازگردانی',
      restore: 'بازگردانی به حالت قبل',
      deleteConfirmation: 'آیا این مود حذف / بازگردانی شود؟',
      confirmDelete: 'بله، اجرا کن',
      cancelDelete: 'خیر',
      files: 'فایل‌ها',
      versions: 'نسخه‌ها',
      noBackup: 'نسخه‌ی بکاپی موجود نیست و فایل‌های این مود حذف خواهند شد.',
      done: 'عملیات انجام شد',
      back: 'بازگشت'
    }
  },
  en: {
    appName: 'UHM Pack Installer',
    dir: 'ltr',
    common: {
      back: 'Back',
      next: 'Continue',
      cancel: 'Cancel',
      version: 'Version',
      backHome: 'Back to home',
      confirm: 'Confirm',
      loading: 'Loading...',
      hide: 'Hide',
      step1: 'Step 1 of 5',
      step2: 'Step 2 of 5',
      step3: 'Step 3 of 5',
      step4: 'Step 4 of 5',
      step5: 'Step 5 of 5',
      pageMissing: 'This page is not built yet'
    },
    toast: {
      success: 'Done successfully',
      error: 'An error occurred',
      saved: 'Saved',
      invalidGamePath: 'This folder does not look valid (acs.exe not found).',
      theme: 'Theme changed',
      lang: 'Language changed'
    },
    window: {
      theme: 'Toggle theme',
      settings: 'Settings',
      minimize: 'Minimize',
      maximize: 'Maximize',
      close: 'Close'
    },
    showcase: {
      startInstall: '🚀 Start Installation',
      manageMode: '🗂 Manage Mods',
      subtitle: 'Automatic UHM graphical mods installer'
    },
    settings: {
      title: 'Settings',
      language: 'Language',
      theme: 'Theme',
      night: 'Night',
      day: 'Day',
      gamePath: 'Game Install Path',
      change: 'Change',
      notSet: 'Not set',
      about: 'About Us',
      installInfo: 'Last install info',
      installInfoNone: 'No install yet',
      tier: 'System tier',
      lastInstall: 'Last install',
      modsCount: 'Installed mods'
    },
    about: {
      title: 'About Us',
      tagline: 'Made with 💙 for the Assetto Corsa community',
      contactTitle: 'Contact:',
      telegramId: 'Telegram ID',
      telegramChannel: 'Telegram Channel',
      youtube: 'YouTube Channel'
    },
    gamePath: {
      title: 'Select the Assetto Corsa install path',
      autoDetect: '🔍 Auto Detect',
      browse: 'Browse...',
      placeholder: 'No path selected',
      validOk: '✅ Valid path',
      invalidNoExe: '❌ acs.exe not found in this path',
      invalidNoContent: '❌ content folder not found in this path',
      searching: 'Searching...',
      notFound: 'Could not auto-detect the path. Please browse manually.',
      continueBtn: 'Continue',
      tip: 'Select the main Assetto Corsa folder (where acs.exe is located).'
    },
    baseModsCheck: {
      title: 'Checking base game files',
      checking: 'Checking game path...',
      cspFound: '✅ Custom Shaders Patch (CSP) — Installed',
      cspNotFound: '⬜ Custom Shaders Patch (CSP) — Not installed',
      pureFound: '✅ PURE — Installed',
      pureNotFound: '⬜ PURE — Not installed',
      overwriteQuestion: 'A version of this is already installed. Overwrite with the UHM version?',
      yes: 'Yes, overwrite',
      no: 'No, keep it',
      continueBtn: 'Continue',
      noteInstalled: 'These mods already exist; if you choose the UHM version, the previous files will be backed up.'
    },
    tierSelect: {
      title: 'Select your system tier',
      subtitle: 'Based on your hardware, we choose the best graphical combination.',
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      veryhigh: 'Very High',
      ultra: 'Ultra',
      lowDesc: 'For weak systems — lower quality, highest FPS',
      mediumDesc: 'For average systems — balance between quality and performance',
      highDesc: 'For powerful systems — high quality',
      veryhighDesc: 'For high-end systems — very high quality',
      ultraDesc: 'For top-tier systems — ultimate quality',
      continueBtn: 'Start Installation'
    },
    install: {
      title: 'Installing mods',
      preparing: 'Preparing...',
      statusInstalled: 'Installed',
      statusMissing: 'Mod files not found',
      statusError: 'Install error',
      statusSkipped: 'Previous version kept',
      statusPending: 'Pending',
      statusRunning: 'Installing',
      cancelBtn: 'Cancel',
      cancelled: 'Installation stopped',
      progress: 'Progress',
      log: 'Install log',
      noteMissing: 'Some mods have no files. Place required files in src/assets/mod-files.'
    },
    done: {
      title: 'Installation completed',
      subtitle: 'UHM graphical mods are ready to use.',
      partialTitle: 'Installation partially completed',
      partialSubtitle: 'Some mods were installed; check the remaining items.',
      cancelledTitle: 'Installation stopped',
      cancelledSubtitle: 'No changes were applied from this step.',
      errorTitle: 'Installation failed',
      errorSubtitle: 'One or more mods failed. Check the install log.',
      statusSuccess: 'Success',
      statusPartial: 'Partial',
      statusCancelled: 'Cancelled',
      statusError: 'Error',
      tier: 'System tier',
      installedCount: 'Installed mods',
      missingCount: 'Mods without files',
      errorCount: 'Failed mods',
      skippedCount: 'Kept mods',
      backHome: 'Back to home',
      manage: 'Manage Mods',
      note: 'Use the management section to change or remove mods.'
    },
    manageMods: {
      title: 'Manage Mods',
      empty: 'No mods installed yet.',
      installed: 'Installed',
      missing: 'No files',
      tier: 'Tier',
      date: 'Install date',
      uninstall: 'Remove / Restore',
      restore: 'Restore to previous state',
      deleteConfirmation: 'Should this mod be removed / restored?',
      confirmDelete: 'Yes, run it',
      cancelDelete: 'No',
      files: 'Files',
      versions: 'Versions',
      noBackup: 'No backup exists; files of this mod will be deleted.',
      done: 'Done',
      back: 'Back'
    }
  }
};

function t(lang, path) {
  const parts = String(path).split('.');
  let node = translations[lang] || translations.fa;
  for (const p of parts) {
    if (node && Object.prototype.hasOwnProperty.call(node, p)) {
      node = node[p];
    } else {
      return '';
    }
  }
  return node;
}

window.i18n = { t, translations };
