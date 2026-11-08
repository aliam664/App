import { appVersion } from './version';
import { readRoute, pageUrl } from './navigation';
import { updateStatusPanel } from './update-status';
import { recordEvent, flushEvents, pendingEvents } from './outbox';
import { licenseAdminSession } from './license-admin';
import { assetUrl, modeUrl, staticPreview, buildRevision } from './runtime';
import { localStore, sessionStore } from './storage';
import './style.css';
import { localLibrary, libraryPreferences } from './local-library';
import { downloadPreferences } from './download-preferences';
import './reference.css';
import './brand-theme.css';
import './console-design.css';
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
  paused?: boolean;
  active?: boolean;
  mode?: string;
  speed?: number;
  eta?: number;
  version?: string;
  started_at?: string;
  key?: string;
};
document.documentElement.dataset.theme =
  localStore.getItem('uhm-theme') === 'light' ? 'light' : 'dark';
const app = document.querySelector<HTMLDivElement>('#app')!;
let serviceMessage = '';
let demo = false,
  online = true,
  page = readRoute().page,
  adminMode = readRoute().admin,
  adminToken = sessionStore.getItem('uhm-admin') || '';
let catalog: CatalogItem[] = [],
  activeCategory = 'all',
  query = '',
  tierFilter = 'all';
let license: PublicLicense | null = null;
try {
  const cached = JSON.parse(localStore.getItem('uhm-license') || 'null');
  if (
    cached &&
    ['normal', 'pro', 'vip'].includes(cached.tier) &&
    typeof cached.id === 'string' &&
    typeof cached.expires_at === 'string' &&
    Date.parse(cached.expires_at) > Date.now()
  )
    license = cached;
} catch {
  localStore.removeItem('uhm-license');
}
let grant = localStore.getItem('uhm-grant') || '';
let gamePath = localStore.getItem('uhm-game-path') || '';
let installed: Record<string, { version: string; installed_at: string }> = {};
let tasks: Task[] = [];
try {
  tasks = JSON.parse(localStore.getItem('uhm-task-history') || '[]')
    .slice(-60)
    .map((t: Task) => ({
      ...t,
      active: false,
      ...(t.progress < 100 && !t.error
        ? { error: 'عملیات قبلی پایان نیافته؛ شروع مجدد با بررسی فایل موقت ممکن است.' }
        : {}),
    }));
} catch {
  tasks = [];
}
const persistTasks = () => localStore.setItem('uhm-task-history', JSON.stringify(tasks.slice(-60)));
let installing = false;
let renderGeneration = 0;
let language = localStore.getItem('uhm-language') === 'en' ? 'en' : 'fa';
let compact = localStore.getItem('uhm-compact') === 'true';
const launcherNav = [
  ['discover', 'compass', 'خانه'],
  ['content', 'package', 'دانلود محتوا'],
  ['library-settings', 'folder-cog', 'تنظیمات کتابخانه'],
  ['library', 'layers-2', 'کتابخانه من'],
  ['downloads', 'download', 'دانلود و نصب'],
];
const adminNav = [
  ['dashboard', 'layout-dashboard', 'نمای کلی'],
  ['licenses', 'key-round', 'لایسنس‌ها'],
  ['users', 'users', 'کاربران'],
  ['packages', 'package', 'پکیج‌ها'],
  ['versions', 'git-branch', 'نسخه‌ها'],
  ['devices', 'monitor', 'دستگاه‌ها'],
  ['analytics', 'layout-dashboard', 'تحلیل عملکرد'],
  ['errors', 'triangle-alert', 'مرکز خطاها'],
  ['team', 'shield-check', 'تیم و دسترسی‌ها'],
  ['service', 'radio', 'کنترل سرویس'],
  ['logs', 'shield-check', 'رویدادها'],
];

function brandMarkup() {
  return `<a class="brand" href="${modeUrl()}" aria-label="UHM Launcher"><img src="${assetUrl('/brand/logo.png')}" alt="لوگوی UHM"> UHM <small>v${appVersion}</small></a>`;
}
function demoStrip() {
  return demo
    ? `<div class="demo-strip">${icon('flask-conical')}${staticPreview ? 'پیش‌نمایش GitHub Pages · داده‌های آزمایشی فقط در مرورگر شما' : 'محیط پیش‌نمایش · داده‌های محلی و ورود نمایشی'} · نصب واقعی فقط در نسخهٔ ویندوز <span>DEVELOPMENT</span></div>`
    : '';
}
function footerMarkup() {
  return `<footer class="site-footer"><div class="footer-identity"><img src="${assetUrl('/brand/logo.png')}" alt=""><div><b>UHM GRAPHICS PACK</b>${staticPreview ? `<small class="build-revision" dir="ltr">PREVIEW / ${esc(buildRevision.slice(0, 7))}</small>` : ''}<span>ساخته‌شده توسط Ali369 · برای جامعهٔ Assetto Corsa</span></div></div><span class="connection ${online ? '' : 'offline'}"><i></i>${online ? 'متصل به سرویس' : 'حالت آفلاین'}</span><button id="about">دربارهٔ پروژه ${icon('arrow-up-left')}</button></footer>`;
}
function launcherShell(nav: string[][]) {
  return `<div class="launcher-shell"><a class="skip-link" href="#content">رفتن به محتوای صفحه</a><div class="reference-header"><header class="container nav">${brandMarkup()}<nav class="nav-links" aria-label="ناوبری اصلی">${nav.map(([id, , t]) => `<button class="${page === id ? 'current' : ''}" ${page === id ? 'aria-current="page"' : ''} data-nav="${id}">${t}${id === 'downloads' && tasks.length ? ` <b>${fa(tasks.length)}</b>` : ''}</button>`).join('')}<button class="${page === 'settings' ? 'current' : ''}" ${page === 'settings' ? 'aria-current="page"' : ''} data-nav="settings">تنظیمات</button></nav><div class="nav-actions"><button class="profile language-toggle" id="profile" aria-label="${license ? 'مدیریت اشتراک' : 'اشتراک و فعال‌سازی'}"><span class="language-orbit">${icon('key-round')}</span><span>${license ? license.tier.toUpperCase() + ' MEMBER' : 'لایسنس'}</span><span class="language-chevron">↗</span></button><button class="icon" id="theme" aria-label="تغییر تم">◐</button><button class="icon notification-button" id="notifications" aria-label="تازه‌های انتشار">${icon('bell')}</button><button class="menu-btn" id="mobile-menu" aria-label="منوی بخش‌ها" aria-expanded="false">${icon('menu')} منو</button></div></header></div>${demoStrip()}${serviceMessage ? `<div class="console-notice">${esc(serviceMessage)}</div>` : ''}<main class="launcher-content ${page === 'discover' ? 'is-discover' : ''}" id="content" tabindex="-1"></main>${footerMarkup()}<button class="mode-switch-access" id="switch-mode">${icon('sliders-horizontal')}پنل مدیریت</button></div><div id="toasts" aria-live="polite"></div>`;
}
function adminShell(nav: string[][]) {
  const groups = [
    ['فضای کاری', ['dashboard', 'licenses', 'users', 'devices']],
    ['مدیریت محتوا', ['packages', 'versions']],
    ['نظارت و کنترل', ['analytics', 'errors', 'team', 'service', 'logs']],
  ] as const;
  return `<div class="app-shell admin-shell"><a class="skip-link" href="#content">رفتن به محتوای صفحه</a><aside class="sidebar">${brandMarkup()}<div class="workspace-label">فضای مدیریت<span lang="en">CONTROL ROOM</span></div><nav aria-label="منوی اصلی">${groups
    .map(
      ([label, ids]) =>
        `<div class="nav-group"><p class="nav-group-label">${label}</p>${nav
          .filter(([id]) => (ids as readonly string[]).includes(id))
          .map(
            ([id, i, t]) =>
              `<button class="nav-item ${page === id ? 'active' : ''}" ${page === id ? 'aria-current="page"' : ''} ${id !== 'dashboard' ? 'hidden' : ''} data-nav="${id}">${icon(i)}<span>${t}</span></button>`,
          )
          .join('')}</div>`,
    )
    .join(
      '',
    )}</nav><div class="sidebar-bottom"><div class="workspace-identity">${icon('shield-check')}<div><b data-admin-role>مدیریت</b><small>دسترسی بر اساس مجوز حساب</small></div></div><button class="nav-item ${page === 'settings' ? 'active' : ''}" data-nav="settings">${icon('settings-2')}تنظیمات</button><button class="nav-item" id="switch-mode">${icon('arrow-up-right')}بازگشت به لانچر</button><div class="sidebar-version"><span>UHM PLATFORM</span><code>v${appVersion}</code></div></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumbs">${icon('sliders-horizontal')}<span>اتاق کنترل</span>${icon('chevron-left')}<strong>${esc(nav.find((n) => n[0] === page)?.[2] || 'تنظیمات')}</strong></div><div class="mobile-console-brand">${brandMarkup()}</div><div class="topbar-actions"><button class="icon-button mobile-menu" id="mobile-menu" aria-label="منوی بخش‌ها" aria-expanded="false">${icon('menu')}</button><button class="icon-button" id="theme" aria-label="تغییر تم">◐</button><button class="icon-button" id="notifications" aria-label="تازه‌های انتشار">${icon('bell')}</button><button class="profile" id="profile" aria-label="خروج از حساب مدیریت"><span class="avatar">${icon('shield-check')}</span><span><b data-admin-role>مدیریت</b><small lang="en">UHM WORKSPACE</small></span>${icon('chevron-down')}</button></div></header>${demoStrip()}${serviceMessage ? `<div class="console-notice">${esc(serviceMessage)}</div>` : ''}<main id="content" tabindex="-1"></main>${footerMarkup()}</div></div><div id="toasts" aria-live="polite"></div>`;
}
function navigate(next: string) {
  page = next;
  const url = pageUrl(page, adminMode);
  if (location.pathname + location.hash !== url) history.pushState({}, '', url);
  void render().then(() => {
    document.querySelector<HTMLElement>('#content')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
}
function shell() {
  document.documentElement.lang = 'fa';
  document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr';
  document.body.classList.toggle('compact', compact);
  const nav = adminMode ? adminNav : launcherNav;
  app.innerHTML = adminMode ? adminShell(nav) : launcherShell(nav);
  document.documentElement.dataset.theme =
    localStore.getItem('uhm-theme') === 'light' ? 'light' : 'dark';
  document.querySelector('.skip-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelector<HTMLElement>('#content')?.focus();
  });
  document.querySelector('#theme')?.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    localStore.setItem('uhm-theme', theme);
  });

  document.querySelectorAll<HTMLButtonElement>('[data-nav]').forEach(
    (b) =>
      (b.onclick = () => {
        navigate(b.dataset.nav!);
      }),
  );
  document.querySelector('#mobile-menu')!.addEventListener('click', () => {
    const d = modal(
      'بخش‌های برنامه',
      `<div class="mobile-links">${[...nav.filter(([id]) => !document.querySelector<HTMLButtonElement>(`[data-nav="${id}"]`)?.hidden), ['settings', 'settings-2', 'تنظیمات']].map(([id, i, t]) => `<button class="nav-item" data-mobile-nav="${id}">${icon(i)}${esc(t)}</button>`).join('')}<button class="nav-item" id="mobile-switch">${icon('sliders-horizontal')}${adminMode ? 'بازگشت به لانچر' : 'پنل مدیریت'}</button></div>`,
    );
    d.classList.add('drawer-dialog');
    const menuButton = document.querySelector('#mobile-menu')!;
    menuButton.setAttribute('aria-expanded', 'true');
    d.addEventListener('close', () => menuButton.setAttribute('aria-expanded', 'false'));
    d.setAttribute('aria-label', 'منوی بخش‌های UHM');
    d.querySelector('.modal-head h2')!.innerHTML =
      `<img src="${assetUrl('/brand/logo.png')}" alt=""> UHM <small>NAVIGATION</small>`;
    d.querySelectorAll<HTMLButtonElement>('[data-mobile-nav]').forEach(
      (b) =>
        (b.onclick = () => {
          d.close();
          navigate(b.dataset.mobileNav!);
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
        sessionStore.setItem('uhm-admin', t);
        adminMode = true;
        page = 'dashboard';
        history.pushState({}, '', modeUrl(true));
        void render();
      });
      return;
    }
    adminMode = !adminMode;
    page = adminMode ? 'dashboard' : 'discover';
    history.pushState({}, '', modeUrl(adminMode));
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
                `<article><img src="${esc(assetUrl(p.image))}" alt=""><div><b>${esc(p.name)}</b><p>${esc(p.changelog)}</p><small>v${esc(p.version)} · ${date(p.released_at)}</small></div></article>`,
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
        `<p>UHM یک لانچر مستقل برای مدیریت پکیج‌های Assetto Corsa است؛ با نصب مرحله‌ای، کنترل اشتراک و مدیریت محتوا.</p><p class="muted">نسخهٔ ${appVersion} — وابسته به سازندهٔ بازی نیست. استفاده و توزیع هر پکیج نیازمند مجوز صاحب محتواست.</p><div class="notice">در مرورگر هیچ فایل بازی تغییر نمی‌کند. موفقیت نصب تنها پس از تأیید موتور Native ثبت می‌شود.</div>`,
      ),
    );
  decorate();
}
async function render() {
  const generation = ++renderGeneration;
  shell();
  const content = document.querySelector<HTMLElement>('#content')!;
  content.setAttribute('aria-busy', 'true');
  if (adminMode)
    content.innerHTML =
      '<div class="page-loading" role="status">در حال دریافت اطلاعات اتاق کنترل…</div>';
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
          sessionStore.setItem('uhm-admin', t);
          void render();
        });
        return;
      }
      await renderAdmin(content, page, adminToken, render, () => generation === renderGeneration);
      if (generation !== renderGeneration) return;
    } else if (page === 'discover' || page === 'content') {
      discover(content);
      if (page === 'content') {
        const collection = content.querySelector('#package-catalog');
        content.querySelector('.reference-home')!.replaceChildren(collection!);
      }
    } else if (page === 'library') {
      await localLibrary(content);
      if (generation !== renderGeneration) return;
    } else if (page === 'library-settings') {
      await libraryPreferences(content, (path) => {
        gamePath = path;
        localStore.setItem('uhm-game-path', path);
      });
      if (generation !== renderGeneration) return;
    } else downloads(content);
  } catch (e) {
    if (generation !== renderGeneration) return;
    if (e instanceof ApiError && ['ADMIN_REQUIRED', 'ADMIN_LICENSE_DENIED'].includes(e.code)) {
      adminToken = '';
      sessionStore.removeItem('uhm-admin');
      sessionStore.removeItem('uhm-admin-mode');
    }
    content.innerHTML = empty(
      'دریافت اطلاعات ممکن نشد',
      'اتصال یا نشست خود را بررسی کنید.',
      'wifi-off',
    );
    content.insertAdjacentHTML(
      'beforeend',
      '<button class="button secondary retry-page" id="retry-page">تلاش دوباره</button>',
    );
    content.querySelector('#retry-page')!.addEventListener('click', () => void render());
    handleError(e);
  } finally {
    if (generation === renderGeneration) content.removeAttribute('aria-busy');
  }
  if (generation === renderGeneration) decorate();
}
function discover(el: HTMLElement) {
  el.innerHTML = `<div class="reference-home"><section class="hero feature" aria-label="معرفی UHM"><video class="hero-video" preload="metadata" aria-hidden="true" muted loop ${window.matchMedia('(prefers-reduced-motion: reduce)').matches ? '' : 'autoplay'} playsinline poster="${assetUrl('/brand/images/2ec1805b-df61-4db6-beed-1c8c08ac0ee5.jpg')}"><source src="${assetUrl('/brand/media/uhm-showcase.mp4')}" type="video/mp4"></video><div class="container hero-grid"><div class="hero-copy visible"><div class="eyebrow">UHM / ASSETTO CORSA / GRAPHICS CONFIG</div><img class="logo-plate" src="${assetUrl('/brand/logo.png')}" alt="UHM"><h1>گرافیک استو را<br><span class="hero-highlight">یک سطح بالاتر</span> ببر</h1><p class="hero-lead">UHM یک پکیج آمادهٔ تنظیمات بصری برای Assetto Corsa است؛ شامل Pure، CSP، PP Filter و Presetهای گرافیکی. از فعال‌سازی لایسنس تا دانلود و نصب مرحله‌ای، همه‌چیز در یک لانچر.</p><div class="hero-buttons"><button class="btn primary" id="browse-packages">↓ پکیج‌های UHM</button><button class="btn ghost" id="view-showcase">مشاهده نتیجه</button><button class="btn ghost" id="start-install">شروع نصب</button></div><div class="home-proof"><span>ASSETTO CORSA</span><span>PURE + CSP + PP FILTER</span><span>READY-TO-CONFIG</span></div><div class="stats"><div class="stat"><b>${fa(catalog.length)}</b><span>پکیج در کاتالوگ</span></div><div class="stat"><b>3</b><span>سطح اشتراک</span></div><div class="stat"><b>ZIP / RAR / 7z</b><span>فرمت‌های نصب</span></div></div></div><div class="hero-rail reveal visible"><img src="${assetUrl('/brand/images/2ec1805b-df61-4db6-beed-1c8c08ac0ee5.jpg')}" alt="نمای واقعی گرافیک UHM در Assetto Corsa"><small>REAL GAMEPLAY / ASSETTO CORSA</small></div></div><button class="hero-scroll" id="hero-scroll"><span>SCROLL TO EXPLORE</span><i aria-hidden="true">↓</i></button><div class="ticker" aria-hidden="true"><span>UHM GRAPHICS PACK <i>✦</i> PURE READY <i>✦</i> CONTENT MANAGER <i>✦</i> ALI369 <i>✦</i> UHM GRAPHICS PACK <i>✦</i></span></div></section>
  <section id="showcase" class="section"><div class="container"><div class="section-head"><div><div class="eyebrow">SHOWCASE</div><h2>ببین، بعد نصب کن.</h2></div><p>نمای واقعی پک UHM؛ همان ویدیو و همان تجربه‌ای که در سایت می‌بینی.</p></div><div class="video-shell"><video controls preload="none" poster="${assetUrl('/brand/images/830c39f4-b1ff-4d2b-94a0-7ea5549e7f28.jpg')}"><source src="${assetUrl('/brand/media/uhm-showcase.mp4')}" type="video/mp4"></video><div class="video-caption"><span><b>UHM / Showcase</b><br><small>Gameplay capture · Assetto Corsa</small></span><button class="btn ghost" id="showcase-packages">مشاهده پکیج‌ها ←</button></div></div></div></section>
  <section class="catalog-section section" id="package-catalog"><div class="container"><div class="section-head"><div><div class="eyebrow">UHM / COLLECTION</div><h2>پکیج‌های گرافیک و تجربهٔ رانندگی</h2></div><span class="count" id="result-count">${fa(catalog.length)} پکیج</span></div><div class="catalog-controls"><div class="tabs" role="tablist" aria-label="دسته‌بندی پکیج‌ها">${[['all', 'همه پکیج‌ها'], ...Object.entries(category)].map(([v, l]) => `<button role="tab" aria-selected="${activeCategory === v}" class="tab ${activeCategory === v ? 'selected' : ''}" tabindex="${activeCategory === v ? '0' : '-1'}" data-category="${esc(v)}">${esc(l)}</button>`).join('')}</div><div class="catalog-search"><label class="search">${icon('search')}<input id="package-search" placeholder="پکیج مورد نظرت را پیدا کن…" value="${esc(query)}" aria-label="جست‌وجوی پکیج"></label><select id="tier-filter" aria-label="فیلتر سطح اشتراک"><option value="all">همه سطح‌ها</option>${['normal', 'pro', 'vip'].map((t) => `<option value="${t}" ${tierFilter === t ? 'selected' : ''}>${t.toUpperCase()}</option>`).join('')}</select></div></div><div class="package-grid" id="packages"></div></div></section>
  <section class="section membership-section"><div class="container"><div class="download"><div><div class="eyebrow">YOUR ACCESS / UHM</div><h2>${license ? 'اشتراک تو، مسیرهای بیشتر.' : 'کلید گاراژت را فعال کن.'}</h2><p>${license ? 'وضعیت مجوز و زمان تمدید را در بخش اشتراک ببین.' : 'یک لایسنس، یک دستگاه؛ بدون ساخت حساب کاربری.'}</p><div class="home-proof"><span>NORMAL</span><span>PRO</span><span>VIP</span></div></div><button class="btn primary" id="membership">${license ? 'مدیریت اشتراک' : 'فعال‌سازی لایسنس'} ${icon('arrow-left')}</button></div></div></section>
  <section class="section"><div class="container"><div class="section-head"><div><div class="eyebrow">IN-GAME LOOKS</div><h2>نمای واقعی، بدون عکس استوک.</h2></div><p>تصاویر اصلی سایت UHM؛ ثبت‌شده در Assetto Corsa.</p></div><div class="looks" tabindex="0" role="region" aria-label="گالری تصاویر بازی">${[
    ['830c39f4-b1ff-4d2b-94a0-7ea5549e7f28', 'NIGHT RUN'],
    ['2ec1805b-df61-4db6-beed-1c8c08ac0ee5', 'LIGHTING'],
    ['c439ae92-1ebe-4683-9f65-8713cf560a28', 'DETAILS'],
    ['696b6a00-90f5-4d43-bc9a-5ee390368cb6', 'ROAD'],
  ]
    .map(
      ([image, label]) =>
        `<figure><img src="${assetUrl(`/brand/images/${image}.jpg`)}" alt="نمای ${label} در Assetto Corsa" loading="lazy"><figcaption>UHM / ${label}</figcaption></figure>`,
    )
    .join('')}</div></div></section></div>`;
  const list = () => {
    const matches = catalog.filter(
      (p) =>
        (activeCategory === 'all' || p.category === activeCategory) &&
        (tierFilter === 'all' || p.tier === tierFilter) &&
        `${p.name} ${p.description} ${p.slug} ${p.author || ''} ${p.brand || ''} ${(p.tags || []).join(' ')}`
          .toLowerCase()
          .includes(query.toLowerCase()),
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
          (t as HTMLButtonElement).tabIndex = t === b ? 0 : -1;
        });
        list();
      }),
  );
  el.querySelector('#package-search')!.addEventListener('input', (e) => {
    query = (e.target as HTMLInputElement).value;
    list();
  });
  el.querySelector('.tabs')!.addEventListener('keydown', (event) => {
    const e = event as KeyboardEvent;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const tabs = [...el.querySelectorAll<HTMLButtonElement>('[data-category]')];
    const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    e.preventDefault();
    const direction = document.documentElement.dir === 'rtl' ? -1 : 1;
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? tabs.length - 1
          : (current + (e.key === 'ArrowRight' ? direction : -direction) + tabs.length) %
            tabs.length;
    tabs[next].click();
    tabs.forEach((tab, index) => {
      tab.tabIndex = index === next ? 0 : -1;
    });
    tabs[next].focus();
  });
  el.querySelector('#tier-filter')!.addEventListener('change', (e) => {
    tierFilter = (e.target as HTMLSelectElement).value;
    list();
  });
  const scrollTo = (id: string) =>
    el.querySelector(id)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
      block: 'start',
    });
  for (const id of ['browse-packages', 'hero-scroll', 'showcase-packages'])
    el.querySelector('#' + id)?.addEventListener('click', () => scrollTo('#package-catalog'));
  el.querySelector('#view-showcase')?.addEventListener('click', () => scrollTo('#showcase'));
  el.querySelector('#start-install')?.addEventListener('click', () => {
    page = 'settings';
    void render();
    window.scrollTo(0, 0);
  });
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.querySelector<HTMLVideoElement>('.hero-video')?.pause();
  }
  el.querySelector('#membership')!.addEventListener('click', activateDialog);
  list();
}
function card(p: CatalogItem) {
  const locked = !license || ranks[license.tier] < ranks[p.tier];
  return `<article class="package-card"><button class="card-image" data-package="${p.id}" aria-label="مشاهده ${esc(p.name)}"><img src="${esc(assetUrl(p.image))}" alt="${esc(p.name)}" loading="lazy">${badge(p.tier)}${installed[p.id] ? `<span class="installed-tag">${icon('check')}نصب‌شده</span>` : ''}<span class="card-open">${icon('arrow-up-left')}</span></button><div class="card-content"><div class="card-meta"><span>${esc(category[p.category] || 'نامشخص')}</span><code>v${esc(p.version)}</code></div><button class="card-title" data-package="${p.id}">${esc(p.name)}</button><p>${esc(p.description)}</p><div class="card-footer"><span>${p.size ? size(p.size) : 'فایل متصل نشده'}</span><button class="text-button" data-package="${p.id}">${locked ? icon('lock-keyhole') : icon('arrow-down-to-line')}${locked ? 'بررسی دسترسی' : 'مشاهده و نصب'}</button></div></div></article>`;
}
function details(p: CatalogItem) {
  const locked = license && ranks[license.tier] < ranks[p.tier];
  const d = modal(
    p.name,
    `<img class="detail-image" src="${esc(assetUrl(p.image))}" alt="${esc(p.name)}"><div class="detail-meta">${badge(p.tier)}<span>${esc(category[p.category] || 'نامشخص')}</span><code>v${esc(p.version)}</code></div><p class="detail-description">${esc(p.description)}</p><div class="detail-facts"><div><small>آخرین انتشار</small><b>${date(p.released_at)}</b></div><div><small>حجم دانلود</small><b dir="auto">${p.size ? size(p.size) : 'فایل متصل نشده'}</b></div><div><small>تعداد فایل</small><b>${fa(p.file_count)}</b></div></div><h3>قبل از شروع</h3>${
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
      d.close();
      await executeNativePlan(plan, p);
    });
  };
}
async function executeNativePlan(
  plan: { plan: string; packages: { id: string; name: string; version: string }[] },
  p?: { id: string; version: string },
) {
  if (!native || !gamePath)
    throw new Error('برای نصب، مسیر معتبر بازی را در برنامه ویندوز انتخاب کنید.');
  if (installing) throw new Error('یک نصب دیگر در حال اجراست.');
  installing = true;
  adminMode = false;
  const started = new Date().toISOString();
  const batch: Task[] = plan.packages.map((item, index) => ({
    id: item.id,
    key: `${item.id}:${started}:${index}`,
    name: item.name,
    version: item.version,
    started_at: started,
    phase: 'در انتظار موتور نصب',
    progress: 0,
    active: true,
  }));
  tasks.push(...batch);
  persistTasks();
  page = 'downloads';
  await render();
  try {
    await invoke('install_plan', { token: plan.plan, grant });
    for (const item of batch.filter((t) => t.progress < 100 && !t.error)) {
      item.phase = 'نتیجهٔ این بسته دریافت نشد';
      item.error =
        'موتور نصب پایان یافت، اما تأیید تکمیل این بسته ارسال نشد؛ کتابخانه را بررسی کنید.';
    }
    installed = await invoke('installed_packages');
    if (p)
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
    for (const item of batch.filter((t) => t.progress < 100 && !t.error)) {
      item.phase = 'عملیات متوقف شد';
      item.error = String(e);
    }
    handleError(e);
  } finally {
    installing = false;
    for (const task of batch) task.active = false;
    persistTasks();
  }
  await render();
}
window.addEventListener('uhm-test-install', (e) => {
  void executeNativePlan((e as CustomEvent).detail).catch(handleError);
});
async function persistLicense(result: { license: PublicLicense; grant: string }) {
  if (native) await invoke('verify_offline_grant', { grant: result.grant });
  if (license?.id !== result.license.id && sessionStore.getItem('uhm-admin-mode') === 'license') {
    adminToken = '';
    sessionStore.removeItem('uhm-admin');
    sessionStore.removeItem('uhm-admin-mode');
  }
  license = result.license;
  grant = result.grant;
  localStore.setItem('uhm-license', JSON.stringify(license));
  localStore.setItem('uhm-grant', grant);
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
      localStore.removeItem('uhm-license');
      localStore.removeItem('uhm-grant');
      toast('اشتراک معتبر نیست یا دستگاه توسط مدیر آزاد شده است. دوباره فعال‌سازی کنید.', true);
    }
    // A network failure does not discard a still-valid signed offline grant.
  } finally {
    refreshing = false;
  }
}
function activateDialog() {
  if (installing) {
    toast('تا پایان نصب، لایسنس را تغییر ندهید.', true);
    return;
  }
  const d = modal(
    license ? 'اشتراک و مجوز دستگاه' : 'کلید گاراژت را وارد کن',
    `${license ? `<div class="license-card">${badge(license.tier)}<strong>عضویت ${license.tier.toUpperCase()}</strong><p>معتبر تا ${date(license.expires_at)}</p><small>مجوز آفلاین: ${offlineRemaining()}</small></div><button class="button full" id="refresh-license">${icon('refresh-cw')}تمدید مجوز آنلاین</button><div class="divider"></div>` : ''}<form id="activate-form">${field('کد لایسنس', '<input name="code" required minlength="16" maxlength="100" dir="ltr" autocomplete="off" placeholder="UHM-…">')}<button class="button full" type="submit">فعال‌سازی روی این دستگاه ${icon('arrow-left')}</button></form>${demo ? '<button class="text-button demo-activate" id="demo-license">استفاده از لایسنس آزمایشی Pro</button>' : ''}<p class="fine-print">فعال‌سازی اولیه آنلاین است. کد فقط به یک کلید دستگاه متصل می‌شود. تغییر دستگاه از طریق مدیر انجام می‌شود.</p>`,
  );
  async function save(result: any) {
    await persistLicense(result);
    d.close();
    void recordEvent('app_open', { stage: 'app' });
    try {
      adminToken = await licenseAdminSession();
      adminMode = true;
      page = 'dashboard';
      history.pushState({}, '', modeUrl(true));
      toast('لایسنس فعال شد؛ دسترسی مدیریت این دستگاه هم تأیید شد.');
    } catch {
      toast('مجوز دستگاه با موفقیت ثبت شد.');
    }

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
function downloads(el: HTMLElement) {
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow">TRANSFER STATION / 03</p><h1>از دانلود تا خط شروع.</h1><p class="muted">بررسی فایل، نصب مرحله‌ای و ثبت نتیجه؛ بدون موفقیت نمایشی.</p></div>${tasks.length && !installing ? '<button class="button secondary" id="clear-task-history">پاک کردن تاریخچه</button>' : ''}</div>${tasks.length ? `<div class="stack">${tasks.map((t) => `<article class="task"><div class="task-head">${icon(t.error ? 'triangle-alert' : t.progress === 100 ? 'circle-check' : 'download')}<div><h3>${esc(t.name)}${t.version ? ` <code>v${esc(t.version)}</code>` : ''}</h3><p>${esc(t.phase)}${t.started_at ? ` · ${date(t.started_at)}` : ''}</p></div><strong>${fa(Math.floor(t.progress))}٪</strong></div><progress max="100" value="${t.progress}"></progress>${t.bytes ? `<small dir="ltr">${size(t.bytes)} / ${size(t.total || 0)}</small>` : ''}${t.speed && t.active && !t.paused && !t.error ? `<small>${size(t.speed)}/s · ${fa(Math.ceil(t.eta || 0))} ثانیه تخمینی تا پایان دانلود</small>` : ''}${t.error ? `<div class="notice error">${esc(t.error)}</div><button class="button secondary" data-task-retry="${t.id}" ${catalog.some((p) => p.id === t.id) ? '' : 'disabled title="این بسته دیگر در کاتالوگ منتشرشده نیست؛ پیش‌نیازها فقط همراه بستهٔ اصلی تلاش مجدد می‌شوند."'}>بررسی و تلاش مجدد</button>` : t.progress < 100 && t.active ? `<div class="actions">${t.mode === 'download' ? `<button class="button secondary" data-task-control="${t.paused ? 'resume' : 'pause'}" data-task-id="${t.id}">${t.paused ? 'ادامه' : 'توقف دانلود'}</button>` : ''}<button class="text-button" data-task-control="cancel" data-task-id="${t.id}">لغو</button></div>` : ''}</article>`).join('')}</div>` : empty('صف دانلود خالی است', 'با شروع نصب، پیشرفت واقعی دانلود و استخراج اینجا نمایش داده می‌شود.', 'download')}<div class="installer-flow">${[
    ['01', 'دریافت فایل'],
    ['02', 'بررسی SHA-256'],
    ['03', 'استخراج و بکاپ'],
    ['04', 'تأیید و ثبت'],
  ]
    .map(([n, t]) => `<div><code>${n}</code><span>${t}</span></div>`)
    .join('')}</div>`;
  el.querySelector<HTMLButtonElement>('#clear-task-history')?.addEventListener('click', () => {
    if (installing) return;
    tasks = [];
    persistTasks();
    downloads(el);
    decorate();
  });
  el.querySelectorAll<HTMLButtonElement>('[data-task-control]').forEach(
    (b) =>
      (b.onclick = () => {
        void busy(b, async () => {
          const id = b.dataset.taskId!;
          const action = b.dataset.taskControl!;
          if (action === 'cancel') {
            const d = modal(
              'لغو عملیات',
              '<p>نصب ناتمام rollback می‌شود؛ فایل دانلود موقت برای تلاش مجدد باقی می‌ماند.</p><button class="button" id="cancel-job-confirm">تأیید لغو</button>',
            );
            d.querySelector<HTMLButtonElement>('#cancel-job-confirm')!.onclick = function () {
              void busy(this as HTMLButtonElement, async () => {
                await invoke('control_job', { packageId: id, action });
                d.close();
                toast('درخواست لغو ثبت شد؛ منتظر توقف امن عملیات بمانید.');
              });
            };
            return;
          }
          const result = await invoke<{ paused: boolean }>('control_job', {
            packageId: id,
            action,
          });
          const task = [...tasks]
            .reverse()
            .find((t) => t.id === id && !t.error && t.progress < 100);
          if (task) task.paused = result.paused;
          persistTasks();
          downloads(el);
          decorate();
        });
      }),
  );
  el.querySelectorAll<HTMLButtonElement>('[data-task-retry]').forEach(
    (b) =>
      (b.onclick = () => {
        const p = catalog.find((p) => p.id === b.dataset.taskRetry);
        if (p) details(p);
      }),
  );
}
function settings(el: HTMLElement) {
  // Native settings are loaded asynchronously; no browser filesystem simulation.
  queueMicrotask(() => {
    void downloadPreferences(el).catch(handleError);
    void updateStatusPanel(el).catch(handleError);
  });
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow">PREFERENCES / 04</p><h1>گاراژ، به سلیقهٔ تو.</h1><p class="muted">مسیر بازی، نمایش و اطلاعات اتصال را مدیریت کن.</p></div></div><div class="settings-layout"><section class="panel"><div class="section-heading"><h2>محل نصب بازی</h2>${icon('folder-open')}</div><p class="muted">پوشه‌ای را انتخاب کن که فایل acs.exe و پوشه content در آن قرار دارند.</p><div class="path-box"><code dir="ltr" id="game-path">${esc(gamePath || 'هنوز مسیری انتخاب نشده')}</code><button class="button secondary" id="choose-path">${icon('folder')}انتخاب پوشه</button></div><div class="notice">${icon('shield-check')}${native ? 'اعتبار مسیر در لایه Native بررسی می‌شود.' : 'در پیش‌نمایش مرورگر امکان دسترسی به پوشه بازی وجود ندارد.'}</div></section><section class="panel"><div class="section-heading"><h2>نمایش و دسترس‌پذیری</h2>${icon('sliders-horizontal')}</div><label class="setting-row"><div><b>چیدمان فشرده</b><p>فاصله‌های کمتر برای پنجره‌های کوچک‌تر</p></div><input id="compact" type="checkbox" ${compact ? 'checked' : ''}></label><label class="setting-row"><div><b>جهت نمایش</b><p>محتوا در این نسخه فارسی است؛ تغییر جهت برای بررسی چیدمان</p></div><select id="language"><option value="fa" ${language === 'fa' ? 'selected' : ''}>راست به چپ</option><option value="en" ${language === 'en' ? 'selected' : ''}>چپ به راست</option></select></label></section><section class="panel"><div class="section-heading"><h2>وضعیت اتصال</h2>${icon('radio')}</div><dl class="definition"><dt>محیط</dt><dd>${demo ? 'توسعه / داده محلی' : 'API عملیاتی'}</dd><dt>اجرای برنامه</dt><dd>${native ? 'دسکتاپ Tauri' : 'مرورگر / پیش‌نمایش'}</dd><dt>کلید خصوصی</dt><dd>${native ? 'محافظت‌شده توسط ویندوز' : 'WebCrypto آزمایشی در همین مرورگر'}</dd><dt>نسخه</dt><dd><code>${appVersion}</code></dd></dl><button class="text-button" id="recover">${icon('folder-check')}بررسی و بازیابی نصب نیمه‌تمام</button><br><button class="text-button" id="check-api">${icon('refresh-cw')}بررسی اتصال</button><br><button class="text-button" id="copy-diagnostics">${icon('scroll-text')}کپی گزارش تشخیصی بدون اطلاعات خصوصی</button></section></div>`;
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
      localStore.setItem('uhm-game-path', gamePath);
      toast('مسیر بازی اعتبارسنجی و ذخیره شد.');
      await render();
    });
  };
  el.querySelector('#compact')!.addEventListener('change', (e) => {
    compact = (e.target as HTMLInputElement).checked;
    localStore.setItem('uhm-compact', String(compact));
    document.body.classList.toggle('compact', compact);
  });
  el.querySelector('#language')!.addEventListener('change', (e) => {
    language = (e.target as HTMLSelectElement).value;
    localStore.setItem('uhm-language', language);
    void render();
  });
  el.querySelector<HTMLButtonElement>('#copy-diagnostics')!.addEventListener('click', function () {
    void busy(this as HTMLButtonElement, async () => {
      const report = {
        version: appVersion,
        runtime: native ? 'windows-native' : 'browser',
        online,
        pending_events: (await pendingEvents()).length,
        generated_at: new Date().toISOString(),
      };
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      toast('گزارش تشخیصی کپی شد؛ مسیر فایل، لایسنس و کلیدها در آن نیست.');
    });
  });
  el.querySelector<HTMLButtonElement>('#recover')!.addEventListener('click', function () {
    void busy(this as HTMLButtonElement, async () => {
      if (!native) throw new Error('بازیابی فایل‌ها فقط در نسخه ویندوز ممکن است.');
      const count = await invoke<number>('recover_installations');
      const conflicts = await invoke<
        {
          package_id: string;
          state: string;
          conflicts: { target: string; reason: string; backup: string }[];
        }[]
      >('recovery_status');
      if (conflicts.length) {
        modal(
          'فایل‌های نیازمند بررسی',
          `<p>${fa(count)} ژورنال بررسی شد. فایل‌هایی که بعد از نصب تغییر کرده بودند حفظ شدند و خودکار بازنویسی نشدند.</p>${conflicts.map((c) => `<h3>${esc(c.package_id)}</h3>${c.conflicts.map((f) => `<div class="setting-row"><code dir="ltr">${esc(f.target)}</code><span>${esc(f.reason)} · بکاپ: <code dir="ltr">${esc(f.backup)}</code></span></div>`).join('')}`).join('')}`,
          true,
        );
      } else toast(`${fa(count)} نصب نیمه‌تمام بدون تعارض بازیابی شد.`);
    });
  });
  el.insertAdjacentHTML(
    'beforeend',
    '<section class="panel sync-panel"><h3>همگام‌سازی گزارش‌ها</h3><p id="queue-state">در حال بررسی صف پایدار…</p><button class="button secondary" id="sync-now">ارسال گزارش‌های ذخیره‌شده</button><small class="muted">گزارش‌های آفلاین پس از اتصال ارسال می‌شوند؛ رمز، مسیر شخصی و لینک کامل ثبت نمی‌شود.</small></section>',
  );
  void pendingEvents().then((rows) => {
    const target = el.querySelector('#queue-state');
    if (target) target.textContent = `${fa(rows.length)} رویداد در انتظار تأیید سرور`;
  });
  el.querySelector('#sync-now')!.addEventListener(
    'click',
    () =>
      void flushEvents().then(() =>
        toast('تلاش برای همگام‌سازی انجام شد؛ موارد تأییدنشده در صف می‌مانند.'),
      ),
  );
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
    sessionStore.removeItem('uhm-admin');
    sessionStore.removeItem('uhm-admin-mode');
    void supabase?.auth.signOut();
    adminMode = false;
    page = 'discover';
    history.pushState({}, '', modeUrl());
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
    const service = await api('/service/status');
    if (
      service.settings.maintenance ||
      service.settings.downloads_paused ||
      service.settings.activation_paused
    )
      serviceMessage =
        service.settings.message || 'بعضی عملیات برای نگهداری سرویس موقتاً متوقف است.';
    const result = await api('/catalog');
    catalog = result.packages;
    for (const c of result.categories || []) category[c.id] = c.name;
    localStore.setItem('uhm-catalog', JSON.stringify(catalog));
  } catch {
    online = false;
    try {
      catalog = JSON.parse(localStore.getItem('uhm-catalog') || '[]');
    } catch {
      catalog = [];
    }
  }
  if (native) {
    try {
      const settings = await invoke<{ game_path: string }>('get_settings');
      gamePath = settings.game_path || '';
      installed = await invoke('installed_packages');
      const pending = await invoke<unknown[]>('recovery_status');
      if (pending.length)
        toast(
          `${fa(pending.length)} ژورنال نصب نیازمند بررسی است؛ از تنظیمات، بازیابی را اجرا کنید.`,
          true,
        );
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
    await listen<string>('launcher:close-blocked', (event) => toast(event.payload));
    await listen<any>('client-activity', (event) => {
      const { type, ...fields } = event.payload;
      if (type === 'install_completed') {
        const task = [...tasks]
          .reverse()
          .find((t) => t.id === fields.package_id && t.active && !t.error);
        if (task) {
          task.progress = 100;
          task.phase = 'نصب تکمیل شد';
          task.active = false;
          persistTasks();
        }
      }
      void recordEvent(type, fields);
    });
    await listen<{ package_id: string; active: boolean; mode: string }>(
      'install-job-state',
      (event) => {
        const task = [...tasks]
          .reverse()
          .find(
            (t) => t.id === event.payload.package_id && t.active && !t.error && t.progress < 100,
          );
        if (task) {
          Object.assign(task, event.payload);
          persistTasks();
          if (page === 'downloads' && !adminMode) {
            downloads(document.querySelector('#content')!);
            decorate();
          }
        }
      },
    );
    await listen<{
      id: string;
      package_id: string;
      name: string;
      required: number;
      free: number;
      version: string;
      destination: string;
      download_bytes: number;
      dependencies: { id: string; name: string; version?: string }[];
      warnings: string[];
      files: {
        path: string;
        bytes: number;
        overwrite: boolean;
        shared: boolean;
        owners: string[];
        sha256: string;
        executable: boolean;
      }[];
    }>('install-preview', (event) => {
      const p = event.payload;
      const task = [...tasks]
        .reverse()
        .find((t) => t.id === p.package_id && t.active && !t.error && t.progress < 100);
      if (task) {
        task.phase = 'منتظر تأیید فایل‌های نصب';
        task.mode = 'approval';
        task.progress = 72;
        persistTasks();
      }
      const d = modal(
        'تأیید فایل‌های نصب',
        `<h3>${esc(p.name)}</h3><p>استخراج انجام شده، اما هنوز هیچ فایل بازی تغییر نکرده است. ${fa(p.files.length)} مقصد واقعی را بررسی کنید.</p><p>نسخه <code>${esc(p.version)}</code> · دانلود ${size(p.download_bytes)} · فضای موردنیاز برای اعمال و بکاپ: ${size(p.required)} · آزاد: ${size(p.free)}</p><p class="muted">مقصد: <code dir="ltr">${esc(p.destination)}</code></p>${p.dependencies.length ? `<p>پیش‌نیازها: ${p.dependencies.map((d) => `${esc(d.name)}${d.version ? ` v${esc(d.version)}` : ''}`).join('، ')}</p>` : ''}${p.warnings.map((w) => `<div class="notice error">${esc(w)}</div>`).join('')}<div class="notice">فایل اجرایی فقط کپی می‌شود؛ هیچ EXE دانلودشده‌ای اجرا نخواهد شد. بستن این پنجره نصب را لغو می‌کند.</div><div class="file-preview-list">${p.files.map((f) => `<div class="setting-row"><code dir="ltr">${esc(f.path)}</code><span>${size(f.bytes)} · ${f.overwrite ? 'بکاپ و جایگزینی' : 'فایل جدید'}${f.shared ? ` · مشترک با ${esc(f.owners.join('، '))}` : ''}${f.executable ? ' · فایل اجرایی' : ''}</span></div>`).join('')}</div><div class="actions"><button class="button" id="approve-install">تأیید و اعمال تغییرات</button><button class="button secondary" id="reject-install">انصراف</button></div>`,
        true,
      );
      let approved = false;
      d.addEventListener('close', () => {
        if (!approved)
          void invoke('control_job', { packageId: p.package_id, action: 'cancel' }).catch(
            handleError,
          );
      });
      d.querySelector('#reject-install')!.addEventListener('click', () => d.close());
      d.querySelector<HTMLButtonElement>('#approve-install')!.onclick = function () {
        void busy(this as HTMLButtonElement, async () => {
          await invoke('control_job', {
            packageId: p.package_id,
            action: 'approve',
            previewId: p.id,
          });
          approved = true;
          d.close();
        });
      };
    });
    await listen<{
      package_id: string;
      phase: string;
      progress: number;
      bytes?: number;
      total?: number;
      speed?: number;
      eta?: number;
    }>('install-progress', (e) => {
      const t = [...tasks]
        .reverse()
        .find((t) => t.id === e.payload.package_id && t.active && t.progress < 100 && !t.error);
      if (t) {
        Object.assign(t, e.payload);
        if (e.payload.phase.includes('در حال دانلود')) t.mode = 'download';
        else if (e.payload.phase.includes('استخراج')) t.mode = 'extract';
        else if (e.payload.phase.includes('اعمال')) t.mode = 'apply';
        persistTasks();
        if (e.payload.phase === 'نصب تأیید شد') {
          t.progress = 100;
          t.phase = 'نصب تکمیل شد';
          t.active = false;
        }
        if (page === 'downloads' && !adminMode) {
          downloads(document.querySelector('#content')!);
          decorate();
        }
      }
    });
  }
  if (native)
    window.setInterval(() => {
      if (page !== 'library' || adminMode || document.hidden || installing) return;
      void invoke<{ autoscan: boolean }>('get_settings')
        .then((s) => {
          if (s.autoscan) return localLibrary(document.querySelector('#content')!, true);
        })
        .catch(handleError);
    }, 60_000);
  await refreshDueLicense();
  void recordEvent('app_open', { stage: 'app' });
  void flushEvents();
  await render();
}
window.addEventListener('license-activated', () => {
  license = JSON.parse(localStore.getItem('uhm-license') || 'null');
  grant = localStore.getItem('uhm-grant') || '';
  void recordEvent('app_open', { stage: 'app' });
});
window.addEventListener('popstate', () => {
  const route = readRoute();
  adminMode = route.admin;
  page = route.page;
  void render();
});
window.addEventListener('outbox-error', () =>
  toast('ذخیره گزارش‌ها ممکن نشد؛ فضای ذخیره‌سازی برنامه را بررسی کنید.', true),
);
window.addEventListener('unhandledrejection', (e) => {
  e.preventDefault();
  if (e.reason instanceof Error && !(e.reason instanceof ApiError))
    void recordEvent('app_error', { error_code: 'APP_RUNTIME_ERROR', stage: 'app' }).catch(
      () => {},
    );
  handleError(e.reason);
});
window.addEventListener('online', () => {
  online = true;
  void flushEvents();
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
