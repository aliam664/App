import { appVersion } from './version';
import { readRoute, pageUrl } from './navigation';
import { updateStatusPanel } from './update-status';
import { recordEvent, flushEvents, pendingEvents } from './outbox';
import { licenseAdminSession } from './license-admin';
import { assetUrl, modeUrl, staticPreview, buildRevision } from './runtime';
import { localStore, sessionStore } from './storage';
import './styles/tokens.css';
import './styles/base.css';
import './styles/launcher.css';
import './styles/admin.css';
import { localLibrary, libraryPreferences } from './local-library';
import { downloadPreferences } from './download-preferences';
import { api, ApiError, supabase } from './api';
import { proof, native, invoke } from './device';
import { L, getLang, setLang, num, fmtDate } from './i18n';
import { renderContactPage, renderHomeContactStrip, bindHomeContactStrip } from './contact';
import {
  esc,
  icon,
  decorate,
  size,
  badge,
  category,
  categoryLabel,
  toast,
  handleError,
  modal,
  busy,
  empty,
  field,
} from './ui';
import { loginDialog, renderAdmin } from './admin';
import {
  ranks,
  defaultContact,
  type Tier,
  type PackageSpec,
  type ContactSettings,
} from '../../../packages/contracts/src/index';
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
setLang(getLang());

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
let publicContact: Omit<ContactSettings, 'updated_by'> = defaultContact(0);
let contactConfigured = false;

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
        ? {
            error: L(
              'عملیات قبلی پایان نیافته؛ شروع مجدد با بررسی فایل موقت ممکن است.',
              'Previous transfer did not finish; retry may resume from cached artifact.',
            ),
          }
        : {}),
    }));
} catch {
  tasks = [];
}
const persistTasks = () => localStore.setItem('uhm-task-history', JSON.stringify(tasks.slice(-60)));
let installing = false;
let renderGeneration = 0;
let compact = localStore.getItem('uhm-compact') === 'true';

const getLauncherNav = () => [
  ['discover', 'compass', L('خانه', 'Home')],
  ['content', 'package', L('دانلود محتوا', 'Catalog')],
  ['library-settings', 'folder-cog', L('تنظیمات کتابخانه', 'Library Setup')],
  ['library', 'layers-2', L('کتابخانه من', 'My Library')],
  ['downloads', 'download', L('دانلود و نصب', 'Downloads')],
  ['contact', 'mail', L('تماس با ما', 'Contact')],
];

const getAdminNav = () => [
  ['dashboard', 'layout-dashboard', L('نمای کلی', 'Overview')],
  ['licenses', 'key-round', L('لایسنس‌ها', 'Licenses')],
  ['users', 'users', L('کاربران', 'Users')],
  ['packages', 'package', L('پکیج‌ها', 'Packages')],
  ['versions', 'git-branch', L('نسخه‌ها', 'Releases')],
  ['devices', 'monitor', L('دستگاه‌ها', 'Devices')],
  ['analytics', 'layout-dashboard', L('تحلیل عملکرد', 'Analytics')],
  ['errors', 'triangle-alert', L('مرکز خطاها', 'Incidents')],
  ['team', 'shield-check', L('تیم و دسترسی‌ها', 'Team & Access')],
  ['contact', 'mail', L('تماس با ما', 'Contact Us')],
  ['service', 'radio', L('کنترل سرویس', 'Service')],
  ['logs', 'scroll-text', L('رویدادها', 'Audit Log')],
];

function brandMarkup() {
  return `<a class="brand" href="${modeUrl()}" aria-label="Assetto Corsa Launcher"><img src="${assetUrl('/brand/mark.svg')}" alt=""><span>Assetto Corsa Launcher</span><small dir="ltr">v${appVersion}</small></a>`;
}

function demoStrip() {
  return demo
    ? `<div class="demo-strip">${icon('flask-conical')}${staticPreview ? L('پیش‌نمایش GitHub Pages · داده‌های آزمایشی فقط در مرورگر شما', 'GitHub Pages Browser Preview · Local browser-only demo data') : L('محیط پیش‌نمایش · داده‌های محلی و ورود نمایشی', 'Local Preview Environment · Isolated demo API')} · ${L('نصب واقعی فقط در نسخهٔ ویندوز', 'File installs run in Windows Desktop only')} <span>PREVIEW</span></div>`
    : '';
}

function footerMarkup() {
  return `<footer class="site-footer"><div class="footer-identity"><img src="${assetUrl('/brand/mark.svg')}" alt=""><div><b>Assetto Corsa Launcher</b>${staticPreview ? `<small class="build-revision" dir="ltr">PREVIEW / ${esc(buildRevision.slice(0, 7))}</small>` : ''}<span>${L('مدیریت کاتالوگ، لایسنس دستگاه‌محور و نصب تراکنشی پکیج‌ها', 'Curated catalog, device-bound licensing & transactional package delivery')}</span></div></div><span class="connection ${online ? '' : 'offline'}"><i></i>${online ? L('متصل به سرویس', 'Service Online') : L('حالت آفلاین', 'Offline Mode')}</span><div class="actions">${!adminMode ? `<button class="text-button" id="footer-contact">${L('تماس با ما', 'Contact Us')}</button><button class="mode-switch-access" id="switch-mode">${icon('sliders-horizontal')}${L('پنل مدیریت', 'Control Room')}</button>` : ''}<button id="about">${L('دربارهٔ لانچر', 'About')} ${icon(getLang() === 'fa' ? 'arrow-up-left' : 'arrow-up-right')}</button></div></footer>`;
}

function launcherShell(nav: string[][]) {
  const lang = getLang();
  return `<div class="launcher-shell"><a class="skip-link" href="#content">${L('رفتن به محتوای صفحه', 'Skip to main content')}</a><div class="reference-header"><header class="container nav">${brandMarkup()}<nav class="nav-links" aria-label="${L('ناوبری اصلی', 'Main navigation')}">${nav.map(([id, , t]) => `<button class="${page === id ? 'current' : ''}" ${page === id ? 'aria-current="page"' : ''} data-nav="${id}">${t}${id === 'downloads' && tasks.length ? ` <b>${num(tasks.length)}</b>` : ''}</button>`).join('')}<button class="${page === 'settings' ? 'current' : ''}" ${page === 'settings' ? 'aria-current="page"' : ''} data-nav="settings">${L('تنظیمات', 'Settings')}</button></nav><div class="nav-actions"><button class="profile language-toggle" id="profile" aria-label="${license ? L('مدیریت اشتراک', 'Manage License') : L('اشتراک و فعال‌سازی', 'Activate License')}"><span class="language-orbit">${icon('key-round')}</span><span>${license ? license.tier.toUpperCase() + ' MEMBER' : L('لایسنس', 'License')}</span><span class="language-chevron" aria-hidden="true">↗</span></button><button class="icon" id="header-lang" aria-label="${L('تغییر زبان به انگلیسی', 'Switch to Persian')}" title="${lang === 'fa' ? 'English' : 'فارسی'}">${lang === 'fa' ? 'EN' : 'FA'}</button><button class="icon" id="theme" aria-label="${L('تغییر تم', 'Toggle theme')}">◐</button><button class="icon notification-button" id="notifications" aria-label="${L('تازه‌های انتشار', 'Release updates')}">${icon('bell')}</button><button class="menu-btn" id="mobile-menu" aria-label="${L('منوی بخش‌ها', 'Menu')}" aria-expanded="false">${icon('menu')} ${L('منو', 'Menu')}</button></div></header></div>${demoStrip()}${serviceMessage ? `<div class="console-notice">${esc(serviceMessage)}</div>` : ''}<main class="launcher-content ${page === 'discover' ? 'is-discover' : ''}" id="content" tabindex="-1"></main>${footerMarkup()}</div><div id="toasts" aria-live="polite"></div>`;
}

function adminShell(nav: string[][]) {
  const lang = getLang();
  const chevron = lang === 'fa' ? 'chevron-left' : 'chevron-right';
  const groups = [
    [L('فضای کاری', 'Workspace'), ['dashboard', 'licenses', 'users', 'devices']],
    [L('مدیریت محتوا', 'Content'), ['packages', 'versions']],
    [
      L('نظارت و ارتباط', 'Operations & Desk'),
      ['analytics', 'errors', 'team', 'contact', 'service', 'logs'],
    ],
  ] as const;
  return `<div class="app-shell admin-shell"><a class="skip-link" href="#content">${L('رفتن به محتوای صفحه', 'Skip to main content')}</a><aside class="sidebar">${brandMarkup()}<div class="workspace-label">${L('فضای مدیریت', 'Workspace')}<span lang="en">CONTROL ROOM</span></div><nav aria-label="${L('منوی اصلی', 'Admin navigation')}">${groups
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
    )}</nav><div class="sidebar-bottom"><div class="workspace-identity">${icon('shield-check')}<div><b data-admin-role>${L('مدیریت', 'Staff')}</b><small>${L('دسترسی بر اساس مجوز حساب', 'Permission-scoped session')}</small></div></div><button class="nav-item ${page === 'settings' ? 'active' : ''}" data-nav="settings">${icon('settings-2')}${L('تنظیمات', 'Settings')}</button><button class="nav-item" id="switch-mode">${icon('arrow-up-right')}${L('بازگشت به لانچر', 'Back to Launcher')}</button><div class="sidebar-version"><span>PLATFORM</span><code dir="ltr">v${appVersion}</code></div></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumbs">${icon('sliders-horizontal')}<span>${L('اتاق کنترل', 'Control Room')}</span>${icon(chevron)}<strong>${esc(nav.find((n) => n[0] === page)?.[2] || L('تنظیمات', 'Settings'))}</strong></div><div class="mobile-console-brand">${brandMarkup()}</div><div class="topbar-actions"><button class="icon-button mobile-menu" id="mobile-menu" aria-label="${L('منوی بخش‌ها', 'Menu')}" aria-expanded="false">${icon('menu')}</button><button class="icon-button" id="header-lang" aria-label="${L('تغییر زبان', 'Switch language')}">${lang === 'fa' ? 'EN' : 'FA'}</button><button class="icon-button" id="theme" aria-label="${L('تغییر تم', 'Toggle theme')}">◐</button><button class="icon-button" id="notifications" aria-label="${L('تازه‌های انتشار', 'Updates')}">${icon('bell')}</button><button class="profile" id="profile" aria-label="${L('خروج از حساب مدیریت', 'Admin session')}"><span class="avatar">${icon('shield-check')}</span><span><b data-admin-role>${L('مدیریت', 'Staff')}</b><small lang="en">CONTROL ROOM</small></span>${icon('chevron-down')}</button></div></header>${demoStrip()}${serviceMessage ? `<div class="console-notice">${esc(serviceMessage)}</div>` : ''}<main id="content" tabindex="-1"></main>${footerMarkup()}</div></div><div id="toasts" aria-live="polite"></div>`;
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
  setLang(getLang());
  document.body.classList.toggle('compact', compact);
  const nav = adminMode ? getAdminNav() : getLauncherNav();
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
  document.querySelector('#header-lang')?.addEventListener('click', () => {
    setLang(getLang() === 'fa' ? 'en' : 'fa');
    void render();
  });
  document.querySelector('#footer-contact')?.addEventListener('click', () => navigate('contact'));

  document.querySelectorAll<HTMLButtonElement>('[data-nav]').forEach(
    (b) =>
      (b.onclick = () => {
        navigate(b.dataset.nav!);
      }),
  );
  document.querySelector('#mobile-menu')!.addEventListener('click', () => {
    const d = modal(
      L('بخش‌های برنامه', 'Navigation'),
      `<div class="mobile-links">${[...nav.filter(([id]) => !document.querySelector<HTMLButtonElement>(`[data-nav="${id}"]`)?.hidden), ['settings', 'settings-2', L('تنظیمات', 'Settings')]].map(([id, i, t]) => `<button class="nav-item" data-mobile-nav="${id}">${icon(i)}${esc(t)}</button>`).join('')}<button class="nav-item" id="mobile-switch">${icon('sliders-horizontal')}${adminMode ? L('بازگشت به لانچر', 'Back to Launcher') : L('پنل مدیریت', 'Control Room')}</button></div>`,
    );
    d.classList.add('drawer-dialog');
    const menuButton = document.querySelector('#mobile-menu')!;
    menuButton.setAttribute('aria-expanded', 'true');
    d.addEventListener('close', () => menuButton.setAttribute('aria-expanded', 'false'));
    d.setAttribute('aria-label', L('منوی بخش‌های لانچر', 'Launcher Navigation Menu'));
    d.querySelector('.modal-head h2')!.innerHTML =
      `<img src="${assetUrl('/brand/mark.svg')}" alt=""> Assetto Corsa Launcher`;
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
      L('تازه‌های انتشار', 'Release Feed'),
      catalog.length
        ? `<div class="updates-list">${catalog
            .slice(0, 5)
            .map(
              (p) =>
                `<article><img src="${esc(assetUrl(p.image))}" alt=""><div><b>${esc(p.name)}</b><p>${esc(p.changelog)}</p><small dir="ltr">v${esc(p.version)} · ${fmtDate(p.released_at)}</small></div></article>`,
            )
            .join('')}</div>`
        : empty(
            L('هنوز خبری نیست', 'No releases yet'),
            L(
              'با انتشار پکیج، تغییرات اینجا دیده می‌شوند.',
              'Published package updates appear here once released.',
            ),
          ),
    ),
  );
  document
    .querySelector('#about')!
    .addEventListener('click', () =>
      modal(
        L('درباره Assetto Corsa Launcher', 'About Assetto Corsa Launcher'),
        `<p>${L('این نرم‌افزار یک لانچر مستقل برای مدیریت کاتالوگ، اعتبارسنجی لایسنس دستگاه‌محور و نصب تراکنشی پکیج‌های Assetto Corsa است.', 'An independent catalog, device-bound licensing, and transactional package installer built for Assetto Corsa.')}</p><p class="muted">${L('نسخهٔ', 'Version')} <code dir="ltr">${appVersion}</code> — ${L('وابسته به سازندهٔ رسمی بازی نیست. استفاده و توزیع هر پکیج نیازمند مجوز صاحب محتواست.', 'Not affiliated with Kunos Simulazioni. Each mod belongs to its respective author.')}</p><div class="notice">${L('در مرورگر هیچ فایل بازی تغییر نمی‌کند. موفقیت نصب تنها پس از تأیید موتور Native ثبت می‌شود.', 'No game files are modified in browser previews; real installs occur solely in the Windows desktop app.')}</div>`,
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
    content.innerHTML = `<div class="page-loading" role="status">${L('در حال دریافت اطلاعات اتاق کنترل…', 'Loading control room…')}</div>`;
  try {
    if (page === 'settings') {
      settings(content);
      return;
    }
    if (adminMode) {
      if (!adminToken) {
        content.innerHTML = empty(
          L('ورود مدیر لازم است', 'Administrator Sign-In Required'),
          L(
            'برای مشاهده و مدیریت داده‌ها وارد شوید.',
            'Sign in to access control room operations.',
          ),
          'shield',
        );
        loginDialog(demo, (t) => {
          adminToken = t;
          sessionStore.setItem('uhm-admin', t);
          void render();
        });
        return;
      }
      await renderAdmin(
        content,
        page,
        adminToken,
        render,
        () => generation === renderGeneration,
        (nextContact, nextConfigured) => {
          publicContact = nextContact;
          contactConfigured = nextConfigured;
        },
      );
      if (generation !== renderGeneration) return;
    } else if (page === 'discover' || page === 'content') {
      discover(content);
      if (page === 'content') {
        const collection = content.querySelector('#package-catalog');
        content.querySelector('.reference-home')!.replaceChildren(collection!);
      }
    } else if (page === 'contact') {
      renderContactPage(content, publicContact, contactConfigured);
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
      L('دریافت اطلاعات ممکن نشد', 'Unable to Load View'),
      L('اتصال یا نشست خود را بررسی کنید.', 'Check your network connection or session privileges.'),
      'wifi-off',
    );
    content.insertAdjacentHTML(
      'beforeend',
      `<button class="button secondary retry-page" id="retry-page">${L('تلاش دوباره', 'Retry')}</button>`,
    );
    content.querySelector('#retry-page')!.addEventListener('click', () => void render());
    handleError(e);
  } finally {
    if (generation === renderGeneration) content.removeAttribute('aria-busy');
  }
  if (generation === renderGeneration) decorate();
}

function discover(el: HTMLElement) {
  const lang = getLang();
  const arrow = lang === 'fa' ? 'arrow-left' : 'arrow-up-right';
  const contactStripHtml = renderHomeContactStrip(publicContact, contactConfigured, () =>
    navigate('contact'),
  );
  el.innerHTML = `<div class="reference-home">
  <section class="hero feature" aria-label="${L('معرفی لانچر', 'Launcher overview')}">
    <div class="container hero-grid">
      <div class="hero-copy">
        <div class="eyebrow"><span class="eyebrow-line"></span>ASSETTO CORSA / MOTORSPORT ATELIER</div>
        <h1>${L('دقت مهندسی برای', 'Engineered Precision for')} <span class="hero-highlight">${L('گاراژ استو کورسا', 'Your Assetto Corsa Garage')}</span></h1>
        <p class="hero-lead">${L('مدیریت یکپارچه پکیج‌های گرافیکی، مسیرها و خودروهای Assetto Corsa؛ از فعال‌سازی لایسنس دستگاه‌محور تا بررسی SHA-256، بکاپ خودکار و نصب تراکنشی امن.', 'Curated graphics presets, circuits, and vehicles for Assetto Corsa—uniting device-bound licensing, SHA-256 artifact checks, and atomic transactional installs.')}</p>
        <div class="hero-buttons">
          <button class="btn primary" id="browse-packages">${L('مرور کاتالوگ پکیج‌ها', 'Browse Catalog')} ${icon('arrow-down')}</button>
          <button class="btn ghost" id="view-atelier">${L('معماری نصب و امنیت', 'Engineering Architecture')}</button>
          <button class="btn ghost" id="start-install">${L('تنظیم مسیر بازی', 'Configure Path')}</button>
        </div>
        <div class="home-proof">
          <span>PURE + CSP READY</span>
          <span>SHA-256 VERIFIED</span>
          <span>ATOMIC BACKUP & ROLLBACK</span>
        </div>
        <div class="stats">
          <div class="stat"><b>${num(catalog.length)}</b><span>${L('پکیج در کاتالوگ', 'Catalog Packages')}</span></div>
          <div class="stat"><b dir="ltr">Normal / Pro / VIP</b><span>${L('سطوح دسترسی', 'Entitlement Tiers')}</span></div>
          <div class="stat"><b dir="ltr">ZIP / RAR / 7z</b><span>${L('فرمت‌های پشتیبانی‌شده', 'Verified Formats')}</span></div>
        </div>
      </div>
      <figure class="hero-visual">
        <picture>
          <source srcset="${assetUrl('/brand/hero-atelier.webp')}" type="image/webp">
          <img src="${assetUrl('/brand/hero-atelier.jpg')}" alt="${L('تصویر هنری گاراژ خودرویی اختصاصی لانچر', 'Editorial luxury automotive garage artwork for the launcher')}">
        </picture>
        <figcaption><span>${L('اثر بصری اختصاصی لانچر — نمای گاراژ استودیویی', 'Editorial Launcher Artwork — Studio Pit Bay')}</span><code>EDITORIAL ART</code></figcaption>
      </figure>
    </div>
  </section>

  <section id="atelier" class="section">
    <div class="container">
      <div class="section-head">
        <div>
          <div class="eyebrow"><span class="eyebrow-line"></span>ATELIER ARCHITECTURE</div>
          <h2>${L('طراحی‌شده برای اطمینان، نه شلوغی.', 'Built for Reliability, Not Guesswork.')}</h2>
        </div>
        <p>${L('هر مرحله از دریافت فایل تا جایگزینی در پوشه بازی تحت کنترل رمزنگاری و ژورنال بازیابی است.', 'Every transfer from remote mirror to game directory runs inside checksum verification and rollback journals.')}</p>
      </div>
      <div class="atelier-grid">
        <figure class="atelier-visual">
          <picture>
            <source srcset="${assetUrl('/brand/atelier-track.webp')}" type="image/webp">
            <img src="${assetUrl('/brand/atelier-track.jpg')}" alt="${L('تصویر هنری پیست مسابقه بارانی', 'Editorial wet-tarmac motorsport circuit artwork')}" loading="lazy">
          </picture>
          <figcaption>${L('تصویرسازی اختصاصی فضای پیست (غیر از اسکرین‌شات داخل بازی)', 'Original editorial track artwork (distinct from in-game captures)')}</figcaption>
        </figure>
        <div class="pillar-list">
          <article class="pillar-card">
            <span class="pillar-index">01</span>
            <div>
              <h3>${L('لایسنس دستگاه‌محور و تأیید آفلاین امضاشده', 'Device-Bound ECDSA Proof & Offline Grants')}</h3>
              <p>${L('هر کد فقط به یک کلید P-256 متصل می‌شود؛ مجوزهای آفلاین ES256 بدون نیاز به اتصال دائمی کار می‌کنند.', 'Keys bind to hardware-isolated P-256 identities while signed ES256 grants verify cleanly offline.')}</p>
            </div>
          </article>
          <article class="pillar-card">
            <span class="pillar-index">02</span>
            <div>
              <h3>${L('بررسی کامل فایل‌ها پیش از تغییر پوشه بازی', 'Pre-Commit File Inspection & Quarantine')}</h3>
              <p>${L('پیش از اعمال هر تغییر، لیست کامل مقصدها، تعارض‌ها و بکاپ خودکار به کاربر نمایش داده می‌شود.', 'Review every destination, collision, and automatic backup snapshot before committing changes.')}</p>
            </div>
          </article>
          <article class="pillar-card">
            <span class="pillar-index">03</span>
            <div>
              <h3>${L('اسکن واقعی کتابخانه Assetto Corsa', 'True Local Assetto Corsa Scanner')}</h3>
              <p>${L('ماشین‌ها، پیست‌ها و اسکین‌های نصب‌شده چه از طریق لانچر و چه دستی بدون آمارسازی نمایش داده می‌شوند.', 'Inspect cars, tracks, and liveries installed externally or via the launcher without fabricated telemetry.')}</p>
            </div>
          </article>
        </div>
      </div>
    </div>
  </section>

  <section class="catalog-section section" id="package-catalog">
    <div class="container">
      <div class="section-head">
        <div>
          <div class="eyebrow"><span class="eyebrow-line"></span>PACKAGE COLLECTION</div>
          <h2>${L('کاتالوگ پکیج‌های Assetto Corsa', 'Assetto Corsa Package Collection')}</h2>
        </div>
        <span class="count" id="result-count">${num(catalog.length)} ${L('پکیج', 'packages')}</span>
      </div>
      <div class="catalog-controls">
        <div class="tabs" role="tablist" aria-label="${L('دسته‌بندی پکیج‌ها', 'Package categories')}">${[['all', L('همه پکیج‌ها', 'All Packages')], ...Object.keys(category).map((k) => [k, categoryLabel(k)])].map(([v, l]) => `<button role="tab" aria-selected="${activeCategory === v}" class="tab ${activeCategory === v ? 'selected' : ''}" tabindex="${activeCategory === v ? '0' : '-1'}" data-category="${esc(v)}">${esc(l)}</button>`).join('')}</div>
        <div class="catalog-search">
          <label class="search">${icon('search')}<input id="package-search" placeholder="${L('جست‌وجو بر اساس نام، برند، سازنده یا تگ…', 'Search by package, brand, author, or tag…')}" value="${esc(query)}" aria-label="${L('جست‌وجوی پکیج', 'Search packages')}"></label>
          <select id="tier-filter" aria-label="${L('فیلتر سطح اشتراک', 'Filter by tier')}">
            <option value="all">${L('همه سطح‌ها', 'All Tiers')}</option>
            ${['normal', 'pro', 'vip'].map((t) => `<option value="${t}" ${tierFilter === t ? 'selected' : ''}>${t.toUpperCase()}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="package-grid" id="packages"></div>
    </div>
  </section>

  <section class="section membership-section">
    <div class="container">
      <div class="download">
        <div>
          <div class="eyebrow"><span class="eyebrow-line"></span>DEVICE ENTITLEMENT</div>
          <h2>${license ? L('اشتراک فعال روی این دستگاه.', 'Active Entitlement on This Device.') : L('کلید لایسنس خود را فعال کنید.', 'Activate Your Device License.')}</h2>
          <p>${license ? L('وضعیت مجوز، سطح دسترسی و تمدید آنلاین را در پنجره اشتراک مدیریت کنید.', 'Review expiration, offline grant lease, and renew online from your license panel.') : L('یک لایسنس، یک دستگاه؛ بدون نیاز به ساخت حساب کاربری اضافی.', 'One license, one hardware key—no redundant account registration required.')}</p>
          <div class="home-proof"><span>NORMAL</span><span>PRO</span><span>VIP</span></div>
        </div>
        <button class="btn primary" id="membership">${license ? L('مدیریت اشتراک', 'Manage License') : L('فعال‌سازی لایسنس', 'Activate License')} ${icon(arrow)}</button>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="section-head">
        <div>
          <div class="eyebrow"><span class="eyebrow-line"></span>IN-GAME CAPTURES</div>
          <h2>${L('ثبت‌های واقعی داخل Assetto Corsa.', 'Authentic Assetto Corsa Captures.')}</h2>
        </div>
        <p>${L('اسکرین‌شات‌های واقعی محیط بازی — بدون رندر نمایشی.', 'Genuine in-game captures recorded inside Assetto Corsa.')}</p>
      </div>
      <div class="looks" tabindex="0" role="region" aria-label="${L('گالری تصاویر بازی', 'In-game screenshot gallery')}">
        ${[
          [
            '03.jpg',
            'GARAGE LIGHTING',
            L('نمای داخل گاراژ در Assetto Corsa', 'In-game garage lighting capture'),
          ],
          [
            '06.jpg',
            'WET CIRCUIT GT3',
            L('نمای پیست بارانی GT3 در Assetto Corsa', 'In-game wet circuit GT3 capture'),
          ],
          [
            '07.jpg',
            'PIT LANE DUSK',
            L('نمای پیت‌لین شبانه در Assetto Corsa', 'In-game nocturnal pit-lane capture'),
          ],
          [
            '09.jpg',
            'DAYLIGHT STUDIO',
            L('نمای نور روز در Assetto Corsa', 'In-game daylight studio capture'),
          ],
        ]
          .map(
            ([img, label, alt]) =>
              `<figure><img src="${assetUrl(`/images/${img}`)}" alt="${esc(alt)}" loading="lazy"><figcaption>IN-GAME / ${label}</figcaption></figure>`,
          )
          .join('')}
      </div>
    </div>
  </section>
  ${contactStripHtml}
  </div>`;

  const list = () => {
    const matches = catalog.filter(
      (p) =>
        (activeCategory === 'all' || p.category === activeCategory) &&
        (tierFilter === 'all' || p.tier === tierFilter) &&
        `${p.name} ${p.description} ${p.slug} ${p.author || ''} ${p.brand || ''} ${(p.tags || []).join(' ')}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
    el.querySelector('#result-count')!.textContent =
      `${num(matches.length)} ${L('پکیج', 'packages')}`;
    el.querySelector('#packages')!.innerHTML = matches.length
      ? matches.map((p) => card(p)).join('')
      : empty(
          L('پکیجی با این فیلتر پیدا نشد', 'No matching packages'),
          L(
            'عبارت جست‌وجو یا فیلتر دسته‌بندی را تغییر دهید.',
            'Try another search query or category filter.',
          ),
          'search-x',
        );
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
  el.querySelector('#browse-packages')?.addEventListener('click', () =>
    scrollTo('#package-catalog'),
  );
  el.querySelector('#view-atelier')?.addEventListener('click', () => scrollTo('#atelier'));
  el.querySelector('#start-install')?.addEventListener('click', () => navigate('settings'));
  el.querySelector('#membership')!.addEventListener('click', activateDialog);
  bindHomeContactStrip(el, () => navigate('contact'));
  list();
}

function card(p: CatalogItem) {
  const locked = !license || ranks[license.tier] < ranks[p.tier];
  return `<article class="package-card"><button class="card-image" data-package="${p.id}" aria-label="${L('مشاهده', 'Inspect')} ${esc(p.name)}"><img src="${esc(assetUrl(p.image))}" alt="${esc(p.name)}" loading="lazy">${badge(p.tier)}${installed[p.id] ? `<span class="installed-tag">${icon('check')}${L('نصب‌شده', 'Installed')}</span>` : ''}</button><div class="card-content"><div class="card-meta"><span>${esc(categoryLabel(p.category))}</span><code dir="ltr">v${esc(p.version)}</code></div><button class="card-title" data-package="${p.id}">${esc(p.name)}</button><p>${esc(p.short_description || p.description)}</p><div class="card-footer"><span>${p.size ? size(p.size) : L('فایل متصل نشده', 'No files yet')}</span><button class="text-button" data-package="${p.id}">${locked ? icon('lock-keyhole') : icon('arrow-down-to-line')}${locked ? L('بررسی دسترسی', 'Inspect Access') : L('مشاهده و نصب', 'Inspect & Install')}</button></div></div></article>`;
}

function details(p: CatalogItem) {
  const locked = license && ranks[license.tier] < ranks[p.tier];
  const gallery = [p.image, ...(p.images || [])].filter(Boolean);
  const d = modal(
    p.name,
    `<img class="detail-image" id="inspector-hero" src="${esc(assetUrl(p.image))}" alt="${esc(p.name)}">${gallery.length > 1 ? `<div class="detail-gallery">${gallery.map((src, i) => `<button type="button" class="detail-thumb ${i === 0 ? 'active' : ''}" data-thumb="${esc(assetUrl(src))}" aria-label="${L('پیش‌نمایش تصویر', 'Preview image')} ${i + 1}"><img src="${esc(assetUrl(src))}" alt=""></button>`).join('')}</div>` : ''}<div class="detail-meta">${badge(p.tier)}<span>${esc(categoryLabel(p.category))}</span><code dir="ltr">v${esc(p.version)}</code>${p.content_type ? `<span>· ${esc(p.content_type)}</span>` : ''}${p.brand ? `<span>· ${esc(p.brand)}</span>` : ''}${p.author ? `<span>· ${esc(p.author)}</span>` : ''}</div><p class="detail-description">${esc(p.description)}</p><div class="detail-facts"><div><small>${L('آخرین انتشار', 'Released')}</small><b>${fmtDate(p.released_at)}</b></div><div><small>${L('حجم دانلود', 'Download Size')}</small><b dir="auto">${p.size ? size(p.size) : L('فایل متصل نشده', 'Unlinked')}</b></div><div><small>${L('تعداد فایل', 'Files')}</small><b>${num(p.file_count)}</b></div></div><h3>${L('قبل از شروع', 'Dependencies')}</h3>${
      p.dependencies.length
        ? `<div class="dependency-list">${p.dependencies
            .map((id) => {
              const dep = catalog.find((p) => p.id === id);
              return `<span>${icon('git-branch')}${esc(dep?.name || L('پیش‌نیاز ناموجود', 'Unavailable dependency'))}${dep ? badge(dep.tier) : ''}</span>`;
            })
            .join('')}</div>`
        : `<p class="muted">${L('این پکیج پیش‌نیاز دیگری ندارد.', 'No prerequisite dependencies required.')}</p>`
    }<h3>${L('تغییرات نسخه', 'Release Notes')}</h3><p class="muted preserve">${esc(p.changelog || '—')}</p>${!native ? '<div class="notice">' + icon('monitor') + L('در مرورگر می‌توانی محتوا و دسترسی را بررسی کنی؛ نصب فایل تنها در برنامه ویندوز انجام می‌شود.', 'You can inspect manifests and entitlements in the browser; file installation runs only inside the Windows desktop launcher.') + '</div>' : ''}<button class="button full" id="install">${!license ? L('ابتدا فعال‌سازی لایسنس', 'Activate License First') : locked ? L('نیازمند اشتراک ', 'Requires ') + p.tier.toUpperCase() : installed[p.id] ? L('بررسی و نصب مجدد', 'Verify & Reinstall') : L('آماده‌سازی نصب', 'Prepare Installation')} ${icon(!license || locked ? 'key-round' : 'download')}</button>`,
    true,
  );
  d.querySelectorAll<HTMLButtonElement>('[data-thumb]').forEach((b) => {
    b.onclick = () => {
      d.querySelectorAll('.detail-thumb').forEach((t) => t.classList.remove('active'));
      b.classList.add('active');
      d.querySelector<HTMLImageElement>('#inspector-hero')!.src = b.dataset.thumb!;
    };
  });
  d.querySelector<HTMLButtonElement>('#install')!.onclick = function () {
    if (!license) {
      d.close();
      activateDialog();
      return;
    }
    void busy(this as HTMLButtonElement, async () => {
      if (locked)
        throw new Error(
          L(
            'سطح اشتراک فعلی اجازه نصب این پکیج را نمی‌دهد.',
            'Your current tier does not include this package.',
          ),
        );
      const plan = await api(
        '/install/plan',
        { ...(await proof('plan')), package_id: p.id },
        grant,
      );
      if (!native) {
        toast(
          L(
            'دسترسی تأیید شد. برای اجرای نصب، این پکیج را در برنامه ویندوز باز کنید.',
            'Entitlement verified. Open this package in the Windows desktop client to install.',
          ),
        );
        return;
      }
      if (!gamePath)
        throw new Error(
          L(
            'ابتدا از تنظیمات، مسیر معتبر بازی را انتخاب کنید.',
            'Select your Assetto Corsa folder in Settings first.',
          ),
        );
      if (installing)
        throw new Error(
          L(
            'یک نصب دیگر در حال اجراست؛ تا پایان آن صبر کنید.',
            'Another installation is currently in progress.',
          ),
        );
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
    throw new Error(
      L(
        'برای نصب، مسیر معتبر بازی را در برنامه ویندوز انتخاب کنید.',
        'Choose a valid Assetto Corsa path in the Windows desktop app.',
      ),
    );
  if (installing)
    throw new Error(L('یک نصب دیگر در حال اجراست.', 'Another installation is running.'));
  installing = true;
  adminMode = false;
  const started = new Date().toISOString();
  const batch: Task[] = plan.packages.map((item, index) => ({
    id: item.id,
    key: `${item.id}:${started}:${index}`,
    name: item.name,
    version: item.version,
    started_at: started,
    phase: L('در انتظار موتور نصب', 'Waiting for installer engine'),
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
      item.phase = L('نتیجهٔ این بسته دریافت نشد', 'Outcome unconfirmed');
      item.error = L(
        'موتور نصب پایان یافت، اما تأیید تکمیل این بسته ارسال نشد؛ کتابخانه را بررسی کنید.',
        'Installer exited without completing confirmation for this package; inspect local library.',
      );
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
        toast(
          L(
            'نصب تأیید شد؛ گزارش آنلاین ارسال نشد و نتیجه در دستگاه محفوظ است.',
            'Installed locally; server report failed to sync.',
          ),
        );
      }
  } catch (e) {
    for (const item of batch.filter((t) => t.progress < 100 && !t.error)) {
      item.phase = L('عملیات متوقف شد', 'Transfer aborted');
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
      toast(
        L(
          'اشتراک معتبر نیست یا دستگاه توسط مدیر آزاد شده است. دوباره فعال‌سازی کنید.',
          'License invalidated or hardware binding released. Activate again.',
        ),
        true,
      );
    }
  } finally {
    refreshing = false;
  }
}

function activateDialog() {
  if (installing) {
    toast(
      L('تا پایان نصب، لایسنس را تغییر ندهید.', 'Wait for active installs to finish first.'),
      true,
    );
    return;
  }
  const d = modal(
    license
      ? L('اشتراک و مجوز دستگاه', 'Subscription & Device Grant')
      : L('فعال‌سازی لایسنس دستگاه', 'Activate Device License'),
    `${license ? `<div class="license-card">${badge(license.tier)}<strong>${L('عضویت', 'Membership')} ${license.tier.toUpperCase()}</strong><p>${L('معتبر تا', 'Valid until')} ${fmtDate(license.expires_at)}</p><small>${L('مجوز آفلاین:', 'Offline lease:')} ${offlineRemaining()}</small></div><button class="button full" id="refresh-license">${icon('refresh-cw')}${L('تمدید مجوز آنلاین', 'Refresh Grant Online')}</button><div class="divider"></div>` : ''}<form id="activate-form">${field(L('کد لایسنس', 'License Key'), '<input name="code" required minlength="16" maxlength="100" dir="ltr" autocomplete="off" placeholder="UHM-…">')}<button class="button full" type="submit">${L('فعال‌سازی روی این دستگاه', 'Activate on This Device')} ${icon(getLang() === 'fa' ? 'arrow-left' : 'arrow-up-right')}</button></form>${demo ? `<button class="text-button demo-activate" id="demo-license">${L('استفاده از لایسنس آزمایشی Pro', 'Use Demo Pro License')}</button>` : ''}<p class="fine-print">${L('فعال‌سازی اولیه آنلاین است. کد فقط به یک کلید دستگاه متصل می‌شود. تغییر دستگاه از طریق مدیر انجام می‌شود.', 'Initial activation requires connectivity and binds the key to this device keypair.')}</p>`,
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
      toast(
        L(
          'لایسنس فعال شد؛ دسترسی مدیریت این دستگاه هم تأیید شد.',
          'License activated; staff control room privileges verified.',
        ),
      );
    } catch {
      toast(L('مجوز دستگاه با موفقیت ثبت شد.', 'Device license activated.'));
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
    const days = Math.max(0, Math.ceil((claims.offline_until - Date.now()) / 86400000));
    return L(
      `${num(days)} روز باقی‌مانده (نمایش اطلاعات؛ اعتبارسنجی در Native)`,
      `${num(days)} days left (verified natively)`,
    );
  } catch {
    return L('نیازمند تمدید', 'Renewal required');
  }
}

function downloads(el: HTMLElement) {
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow"><span class="eyebrow-line"></span>TRANSFER STATION / 03</p><h1>${L('از دانلود تا خط شروع.', 'Transfer & Staging Pipeline.')}</h1><p class="muted">${L('بررسی فایل، نصب مرحله‌ای و ثبت نتیجه؛ بدون موفقیت نمایشی.', 'Verified transfer, hash check, atomic staging, and commit.')}</p></div>${tasks.length && !installing ? `<button class="button secondary" id="clear-task-history">${L('پاک کردن تاریخچه', 'Clear History')}</button>` : ''}</div>${tasks.length ? `<div class="stack">${tasks.map((t) => `<article class="task"><div class="task-head">${icon(t.error ? 'triangle-alert' : t.progress === 100 ? 'circle-check' : 'download')}<div><h3>${esc(t.name)}${t.version ? ` <code dir="ltr">v${esc(t.version)}</code>` : ''}</h3><p>${esc(t.phase)}${t.started_at ? ` · ${fmtDate(t.started_at)}` : ''}</p></div><strong>${num(Math.floor(t.progress))}${L('٪', '%')}</strong></div><progress max="100" value="${t.progress}"></progress>${t.bytes ? `<small dir="ltr">${size(t.bytes)} / ${size(t.total || 0)}</small>` : ''}${t.speed && t.active && !t.paused && !t.error ? `<small>${size(t.speed)}/s · ${num(Math.ceil(t.eta || 0))} ${L('ثانیه تخمینی تا پایان دانلود', 'sec remaining')}</small>` : ''}${t.error ? `<div class="notice error">${esc(t.error)}</div><button class="button secondary" data-task-retry="${t.id}" ${catalog.some((p) => p.id === t.id) ? '' : `disabled title="${L('این بسته دیگر در کاتالوگ منتشرشده نیست؛ پیش‌نیازها فقط همراه بستهٔ اصلی تلاش مجدد می‌شوند.', 'Package no longer published; retry via primary parent package.')}"`}>${L('بررسی و تلاش مجدد', 'Inspect & Retry')}</button>` : t.progress < 100 && t.active ? `<div class="actions">${t.mode === 'download' ? `<button class="button secondary" data-task-control="${t.paused ? 'resume' : 'pause'}" data-task-id="${t.id}">${t.paused ? L('ادامه', 'Resume') : L('توقف دانلود', 'Pause')}</button>` : ''}<button class="text-button" data-task-control="cancel" data-task-id="${t.id}">${L('لغو', 'Cancel')}</button></div>` : ''}</article>`).join('')}</div>` : empty(L('صف دانلود خالی است', 'Download queue is empty'), L('با شروع نصب، پیشرفت واقعی دانلود و استخراج اینجا نمایش داده می‌شود.', 'Active downloads, hash verification, and staging logs appear here.'), 'download')}<div class="installer-flow">${[
    ['01', L('دریافت فایل', 'Fetch Artifacts')],
    ['02', L('بررسی SHA-256', 'Verify SHA-256')],
    ['03', L('استخراج و بکاپ', 'Extract & Backup')],
    ['04', L('تأیید و ثبت', 'Commit & Register')],
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
              L('لغو عملیات', 'Cancel Transfer'),
              `<p>${L('نصب ناتمام rollback می‌شود؛ فایل دانلود موقت برای تلاش مجدد باقی می‌ماند.', 'Incomplete changes roll back cleanly while keeping cached partial artifacts.')}</p><button class="button" id="cancel-job-confirm">${L('تأیید لغو', 'Confirm Cancel')}</button>`,
            );
            d.querySelector<HTMLButtonElement>('#cancel-job-confirm')!.onclick = function () {
              void busy(this as HTMLButtonElement, async () => {
                await invoke('control_job', { packageId: id, action });
                d.close();
                toast(
                  L(
                    'درخواست لغو ثبت شد؛ منتظر توقف امن عملیات بمانید.',
                    'Cancellation requested cleanly.',
                  ),
                );
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
  const lang = getLang();
  queueMicrotask(() => {
    void downloadPreferences(el).catch(handleError);
    void updateStatusPanel(el).catch(handleError);
  });
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow"><span class="eyebrow-line"></span>PREFERENCES / 04</p><h1>${L('گاراژ، به سلیقهٔ تو.', 'Launcher Preferences.')}</h1><p class="muted">${L('مسیر بازی، زبان، تم و اطلاعات اتصال را مدیریت کن.', 'Configure game root, language & direction, layout density, and connection diagnostics.')}</p></div></div><div class="settings-layout"><section class="panel"><div class="section-heading"><h2>${L('محل نصب بازی', 'Assetto Corsa Directory')}</h2>${icon('folder-open')}</div><p class="muted">${L('پوشه‌ای را انتخاب کن که فایل acs.exe و پوشه content در آن قرار دارند.', 'Choose the folder containing acs.exe and the content directory.')}</p><div class="path-box"><code dir="ltr" id="game-path">${esc(gamePath || L('هنوز مسیری انتخاب نشده', 'No folder selected yet'))}</code><button class="button secondary" id="choose-path">${icon('folder')}${L('انتخاب پوشه', 'Choose Folder')}</button></div><div class="notice">${icon('shield-check')}${native ? L('اعتبار مسیر در لایه Native بررسی می‌شود.', 'Path validation runs natively before modifying files.') : L('در پیش‌نمایش مرورگر امکان دسترسی به پوشه بازی وجود ندارد.', 'Browser previews cannot access local filesystem paths.')}</div></section><section class="panel"><div class="section-heading"><h2>${L('زبان و نمایش', 'Language & Display')}</h2>${icon('sliders-horizontal')}</div><label class="setting-row"><div><b>${L('چیدمان فشرده', 'Compact Layout')}</b><p>${L('فاصله‌های کمتر برای پنجره‌های کوچک‌تر', 'Tighter spacing for compact viewports')}</p></div><input id="compact" type="checkbox" ${compact ? 'checked' : ''}></label><label class="setting-row"><div><b>${L('زبان و جهت نمایش', 'Language & Direction')}</b><p>${L('تغییر کامل رابط بین فارسی (RTL) و انگلیسی (LTR)', 'Switch full interface between Persian (RTL) and English (LTR)')}</p></div><select id="language"><option value="fa" ${lang === 'fa' ? 'selected' : ''}>فارسی (RTL)</option><option value="en" ${lang === 'en' ? 'selected' : ''}>English (LTR)</option></select></label></section><section class="panel"><div class="section-heading"><h2>${L('وضعیت اتصال', 'Diagnostics & Runtime')}</h2>${icon('radio')}</div><dl class="definition"><dt>${L('محیط', 'Environment')}</dt><dd>${demo ? L('توسعه / داده محلی', 'Sandbox / Local API') : L('API عملیاتی', 'Production API')}</dd><dt>${L('اجرای برنامه', 'Runtime')}</dt><dd>${native ? L('دسکتاپ Tauri', 'Windows Native Tauri') : L('مرورگر / پیش‌نمایش', 'Web Browser Preview')}</dd><dt>${L('کلید خصوصی', 'Device Key')}</dt><dd>${native ? L('محافظت‌شده توسط ویندوز', 'DPAPI Protected') : L('WebCrypto آزمایشی در همین مرورگر', 'Browser WebCrypto')}</dd><dt>${L('نسخه', 'Version')}</dt><dd><code dir="ltr">${appVersion}</code></dd></dl><div class="actions"><button class="text-button" id="recover">${icon('folder-check')}${L('بررسی و بازیابی نصب نیمه‌تمام', 'Recover Interrupted Installs')}</button><button class="text-button" id="check-api">${icon('refresh-cw')}${L('بررسی اتصال', 'Check API Health')}</button><button class="text-button" id="copy-diagnostics">${icon('scroll-text')}${L('کپی گزارش تشخیصی بدون اطلاعات خصوصی', 'Copy Sanitized Diagnostics')}</button></div></section></div>`;

  el.querySelector<HTMLButtonElement>('#choose-path')!.onclick = function () {
    void busy(this as HTMLButtonElement, async () => {
      if (!native)
        throw new Error(
          L(
            'انتخاب مسیر واقعی فقط در برنامه ویندوز امکان‌پذیر است.',
            'Native folder selection is only available in the Windows desktop client.',
          ),
        );
      const { open } = await import('@tauri-apps/plugin-dialog');
      const path = await open({
        directory: true,
        multiple: false,
        title: L('پوشه Assetto Corsa را انتخاب کنید', 'Select Assetto Corsa Folder'),
      });
      if (!path) return;
      const result = await invoke<{ path: string }>('set_game_path', { path });
      gamePath = result.path;
      localStore.setItem('uhm-game-path', gamePath);
      toast(L('مسیر بازی اعتبارسنجی و ذخیره شد.', 'Game directory verified and saved.'));
      await render();
    });
  };
  el.querySelector('#compact')!.addEventListener('change', (e) => {
    compact = (e.target as HTMLInputElement).checked;
    localStore.setItem('uhm-compact', String(compact));
    document.body.classList.toggle('compact', compact);
  });
  el.querySelector('#language')!.addEventListener('change', (e) => {
    const next = (e.target as HTMLSelectElement).value === 'en' ? 'en' : 'fa';
    setLang(next);
    void render();
  });
  el.querySelector<HTMLButtonElement>('#copy-diagnostics')!.addEventListener('click', function () {
    void busy(this as HTMLButtonElement, async () => {
      const report = {
        version: appVersion,
        runtime: native ? 'windows-native' : 'browser',
        language: getLang(),
        online,
        pending_events: (await pendingEvents()).length,
        generated_at: new Date().toISOString(),
      };
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      toast(
        L(
          'گزارش تشخیصی کپی شد؛ مسیر فایل، لایسنس و کلیدها در آن نیست.',
          'Diagnostic JSON copied (paths, license codes, and keys stripped).',
        ),
      );
    });
  });
  el.querySelector<HTMLButtonElement>('#recover')!.addEventListener('click', function () {
    void busy(this as HTMLButtonElement, async () => {
      if (!native)
        throw new Error(
          L(
            'بازیابی فایل‌ها فقط در نسخه ویندوز ممکن است.',
            'Journal recovery runs only in the Windows desktop app.',
          ),
        );
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
          L('فایل‌های نیازمند بررسی', 'Conflicts Detected'),
          `<p>${num(count)} ${L('ژورنال بررسی شد. فایل‌هایی که بعد از نصب تغییر کرده بودند حفظ شدند و خودکار بازنویسی نشدند.', 'journals checked. Locally modified targets were preserved rather than overwritten.')}</p>${conflicts.map((c) => `<h3>${esc(c.package_id)}</h3>${c.conflicts.map((f) => `<div class="setting-row"><code dir="ltr">${esc(f.target)}</code><span>${esc(f.reason)} · Backup: <code dir="ltr">${esc(f.backup)}</code></span></div>`).join('')}`).join('')}`,
          true,
        );
      } else
        toast(
          L(
            `${num(count)} نصب نیمه‌تمام بدون تعارض بازیابی شد.`,
            `${num(count)} interrupted journals recovered cleanly.`,
          ),
        );
    });
  });
  el.insertAdjacentHTML(
    'beforeend',
    `<section class="panel sync-panel"><h3>${L('همگام‌سازی گزارش‌ها', 'Telemetry Queue')}</h3><p id="queue-state">${L('در حال بررسی صف پایدار…', 'Checking persistent outbox…')}</p><button class="button secondary" id="sync-now">${L('ارسال گزارش‌های ذخیره‌شده', 'Flush Queued Events')}</button><small class="muted">${L('گزارش‌های آفلاین پس از اتصال ارسال می‌شوند؛ رمز، مسیر شخصی و لینک کامل ثبت نمی‌شود.', 'Offline events sync automatically when online; private paths and secrets are never logged.')}</small></section>`,
  );
  void pendingEvents().then((rows) => {
    const target = el.querySelector('#queue-state');
    if (target)
      target.textContent = `${num(rows.length)} ${L('رویداد در انتظار تأیید سرور', 'events pending sync')}`;
  });
  el.querySelector('#sync-now')!.addEventListener(
    'click',
    () =>
      void flushEvents().then(() =>
        toast(
          L(
            'تلاش برای همگام‌سازی انجام شد؛ موارد تأییدنشده در صف می‌مانند.',
            'Sync attempted; unacknowledged events remain queued safely.',
          ),
        ),
      ),
  );
  el.querySelector('#check-api')!.addEventListener(
    'click',
    () =>
      void api('/health')
        .then(() => toast(L('ارتباط با API برقرار است.', 'API connection healthy.')))
        .catch(handleError),
  );
  decorate();
}

function logoutDialog() {
  const d = modal(
    L('نشست مدیریت', 'Admin Session'),
    `<p class="muted">${L('با خروج، دسترسی این پنجره به پنل پایان می‌یابد.', 'Signing out clears the active control room bearer token from this session.')}</p><button class="button full" id="logout">${L('خروج از پنل', 'Sign Out')}</button>`,
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
  app.innerHTML = `<div class="boot"><span class="brand-mark">AC</span><p>${L('آماده برای دور بعدی…', 'Preparing garage…')}</p></div>`;
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
        service.settings.message ||
        L(
          'بعضی عملیات برای نگهداری سرویس موقتاً متوقف است.',
          'Some operations are temporarily paused for maintenance.',
        );
    const [result, contactRes] = await Promise.all([
      api('/catalog'),
      api<{ contact: Omit<ContactSettings, 'updated_by'>; configured: boolean }>('/contact').catch(
        () => ({ contact: defaultContact(0), configured: false }),
      ),
    ]);
    catalog = result.packages;
    for (const c of result.categories || []) category[c.id] = c.name;
    publicContact = contactRes.contact || defaultContact(0);
    contactConfigured = Boolean(contactRes.configured);
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
          `${num(pending.length)} ${L('ژورنال نصب نیازمند بررسی است؛ از تنظیمات، بازیابی را اجرا کنید.', 'interrupted install journals require recovery check in Settings.')}`,
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
          task.phase = L('نصب تکمیل شد', 'Installed');
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
        task.phase = L('منتظر تأیید فایل‌های نصب', 'Awaiting file commit approval');
        task.mode = 'approval';
        task.progress = 72;
        persistTasks();
      }
      const d = modal(
        L('تأیید فایل‌های نصب', 'Approve File Commit'),
        `<h3>${esc(p.name)}</h3><p>${L(`استخراج انجام شده، اما هنوز هیچ فایل بازی تغییر نکرده است. ${num(p.files.length)} مقصد واقعی را بررسی کنید.`, `Extraction complete; no game files changed yet. Review ${num(p.files.length)} targets.`)}</p><p>${L('نسخه', 'Version')} <code dir="ltr">${esc(p.version)}</code> · ${L('دانلود', 'Download')} ${size(p.download_bytes)} · ${L('فضای موردنیاز:', 'Required:')} ${size(p.required)} · ${L('آزاد:', 'Free:')} ${size(p.free)}</p><p class="muted">${L('مقصد:', 'Destination:')} <code dir="ltr">${esc(p.destination)}</code></p>${p.dependencies.length ? `<p>${L('پیش‌نیازها:', 'Dependencies:')} ${p.dependencies.map((d) => `${esc(d.name)}${d.version ? ` v${esc(d.version)}` : ''}`).join(', ')}</p>` : ''}${p.warnings.map((w) => `<div class="notice error">${esc(w)}</div>`).join('')}<div class="notice">${L('فایل اجرایی فقط کپی می‌شود؛ هیچ EXE دانلودشده‌ای اجرا نخواهد شد. بستن این پنجره نصب را لغو می‌کند.', 'Downloaded executables are never executed. Closing cancels the transaction.')}</div><div class="file-preview-list">${p.files.map((f) => `<div class="setting-row"><code dir="ltr">${esc(f.path)}</code><span>${size(f.bytes)} · ${f.overwrite ? L('بکاپ و جایگزینی', 'Backup & replace') : L('فایل جدید', 'New file')}${f.shared ? ` · ${L('مشترک با', 'Shared:')} ${esc(f.owners.join(', '))}` : ''}${f.executable ? L(' · فایل اجرایی', ' · Executable') : ''}</span></div>`).join('')}</div><div class="actions"><button class="button" id="approve-install">${L('تأیید و اعمال تغییرات', 'Approve & Commit')}</button><button class="button secondary" id="reject-install">${L('انصراف', 'Cancel')}</button></div>`,
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
          t.phase = L('نصب تکمیل شد', 'Installed');
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
  toast(
    L(
      'ذخیره گزارش‌ها ممکن نشد؛ فضای ذخیره‌سازی برنامه را بررسی کنید.',
      'Unable to persist telemetry outbox; verify storage permissions.',
    ),
    true,
  ),
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
