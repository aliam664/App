const translations = {
  fa: {
    appName: 'UHM Pack Installer',
    dir: 'rtl',
    showcase: {
      startInstall: 'شروع نصب',
      manageMode: 'مدیریت مودها'
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
      about: 'درباره ما'
    },
    about: {
      title: 'درباره ما',
      tagline: 'ساخته‌شده با ❤ برای جامعه‌ی Assetto Corsa فارسی',
      contactTitle: 'راه‌های ارتباطی:',
      telegramId: 'آیدی تلگرام',
      telegramChannel: 'کانال تلگرام',
      youtube: 'کانال یوتیوب'
    },
    common: {
      back: 'بازگشت',
      version: 'نسخه'
    }
  },
  en: {
    appName: 'UHM Pack Installer',
    dir: 'ltr',
    showcase: {
      startInstall: 'Start Installation',
      manageMode: 'Manage Mods'
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
      about: 'About Us'
    },
    about: {
      title: 'About Us',
      tagline: 'Made with ❤ for the Persian Assetto Corsa community',
      contactTitle: 'Contact:',
      telegramId: 'Telegram ID',
      telegramChannel: 'Telegram Channel',
      youtube: 'YouTube Channel'
    },
    common: {
      back: 'Back',
      version: 'Version'
    }
  }
};

function t(lang, path) {
  const parts = path.split('.');
  let node = translations[lang] || translations.fa;
  for (const p of parts) {
    if (node && Object.prototype.hasOwnProperty.call(node, p)) {
      node = node[p];
    } else {
      return path; // اگر ترجمه پیدا نشد، خود کلید برگردانده می‌شود (برای دیباگ)
    }
  }
  return node;
}

window.i18n = { t, translations };
