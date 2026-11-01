import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/500.css';
import '@fontsource/vazirmatn/700.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './style.css';
import { api, ApiError, supabase } from './api';
import { proof, native, invoke } from './device';
import {
  esc,
  icon,
  decorate,
  fa,
  date,
  size,
  badge,
  category,
  toast,
  handleError,
  modal,
  busy,
  empty,
  field,
} from './ui';
import { loginDialog, renderAdmin } from './admin';
import { ranks, type Tier, type PackageSpec } from '../../../packages/contracts/src/index';
import { listen } from '@tauri-apps/api/event';
type CatalogItem = Omit<PackageSpec, 'files' | 'steps'> & { size: number; file_count: number };
type PublicLicense = { id: string; tier: Tier; expires_at: string; device_thumbprint: string };
type Task = {
  id: string;
  name: string;
  phase: string;
  progress: number;
  bytes?: number;
  total?: number;
  error?: string;
};
const app = document.querySelector<HTMLDivElement>('#app')!;
let demo = false,
  online = true,
  page = 'discover',
  adminMode = location.pathname.startsWith('/admin'),
  adminToken = sessionStorage.getItem('uhm-admin') || '';
let catalog: CatalogItem[] = [],
  activeCategory = 'all',
  query = '',
  tierFilter = 'all';
let license: PublicLicense | null = null;
try {
  const cached = JSON.parse(localStorage.getItem('uhm-license') || 'null');
  if (
    cached &&
    ['normal', 'pro', 'vip'].includes(cached.tier) &&
    typeof cached.id === 'string' &&
    typeof cached.expires_at === 'string'
  )
    license = cached;
} catch {
  localStorage.removeItem('uhm-license');
}
let grant = localStorage.getItem('uhm-grant') || '';
let gamePath = localStorage.getItem('uhm-game-path') || '';
let installed: Record<string, { version: string; installed_at: string }> = {};
let tasks: Task[] = [];
let installing = false;
let language = localStorage.getItem('uhm-language') || 'fa';
let compact = localStorage.getItem('uhm-compact') === 'true';
const launcherNav = [
  ['discover', 'compass', 'کشف پکیج‌ها'],
  ['library', 'layers-2', 'کتابخانه من'],
  ['downloads', 'download', 'دانلود و نصب'],
];
const adminNav = [
  ['dashboard', 'layout-dashboard', 'نمای کلی'],
  ['licenses', 'key-round', 'لایسنس‌ها'],
  ['packages', 'package', 'پکیج‌ها'],
  ['versions', 'git-branch', 'نسخه‌ها'],
  ['devices', 'monitor', 'دستگاه‌ها'],
  ['logs', 'shield-check', 'رویدادها'],
];
function shell() {
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr';
  document.body.classList.toggle('compact', compact);
  const nav = adminMode ? adminNav : launcherNav;
  app.innerHTML = `<div class="app-shell"><aside class="sidebar"><a class="brand" href="/" aria-label="UHM Launcher"><span class="brand-mark">U<span>H</span>M<i></i></span><span class="brand-caption">DRIVE SOMETHING DIFFERENT</span></a><div class="workspace-label">${adminMode ? 'اتاق کنترل' : 'فضای راننده'}<span>01</span></div><nav aria-label="منوی اصلی">${nav.map(([id, i, t]) => `<button class="nav-item ${page === id ? 'active' : ''}" data-nav="${id}">${icon(i)}<span>${t}</span>${id === 'downloads' && tasks.length ? `<b>${fa(tasks.length)}</b>` : ''}</button>`).join('')}</nav>${!adminMode ? `<div class="game-tile"><div class="game-square">AC</div><div><b>Assetto Corsa</b><small>بازی منتخب شما</small></div>${icon('chevrons-up-down')}</div>` : ''}<div class="sidebar-bottom"><button class="nav-item ${page === 'settings' ? 'active' : ''}" data-nav="settings">${icon('settings-2')}تنظیمات</button><button class="nav-item" id="switch-mode">${icon(adminMode ? 'arrow-up-right' : 'sliders-horizontal')}${adminMode ? 'بازگشت به لانچر' : 'پنل مدیریت'}</button><div class="sidebar-version"><span>UHM PLATFORM</span><code>v0.1.0</code></div></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumbs">${icon(adminMode ? 'sliders-horizontal' : 'gamepad-2')}<span>${adminMode ? 'مدیریت سیستم' : 'لانچر'} <i>/</i> ${esc(nav.find((n) => n[0] === page)?.[2] || 'تنظیمات')}</span></div><div class="topbar-actions"><button class="icon-button mobile-menu" id="mobile-menu" aria-label="منوی بخش‌ها">${icon('menu')}</button><span class="connection ${online ? '' : 'offline'}"><i></i>${online ? 'متصل' : 'آفلاین'}</span><button class="icon-button" id="notifications" aria-label="تازه‌های انتشار">${icon('bell')}</button><button class="profile" id="profile"><span class="avatar">${adminMode ? 'A' : 'U'}</span><span>${adminMode ? 'مدیریت' : license ? 'رانندهٔ UHM' : 'رانندهٔ مهمان'}<small>${adminMode ? 'CONTROL PANEL' : license ? license.tier.toUpperCase() + ' MEMBER' : 'خوش آمدید'}</small></span>${icon('chevron-down')}</button></div></header>${demo ? `<div class="demo-strip">${icon('flask-conical')}محیط پیش‌نمایش · داده‌های محلی و ورود نمایشی · نصب واقعی فقط در نسخهٔ ویندوز <span>DEVELOPMENT</span></div>` : ''}<main id="content" tabindex="-1"></main><footer><span>ساخته‌شده برای لذت رانندگی.</span><span dir="ltr">UHM / ASSETTO CORSA COMMUNITY</span><button id="about">دربارهٔ پروژه ${icon('arrow-up-left')}</button></footer></div></div><div id="toasts" aria-live="polite"></div>`;
  document.querySelectorAll<HTMLButtonElement>('[data-nav]').forEach(
    (b) =>
      (b.onclick = () => {
        page = b.dataset.nav!;
        void render();
      }),
  );
  document.querySelector('#mobile-menu')!.addEventListener('click', () => {
    const d = modal(
      'بخش‌های برنامه',
      `<div class="mobile-links">${[...nav, ['settings', 'settings-2', 'تنظیمات']].map(([id, i, t]) => `<button class="nav-item" data-mobile-nav="${id}">${icon(i)}${esc(t)}</button>`).join('')}<button class="nav-item" id="mobile-switch">${icon('sliders-horizontal')}${adminMode ? 'بازگشت به لانچر' : 'پنل مدیریت'}</button></div>`,
    );
    d.querySelectorAll<HTMLButtonElement>('[data-mobile-nav]').forEach(
      (b) =>
        (b.onclick = () => {
          page = b.dataset.mobileNav!;
          d.close();
          void render();
        }),
    );
    d.querySelector('#mobile-switch')!.addEventListener('click', () => {
      d.close();
      document.querySelector<HTMLButtonElement>('#switch-mode')!.click();
    });
  });
  document.querySelector('#switch-mode')!.addEventListener('click', () => {
    if (!adminMode && !adminToken) {
      loginDialog(demo, (t) => {
        adminToken = t;
        sessionStorage.setItem('uhm-admin', t);
        adminMode = true;
        page = 'dashboard';
        history.pushState({}, '', '/admin');
        void render();
      });
      return;
    }
    adminMode = !adminMode;
    page = adminMode ? 'dashboard' : 'discover';
    history.pushState({}, '', adminMode ? '/admin' : '/');
    void render();
  });
  document
    .querySelector('#profile')!
    .addEventListener('click', () => (adminMode ? logoutDialog() : activateDialog()));
  document.querySelector('#notifications')!.addEventListener('click', () =>
    modal(
      'تازه‌های گاراژ',
      catalog.length
        ? `<div class="updates-list">${catalog
            .slice(0, 5)
            .map(
              (p) =>
                `<article><img src="${esc(p.image)}" alt=""><div><b>${esc(p.name)}</b><p>${esc(p.changelog)}</p><small>v${esc(p.version)} · ${date(p.released_at)}</small></div></article>`,
            )
            .join('')}</div>`
        : empty('هنوز خبری نیست', 'با انتشار پکیج، تغییرات اینجا دیده می‌شوند.'),
    ),
  );
  document
    .querySelector('#about')!
    .addEventListener('click', () =>
      modal(
        'برای دورِ بعدی',
        `<p>UHM یک لانچر مستقل برای مدیریت پکیج‌های Assetto Corsa است؛ با نصب مرحله‌ای، کنترل اشتراک و مدیریت محتوا.</p><p class="muted">نسخهٔ توسعه 0.1.0 — وابسته به سازندهٔ بازی نیست. استفاده و توزیع هر پکیج نیازمند مجوز صاحب محتواست.</p><div class="notice">در مرورگر هیچ فایل بازی تغییر نمی‌کند. موفقیت نصب تنها پس از تأیید موتور Native ثبت می‌شود.</div>`,
      ),
    );
  decorate();
}
async function render() {
  shell();
  const content = document.querySelector<HTMLElement>('#content')!;
  try {
    if (page === 'settings') {
      settings(content);
      return;
    }
    if (adminMode) {
      if (!adminToken) {
        content.innerHTML = empty(
          'ورود مدیر لازم است',
          'برای مشاهده و مدیریت داده‌ها وارد شوید.',
          'shield',
        );
        loginDialog(demo, (t) => {
          adminToken = t;
          sessionStorage.setItem('uhm-admin', t);
          void render();
        });
        return;
      }
      await renderAdmin(content, page, adminToken, render);
    } else if (page === 'discover') discover(content);
    else if (page === 'library') library(content);
    else downloads(content);
  } catch (e) {
    content.innerHTML = empty(
      'دریافت اطلاعات ممکن نشد',
      'اتصال یا نشست خود را بررسی کنید.',
      'wifi-off',
    );
    handleError(e);
  }
  decorate();
}
function discover(el: HTMLElement) {
  el.innerHTML = `<section class="discover-head"><div><p class="eyebrow">YOUR NEXT SESSION STARTS HERE</p><h1>رانندگی، یک تجربهٔ دیگر.</h1><p>پکیج‌های منتخب برای دنیایی که پشت فرمان می‌سازی.</p></div><span class="edition">THE GARAGE<br><b>VOL. 01 / 2026</b></span></section>
  <section class="feature"><img class="feature-image" src="/images/01.jpg" alt="خودروی قرمز در پارکینگ Assetto Corsa"><div class="feature-shade"></div><div class="feature-content"><div class="feature-kicker"><span class="line"></span>منتخب گاراژ <span>01 / 06</span></div><span class="feature-word" dir="ltr">AFTER<br>HOURS.</span><h2>وقتی شهر، پیست تو می‌شود.</h2><p>نورهای تازه. مسیرهای متفاوت. تجربه‌ای که<br>برای دور بعدی منتظرش بودی.</p><button class="button" id="feature-detail">کشف مجموعه ${icon('arrow-up-left')}</button><div class="feature-bottom"><span>ASSETTO CORSA</span><span>CURATED BY UHM</span></div></div><div class="feature-side" dir="ltr">A DIFFERENT KIND OF DRIVE — UHM COLLECTION</div></section>
  <section class="catalog-section"><div class="section-heading"><div class="heading-inline"><h2>گاراژ پکیج‌ها</h2><span class="count" id="result-count">${fa(catalog.length)} پکیج</span></div><div class="view-label">${icon('layout-grid')}با دقت انتخاب شده</div></div><div class="catalog-controls"><div class="tabs" role="tablist" aria-label="دسته‌بندی پکیج‌ها">${[['all', 'همه پکیج‌ها'], ...Object.entries(category)].map(([v, l]) => `<button role="tab" aria-selected="${activeCategory === v}" class="tab ${activeCategory === v ? 'selected' : ''}" data-category="${v}">${l}</button>`).join('')}</div><div class="catalog-search"><label class="search">${icon('search')}<input id="package-search" placeholder="پکیج مورد نظرت را پیدا کن…" value="${esc(query)}" aria-label="جست‌وجوی پکیج"></label><select id="tier-filter" aria-label="فیلتر سطح اشتراک"><option value="all">همه سطح‌ها</option>${['normal', 'pro', 'vip'].map((t) => `<option value="${t}" ${tierFilter === t ? 'selected' : ''}>${t.toUpperCase()}</option>`).join('')}</select></div></div><div class="package-grid" id="packages"></div></section>
  <section class="membership-banner"><div class="membership-number">03<span>LEVELS.<br>ONE GARAGE.</span></div><div><h3>${license ? 'عضویت تو، مسیرهای بیشتر.' : 'کلید گاراژت را فعال کن.'}</h3><p>${license ? 'وضعیت مجوز و زمان تمدید را در بخش اشتراک ببین.' : 'یک لایسنس، یک دستگاه؛ بدون ساخت حساب کاربری.'}</p></div><button class="button secondary" id="membership">${license ? 'مدیریت اشتراک' : 'فعال‌سازی لایسنس'} ${icon('arrow-left')}</button></section>`;
  const list = () => {
    const matches = catalog.filter(
      (p) =>
        (activeCategory === 'all' || p.category === activeCategory) &&
        (tierFilter === 'all' || p.tier === tierFilter) &&
        `${p.name} ${p.description} ${p.slug}`.toLowerCase().includes(query.toLowerCase()),
    );
    el.querySelector('#result-count')!.textContent = `${fa(matches.length)} پکیج`;
    el.querySelector('#packages')!.innerHTML = matches.length
      ? matches.map((p) => card(p)).join('')
      : empty('این گوشهٔ گاراژ خالی است', 'عبارت یا فیلتر دیگری را امتحان کن.', 'search-x');
    el.querySelectorAll<HTMLButtonElement>('[data-package]').forEach(
      (b) => (b.onclick = () => details(catalog.find((p) => p.id === b.dataset.package)!)),
    );
    decorate();
  };
  el.querySelectorAll<HTMLButtonElement>('[data-category]').forEach(
    (b) =>
      (b.onclick = () => {
        activeCategory = b.dataset.category!;
        el.querySelectorAll('[data-category]').forEach((t) => {
          t.classList.toggle('selected', t === b);
          t.setAttribute('aria-selected', String(t === b));
        });
        list();
      }),
  );
  el.querySelector('#package-search')!.addEventListener('input', (e) => {
    query = (e.target as HTMLInputElement).value;
    list();
  });
  el.querySelector('#tier-filter')!.addEventListener('change', (e) => {
    tierFilter = (e.target as HTMLSelectElement).value;
    list();
  });
  el.querySelector('#feature-detail')!.addEventListener('click', () =>
    catalog[1] ? details(catalog[1]) : undefined,
  );
  el.querySelector('#membership')!.addEventListener('click', activateDialog);
  list();
}
function card(p: CatalogItem) {
  const locked = !license || ranks[license.tier] < ranks[p.tier];
  return `<article class="package-card"><button class="card-image" data-package="${p.id}" aria-label="مشاهده ${esc(p.name)}"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">${badge(p.tier)}${installed[p.id] ? `<span class="installed-tag">${icon('check')}نصب‌شده</span>` : ''}<span class="card-open">${icon('arrow-up-left')}</span></button><div class="card-content"><div class="card-meta"><span>${category[p.category]}</span><code>v${esc(p.version)}</code></div><button class="card-title" data-package="${p.id}">${esc(p.name)}</button><p>${esc(p.description)}</p><div class="card-footer"><span>${p.size ? size(p.size) : `${fa(p.dependencies.length)} پیش‌نیاز`}</span><button class="text-button" data-package="${p.id}">${locked ? icon('lock-keyhole') : icon('arrow-down-to-line')}${locked ? 'بررسی دسترسی' : 'مشاهده و نصب'}</button></div></div></article>`;
}
function details(p: CatalogItem) {
  const locked = license && ranks[license.tier] < ranks[p.tier];
  const d = modal(
    p.name,
    `<img class="detail-image" src="${esc(p.image)}" alt="${esc(p.name)}"><div class="detail-meta">${badge(p.tier)}<span>${category[p.category]}</span><code>v${esc(p.version)}</code></div><p class="detail-description">${esc(p.description)}</p><div class="detail-facts"><div><small>آخرین انتشار</small><b>${date(p.released_at)}</b></div><div><small>حجم دانلود</small><b dir="auto">${size(p.size)}</b></div><div><small>تعداد فایل</small><b>${fa(p.file_count)}</b></div></div><h3>قبل از شروع</h3>${
      p.dependencies.length
        ? `<div class="dependency-list">${p.dependencies
            .map((id) => {
              const dep = catalog.find((p) => p.id === id);
              return `<span>${icon('git-branch')}${esc(dep?.name || 'پیش‌نیاز ناموجود')}${dep ? badge(dep.tier) : ''}</span>`;
            })
            .join('')}</div>`
        : '<p class="muted">این پکیج پیش‌نیاز دیگری ندارد.</p>'
    }<h3>تغییرات نسخه</h3><p class="muted preserve">${esc(p.changelog)}</p>${!native ? '<div class="notice">' + icon('monitor') + 'در مرورگر می‌توانی محتوا و دسترسی را بررسی کنی؛ نصب فایل تنها در برنامه ویندوز انجام می‌شود.</div>' : ''}<button class="button full" id="install">${!license ? 'ابتدا فعال‌سازی لایسنس' : locked ? 'نیازمند اشتراک ' + p.tier.toUpperCase() : installed[p.id] ? 'بررسی و نصب مجدد' : 'آماده‌سازی نصب'} ${icon(!license || locked ? 'key-round' : 'download')}</button>`,
    true,
  );
  d.querySelector<HTMLButtonElement>('#install')!.onclick = function () {
    if (!license) {
      d.close();
      activateDialog();
      return;
    }
    void busy(this as HTMLButtonElement, async () => {
      if (locked) throw new Error('سطح اشتراک فعلی اجازه نصب این پکیج را نمی‌دهد.');
      const plan = await api(
        '/install/plan',
        { ...(await proof('plan')), package_id: p.id },
        grant,
      );
      if (!native) {
        toast('دسترسی تأیید شد. برای اجرای نصب، این پکیج را در برنامه ویندوز باز کنید.');
        return;
      }
      if (!gamePath) throw new Error('ابتدا از تنظیمات، مسیر معتبر بازی را انتخاب کنید.');
      if (installing) throw new Error('یک نصب دیگر در حال اجراست؛ تا پایان آن صبر کنید.');
      installing = true;
      d.close();
      const batch: Task[] = plan.packages.map((item: any) => ({
        id: item.id,
        name: item.name,
        phase: 'در انتظار موتور نصب',
        progress: 0,
      }));
      tasks.push(...batch);
      page = 'downloads';
      await render();
      try {
        await invoke('install_plan', { token: plan.plan, grant });
        for (const item of batch) {
          item.phase = 'نصب تکمیل شد';
          item.progress = 100;
        }
        installed = await invoke('installed_packages');
        try {
          await api(
            '/install/report',
            {
              ...(await proof('report')),
              package_id: p.id,
              version: p.version,
              status: 'installed',
            },
            grant,
          );
        } catch {
          toast('نصب تأیید شد؛ گزارش آنلاین ارسال نشد و نتیجه در دستگاه محفوظ است.');
        }
      } catch (e) {
        for (const item of batch.filter((t) => t.progress < 100)) {
          item.phase = 'عملیات متوقف شد';
          item.error = String(e);
        }
        handleError(e);
      } finally {
        installing = false;
      }
      await render();
    });
  };
}
async function persistLicense(result: { license: PublicLicense; grant: string }) {
  if (native) await invoke('verify_offline_grant', { grant: result.grant });
  license = result.license;
  grant = result.grant;
  localStorage.setItem('uhm-license', JSON.stringify(license));
  localStorage.setItem('uhm-grant', grant);
}
function grantClaims(): { refresh_after: number; offline_until: number } | null {
  try {
    return JSON.parse(atob(grant.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
  } catch {
    return null;
  }
}
let refreshing = false;
async function refreshDueLicense() {
  if (
    !license ||
    !grant ||
    !online ||
    refreshing ||
    Number(grantClaims()?.refresh_after) > Date.now()
  )
    return;
  refreshing = true;
  try {
    await persistLicense(
      await api('/licenses/refresh', { license_id: license.id, ...(await proof('refresh')) }),
    );
  } catch (e) {
    if (e instanceof ApiError && e.code === 'LICENSE_INVALID') {
      license = null;
      grant = '';
      localStorage.removeItem('uhm-license');
      localStorage.removeItem('uhm-grant');
      toast('اشتراک معتبر نیست یا دستگاه توسط مدیر آزاد شده است. دوباره فعال‌سازی کنید.', true);
    }
    // A network failure does not discard a still-valid signed offline grant.
  } finally {
    refreshing = false;
  }
}
function activateDialog() {
  const d = modal(
    license ? 'اشتراک و مجوز دستگاه' : 'کلید گاراژت را وارد کن',
    `${license ? `<div class="license-card">${badge(license.tier)}<strong>عضویت ${license.tier.toUpperCase()}</strong><p>معتبر تا ${date(license.expires_at)}</p><small>مجوز آفلاین: ${offlineRemaining()}</small></div><button class="button full" id="refresh-license">${icon('refresh-cw')}تمدید مجوز آنلاین</button><div class="divider"></div>` : ''}<form id="activate-form">${field('کد لایسنس', '<input name="code" required minlength="16" maxlength="100" dir="ltr" autocomplete="off" placeholder="UHM-…">')}<button class="button full" type="submit">فعال‌سازی روی این دستگاه ${icon('arrow-left')}</button></form>${demo ? '<button class="text-button demo-activate" id="demo-license">استفاده از لایسنس آزمایشی Pro</button>' : ''}<p class="fine-print">فعال‌سازی اولیه آنلاین است. کد فقط به یک کلید دستگاه متصل می‌شود. تغییر دستگاه از طریق مدیر انجام می‌شود.</p>`,
  );
  async function save(result: any) {
    await persistLicense(result);
    d.close();
    toast('مجوز دستگاه با موفقیت ثبت شد.');
    await render();
  }
  d.querySelector<HTMLFormElement>('#activate-form')!.onsubmit = (e) => {
    e.preventDefault();
    void busy(d.querySelector('button[type=submit]')!, async () => {
      const code = String(new FormData(e.target as HTMLFormElement).get('code'));
      await save(await api('/licenses/activate', { code, ...(await proof('activate')) }));
    });
  };
  d.querySelector<HTMLButtonElement>('#demo-license')?.addEventListener('click', function () {
    void busy(this as HTMLButtonElement, async () => {
      const s = await api('/demo/license', {});
      await save(
        await api('/licenses/activate', { code: s.license, ...(await proof('activate')) }),
      );
    });
  });
  d.querySelector<HTMLButtonElement>('#refresh-license')?.addEventListener('click', function () {
    void busy(this as HTMLButtonElement, async () => {
      await save(
        await api('/licenses/refresh', { license_id: license!.id, ...(await proof('refresh')) }),
      );
    });
  });
}
function offlineRemaining() {
  try {
    const claims = JSON.parse(atob(grant.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
    return `${fa(Math.max(0, Math.ceil((claims.offline_until - Date.now()) / 86400000)))} روز باقی‌مانده (نمایش اطلاعات؛ اعتبارسنجی در Native)`;
  } catch {
    return 'نیازمند تمدید';
  }
}
function library(el: HTMLElement) {
  const entries = Object.entries(installed);
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow">YOUR COLLECTION / 02</p><h1>گاراژ شخصی تو.</h1><p class="muted">فقط نصب‌های تأییدشده توسط موتور محلی اینجا ثبت می‌شوند.</p></div><button class="button secondary" id="library-refresh">${icon('refresh-cw')}بررسی مجدد</button></div>${
    entries.length
      ? `<div class="package-grid">${entries
          .map(([id]) => catalog.find((p) => p.id === id))
          .filter(Boolean)
          .map((p) => card(p!))
          .join('')}</div>`
      : empty(
          'هنوز اولین دور را شروع نکردی',
          'از گاراژ پکیج‌ها یک مجموعه انتخاب کن. نصب در نسخهٔ ویندوز انجام می‌شود.',
          'layers-2',
        )
  }<div class="notice">${icon('folder-check')}مسیر فعلی: <code dir="ltr">${esc(gamePath || 'انتخاب نشده')}</code></div>`;
  el.querySelector('#library-refresh')!.addEventListener('click', () => {
    void (async () => {
      if (native) installed = await invoke('installed_packages');
      await render();
      toast(native ? 'وضعیت محلی خوانده شد.' : 'مرورگر به فایل‌های نصب‌شده دسترسی ندارد.');
    })().catch(handleError);
  });
  el.querySelectorAll<HTMLButtonElement>('[data-package]').forEach(
    (b) => (b.onclick = () => details(catalog.find((p) => p.id === b.dataset.package)!)),
  );
}
function downloads(el: HTMLElement) {
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow">TRANSFER STATION / 03</p><h1>از دانلود تا خط شروع.</h1><p class="muted">بررسی فایل، نصب مرحله‌ای و ثبت نتیجه؛ بدون موفقیت نمایشی.</p></div></div>${tasks.length ? `<div class="stack">${tasks.map((t) => `<article class="task"><div class="task-head">${icon(t.error ? 'triangle-alert' : t.progress === 100 ? 'circle-check' : 'download')}<div><h3>${esc(t.name)}</h3><p>${esc(t.phase)}</p></div><strong>${fa(Math.floor(t.progress))}٪</strong></div><progress max="100" value="${t.progress}"></progress>${t.bytes ? `<small dir="ltr">${size(t.bytes)} / ${size(t.total || 0)}</small>` : ''}${t.error ? `<div class="notice error">${esc(t.error)}</div>` : ''}</article>`).join('')}</div>` : empty('صف دانلود خالی است', 'با شروع نصب، پیشرفت واقعی دانلود و استخراج اینجا نمایش داده می‌شود.', 'download')}<div class="installer-flow">${[
    ['01', 'دریافت فایل'],
    ['02', 'بررسی SHA-256'],
    ['03', 'استخراج و بکاپ'],
    ['04', 'تأیید و ثبت'],
  ]
    .map(([n, t]) => `<div><code>${n}</code><span>${t}</span></div>`)
    .join('')}</div>`;
}
function settings(el: HTMLElement) {
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow">PREFERENCES / 04</p><h1>گاراژ، به سلیقهٔ تو.</h1><p class="muted">مسیر بازی، نمایش و اطلاعات اتصال را مدیریت کن.</p></div></div><div class="settings-layout"><section class="panel"><div class="section-heading"><h2>محل نصب بازی</h2>${icon('folder-open')}</div><p class="muted">پوشه‌ای را انتخاب کن که فایل acs.exe و پوشه content در آن قرار دارند.</p><div class="path-box"><code dir="ltr" id="game-path">${esc(gamePath || 'هنوز مسیری انتخاب نشده')}</code><button class="button secondary" id="choose-path">${icon('folder')}انتخاب پوشه</button></div><div class="notice">${icon('shield-check')}${native ? 'اعتبار مسیر در لایه Native بررسی می‌شود.' : 'در پیش‌نمایش مرورگر امکان دسترسی به پوشه بازی وجود ندارد.'}</div></section><section class="panel"><div class="section-heading"><h2>نمایش و دسترس‌پذیری</h2>${icon('sliders-horizontal')}</div><label class="setting-row"><div><b>چیدمان فشرده</b><p>فاصله‌های کمتر برای پنجره‌های کوچک‌تر</p></div><input id="compact" type="checkbox" ${compact ? 'checked' : ''}></label><label class="setting-row"><div><b>جهت نمایش</b><p>محتوا در این نسخه فارسی است؛ تغییر جهت برای بررسی چیدمان</p></div><select id="language"><option value="fa" ${language === 'fa' ? 'selected' : ''}>راست به چپ</option><option value="en" ${language === 'en' ? 'selected' : ''}>چپ به راست</option></select></label></section><section class="panel"><div class="section-heading"><h2>وضعیت اتصال</h2>${icon('radio')}</div><dl class="definition"><dt>محیط</dt><dd>${demo ? 'توسعه / داده محلی' : 'API عملیاتی'}</dd><dt>اجرای برنامه</dt><dd>${native ? 'دسکتاپ Tauri' : 'مرورگر / پیش‌نمایش'}</dd><dt>کلید خصوصی</dt><dd>${native ? 'محافظت‌شده توسط ویندوز' : 'WebCrypto آزمایشی در همین مرورگر'}</dd><dt>نسخه</dt><dd><code>0.1.0</code></dd></dl><button class="text-button" id="recover">${icon('folder-check')}بررسی و بازیابی نصب نیمه‌تمام</button><br><button class="text-button" id="check-api">${icon('refresh-cw')}بررسی اتصال</button></section></div>`;
  el.querySelector<HTMLButtonElement>('#choose-path')!.onclick = function () {
    void busy(this as HTMLButtonElement, async () => {
      if (!native) throw new Error('انتخاب مسیر واقعی فقط در برنامه ویندوز امکان‌پذیر است.');
      const { open } = await import('@tauri-apps/plugin-dialog');
      const path = await open({
        directory: true,
        multiple: false,
        title: 'پوشه Assetto Corsa را انتخاب کنید',
      });
      if (!path) return;
      const result = await invoke<{ path: string }>('set_game_path', { path });
      gamePath = result.path;
      localStorage.setItem('uhm-game-path', gamePath);
      toast('مسیر بازی اعتبارسنجی و ذخیره شد.');
      await render();
    });
  };
  el.querySelector('#compact')!.addEventListener('change', (e) => {
    compact = (e.target as HTMLInputElement).checked;
    localStorage.setItem('uhm-compact', String(compact));
    document.body.classList.toggle('compact', compact);
  });
  el.querySelector('#language')!.addEventListener('change', (e) => {
    language = (e.target as HTMLSelectElement).value;
    localStorage.setItem('uhm-language', language);
    void render();
  });
  el.querySelector<HTMLButtonElement>('#recover')!.addEventListener('click', function () {
    void busy(this, async () => {
      if (!native) throw new Error('بازیابی فایل‌ها فقط در نسخه ویندوز ممکن است.');
      const count = await invoke<number>('recover_installations');
      toast(`${fa(count)} نصب نیمه‌تمام بازیابی شد.`);
    });
  });
  el.querySelector('#check-api')!.addEventListener(
    'click',
    () =>
      void api('/health')
        .then(() => toast('ارتباط با API برقرار است.'))
        .catch(handleError),
  );
  decorate();
}
function logoutDialog() {
  const d = modal(
    'نشست مدیریت',
    `<p class="muted">با خروج، دسترسی این پنجره به پنل پایان می‌یابد.</p><button class="button full" id="logout">خروج از پنل</button>`,
  );
  d.querySelector('#logout')!.addEventListener('click', () => {
    adminToken = '';
    sessionStorage.removeItem('uhm-admin');
    void supabase?.auth.signOut();
    adminMode = false;
    page = 'discover';
    history.pushState({}, '', '/');
    d.close();
    void render();
  });
}
async function boot() {
  app.innerHTML =
    '<div class="boot"><span class="brand-mark">UHM</span><p>آماده برای دور بعدی…</p></div>';
  try {
    const health = await api('/health');
    demo = health.mode === 'demo';
    catalog = (await api('/catalog')).packages;
    localStorage.setItem('uhm-catalog', JSON.stringify(catalog));
  } catch {
    online = false;
    try {
      catalog = JSON.parse(localStorage.getItem('uhm-catalog') || '[]');
    } catch {
      catalog = [];
    }
  }
  if (native) {
    try {
      const settings = await invoke<{ game_path: string }>('get_settings');
      gamePath = settings.game_path || '';
      installed = await invoke('installed_packages');
    } catch (e) {
      handleError(e);
    }
    if (grant) {
      try {
        await invoke('verify_offline_grant', { grant });
      } catch (e) {
        handleError(e);
      }
    }
    await listen<{
      package_id: string;
      phase: string;
      progress: number;
      bytes?: number;
      total?: number;
    }>('install-progress', (e) => {
      const t = [...tasks]
        .reverse()
        .find((t) => t.id === e.payload.package_id && t.progress < 100 && !t.error);
      if (t) {
        Object.assign(t, e.payload);
        if (e.payload.phase === 'نصب تأیید شد') t.progress = 100;
        if (page === 'downloads' && !adminMode) {
          downloads(document.querySelector('#content')!);
          decorate();
        }
      }
    });
  }
  await refreshDueLicense();
  if (adminMode) page = 'dashboard';
  await render();
}
window.addEventListener('popstate', () => {
  adminMode = location.pathname.startsWith('/admin');
  page = adminMode ? 'dashboard' : 'discover';
  void render();
});
window.addEventListener('unhandledrejection', (e) => {
  e.preventDefault();
  handleError(e.reason);
});
window.addEventListener('online', () => {
  online = true;
  void refreshDueLicense().then(render);
});
window.addEventListener('offline', () => {
  online = false;
  void render();
});
setInterval(() => {
  if (!document.hidden) void refreshDueLicense();
}, 3600000);
void boot();
