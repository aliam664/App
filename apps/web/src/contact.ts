import {
  ContactInput,
  contactChannelHref,
  defaultContact,
  isContactConfigured,
  type AuditEvent,
  type ContactExtraLink,
  type ContactSettings,
} from '../../../packages/contracts/src/index';
import { api } from './api';
import { L, fmtDate, fmtTime, getLang } from './i18n';
import { busy, decorate, empty, esc, field, icon, toast } from './ui';
import { z } from 'zod';

type ChannelKey = 'email' | 'phone' | 'telegram' | 'discord' | 'instagram' | 'youtube' | 'website';

type ChannelRow = {
  key: ChannelKey;
  labelFa: string;
  labelEn: string;
  iconName: string;
  value: string;
  href: string;
};

function resolveChannels(contact: Partial<ContactSettings>): ChannelRow[] {
  const defs: {
    key: ChannelKey;
    labelFa: string;
    labelEn: string;
    iconName: string;
  }[] = [
    { key: 'email', labelFa: 'ایمیل', labelEn: 'Email', iconName: 'mail' },
    { key: 'phone', labelFa: 'تلفن', labelEn: 'Phone', iconName: 'phone' },
    { key: 'telegram', labelFa: 'تلگرام', labelEn: 'Telegram', iconName: 'send' },
    { key: 'discord', labelFa: 'دیسکورد', labelEn: 'Discord', iconName: 'message-circle' },
    { key: 'instagram', labelFa: 'اینستاگرام', labelEn: 'Instagram', iconName: 'globe' },
    { key: 'youtube', labelFa: 'یوتیوب', labelEn: 'YouTube', iconName: 'external-link' },
    { key: 'website', labelFa: 'وب‌سایت', labelEn: 'Website', iconName: 'globe' },
  ];
  const out: ChannelRow[] = [];
  for (const def of defs) {
    const raw = String(contact[def.key] || '').trim();
    const href = contactChannelHref(def.key, raw);
    if (raw && href) out.push({ ...def, value: raw, href });
  }
  return out;
}

function localizedText(
  faValue: string | undefined,
  enValue: string | undefined,
  lang = getLang(),
): string {
  const primary = (lang === 'en' ? enValue : faValue)?.trim();
  const secondary = (lang === 'en' ? faValue : enValue)?.trim();
  return primary || secondary || '';
}

export function renderContactBody(
  contact: Partial<ContactSettings>,
  configured: boolean,
  lang = getLang(),
): string {
  if (!configured || !isContactConfigured(contact)) {
    return empty(
      L('هنوز راه ارتباطی ثبت نشده است', 'No contact channels published yet', lang),
      L(
        'مدیر سیستم هنوز اطلاعات تماس عمومی را تنظیم نکرده است. این بخش پس از انتشار اطلاعات رسمی به‌روز می‌شود.',
        'The platform operator has not published public contact details yet. Configured channels will appear here automatically.',
        lang,
      ),
      'mail',
    );
  }
  const channels = resolveChannels(contact);
  const intro = localizedText(contact.intro_fa, contact.intro_en, lang);
  const hours = localizedText(contact.support_hours_fa, contact.support_hours_en, lang);
  const locationText = localizedText(contact.location_fa, contact.location_en, lang);
  const note = localizedText(contact.response_note_fa, contact.response_note_en, lang);
  const extraLinks = (contact.extra_links || []).filter((l) => {
    try {
      return new URL(l.url).protocol === 'https:';
    } catch {
      return false;
    }
  });

  return `${intro ? `<p class="detail-description">${esc(intro)}</p>` : ''}
  ${
    channels.length || extraLinks.length
      ? `<div class="contact-grid">
          ${channels
            .map(
              (c) => `<article class="contact-card">
                <div class="contact-card-head">
                  <span>${esc(lang === 'en' ? c.labelEn : c.labelFa)}</span>
                  ${icon(c.iconName)}
                </div>
                <a href="${esc(c.href)}" dir="ltr"${c.href.startsWith('https://') ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(c.value)}</a>
              </article>`,
            )
            .join('')}
          ${extraLinks
            .map((l) => {
              const label = localizedText(l.label_fa, l.label_en, lang);
              return `<article class="contact-card">
                <div class="contact-card-head">
                  <span>${esc(label)}</span>
                  ${icon('external-link')}
                </div>
                <a href="${esc(l.url)}" dir="ltr" target="_blank" rel="noopener noreferrer">${esc(new URL(l.url).hostname)}</a>
              </article>`;
            })
            .join('')}
        </div>`
      : ''
  }
  ${
    hours || locationText || note
      ? `<div class="contact-meta-strip">
          ${
            hours
              ? `<section class="panel"><div class="section-heading"><h3>${L('ساعات پاسخ‌گویی', 'Support Hours', lang)}</h3>${icon('clock')}</div><p class="muted">${esc(hours)}</p></section>`
              : ''
          }
          ${
            locationText
              ? `<section class="panel"><div class="section-heading"><h3>${L('موقعیت / منطقه زمانی', 'Location / Region', lang)}</h3>${icon('map-pin')}</div><p class="muted">${esc(locationText)}</p></section>`
              : ''
          }
          ${
            note
              ? `<section class="panel"><div class="section-heading"><h3>${L('نکته پاسخ‌گویی', 'Response Notes', lang)}</h3>${icon('info')}</div><p class="muted">${esc(note)}</p></section>`
              : ''
          }
        </div>`
      : ''
  }`;
}

export function renderHomeContactStrip(
  contact: Partial<ContactSettings> | null | undefined,
  configured: boolean,
  onOpenContact: () => void,
): string {
  if (!configured || !contact || !isContactConfigured(contact)) return '';
  const lang = getLang();
  const channels = resolveChannels(contact).slice(0, 3);
  const headline = localizedText(contact.headline_fa, contact.headline_en, lang);
  return `<section class="section" aria-label="${L('اطلاعات تماس', 'Support Channels')}">
    <div class="container">
      <div class="home-contact-band">
        <div>
          <div class="eyebrow"><span class="eyebrow-line"></span>${L('SUPPORT & CHANNELS', 'SUPPORT & CHANNELS', lang)}</div>
          <h3>${esc(headline || L('ارتباط و پشتیبانی فنی', 'Support & Official Channels', lang))}</h3>
        </div>
        <div class="home-contact-links">
          ${channels
            .map(
              (c) =>
                `<a class="button secondary" href="${esc(c.href)}"${c.href.startsWith('https://') ? ' target="_blank" rel="noopener noreferrer"' : ''}>${icon(c.iconName)}<span>${esc(lang === 'en' ? c.labelEn : c.labelFa)}</span></a>`,
            )
            .join('')}
          <button type="button" class="button" id="home-open-contact">${L('صفحه تماس با ما', 'Contact Page', lang)} ${icon(lang === 'fa' ? 'arrow-left' : 'arrow-up-right')}</button>
        </div>
      </div>
    </div>
  </section>`;
}

export function bindHomeContactStrip(el: HTMLElement, onOpenContact: () => void) {
  el.querySelector('#home-open-contact')?.addEventListener('click', onOpenContact);
}

export function renderContactPage(
  el: HTMLElement,
  contact: Partial<ContactSettings>,
  configured: boolean,
) {
  const lang = getLang();
  const headline = localizedText(contact.headline_fa, contact.headline_en, lang);
  el.innerHTML = `<div class="page-title">
    <div>
      <p class="eyebrow"><span class="eyebrow-line"></span>CONTACT / DESK</p>
      <h1>${esc(headline || L('تماس با ما و پشتیبانی', 'Contact & Support Desk', lang))}</h1>
      <p class="muted">${L('راه‌های ارتباطی ثبت‌شده توسط مدیریت پلتفرم.', 'Official communication channels configured by platform administrators.', lang)}</p>
    </div>
  </div>
  ${renderContactBody(contact, configured, lang)}`;
  decorate();
}

export async function renderContactAdmin(
  el: HTMLElement,
  token: string,
  reloadOverview: () => Promise<void>,
  onPublicUpdated: (contact: ContactSettings, configured: boolean) => void,
) {
  const lang = getLang();
  const res = await api<{
    contact: ContactSettings;
    configured: boolean;
    audit: AuditEvent[];
  }>('/admin/contact', undefined, token);
  let current = res.contact ?? defaultContact(0);
  let auditRows = res.audit || [];
  let previewLang: 'fa' | 'en' = lang;

  const extraRow = (l?: Partial<ContactExtraLink>) => `<div class="extra-link-row">
    <div class="section-heading">
      <b>${L('لینک سفارشی', 'Custom Link')}</b>
      <button type="button" class="text-button" data-remove-link>${icon('trash-2')}${L('حذف', 'Remove')}</button>
    </div>
    <div class="form-grid">
      ${field(L('عنوان فارسی', 'Persian Label'), `<input data-link="label_fa" maxlength="60" value="${esc(l?.label_fa || '')}">`)}
      ${field(L('عنوان انگلیسی', 'English Label'), `<input data-link="label_en" maxlength="60" dir="ltr" value="${esc(l?.label_en || '')}">`)}
    </div>
    ${field(L('نشانی HTTPS', 'HTTPS URL'), `<input data-link="url" type="url" dir="ltr" placeholder="https://…" value="${esc(l?.url || '')}">`)}
  </div>`;

  const renderForm = () => {
    el.innerHTML = `<div class="page-title">
      <div>
        <p class="eyebrow"><span class="eyebrow-line"></span>CONTACT STUDIO</p>
        <h1>${L('مدیریت اطلاعات تماس با ما', 'Contact Us Studio')}</h1>
        <p class="muted">${L('تمام فیلدها در شروع خالی هستند. هر مورد خالی در نمای عمومی مخفی می‌ماند.', 'All fields start blank by default. Empty fields are automatically hidden from public view.')}</p>
      </div>
      <span class="console-pill">${icon('shield-check')} v${current.version}</span>
    </div>
    <div class="contact-admin-grid">
      <form id="contact-admin-form" class="panel" data-guard-discard>
        <div class="section-heading">
          <h2>${L('اطلاعات و کانال‌های تماس', 'Channels & Details')}</h2>
          <button type="button" class="text-button" id="contact-clear-all">${L('پاک‌سازی همه فیلدها', 'Clear all fields')}</button>
        </div>
        <div id="contact-form-errors" class="notice error" hidden role="alert"></div>
        <div class="form-grid">
          ${field(L('تیتر فارسی', 'Headline (Persian)'), `<input name="headline_fa" maxlength="120" value="${esc(current.headline_fa)}">`)}
          ${field(L('تیتر انگلیسی', 'Headline (English)'), `<input name="headline_en" maxlength="120" dir="ltr" value="${esc(current.headline_en)}">`)}
        </div>
        <div class="form-grid">
          ${field(L('معرفی فارسی', 'Intro (Persian)'), `<textarea name="intro_fa" maxlength="600" rows="3">${esc(current.intro_fa)}</textarea>`)}
          ${field(L('معرفی انگلیسی', 'Intro (English)'), `<textarea name="intro_en" maxlength="600" rows="3" dir="ltr">${esc(current.intro_en)}</textarea>`)}
        </div>
        <div class="form-grid">
          ${field(L('ایمیل پشتیبانی', 'Support Email'), `<input name="email" type="email" dir="ltr" maxlength="160" value="${esc(current.email)}" placeholder="support@example.com">`)}
          ${field(L('شماره تماس', 'Phone'), `<input name="phone" dir="ltr" maxlength="40" value="${esc(current.phone)}" placeholder="+98 21 …">`)}
          ${field(L('تلگرام (@handle یا https://t.me/...)', 'Telegram (@handle or https://t.me/...)'), `<input name="telegram" dir="ltr" maxlength="256" value="${esc(current.telegram)}" placeholder="@username">`)}
          ${field(L('دیسکورد (HTTPS)', 'Discord Invite (HTTPS)'), `<input name="discord" type="url" dir="ltr" maxlength="256" value="${esc(current.discord)}" placeholder="https://discord.gg/…">`)}
          ${field(L('اینستاگرام (@handle یا HTTPS)', 'Instagram (@handle or HTTPS)'), `<input name="instagram" dir="ltr" maxlength="256" value="${esc(current.instagram)}" placeholder="@username">`)}
          ${field(L('یوتیوب (HTTPS)', 'YouTube (HTTPS)'), `<input name="youtube" type="url" dir="ltr" maxlength="256" value="${esc(current.youtube)}" placeholder="https://youtube.com/…">`)}
          ${field(L('وب‌سایت رسمی (HTTPS)', 'Official Website (HTTPS)'), `<input name="website" type="url" dir="ltr" maxlength="256" value="${esc(current.website)}" placeholder="https://…">`)}
        </div>
        <div class="form-grid">
          ${field(L('ساعات پاسخ‌گویی فارسی', 'Support Hours (Persian)'), `<input name="support_hours_fa" maxlength="160" value="${esc(current.support_hours_fa)}">`)}
          ${field(L('ساعات پاسخ‌گویی انگلیسی', 'Support Hours (English)'), `<input name="support_hours_en" maxlength="160" dir="ltr" value="${esc(current.support_hours_en)}">`)}
          ${field(L('موقعیت فارسی', 'Location (Persian)'), `<input name="location_fa" maxlength="160" value="${esc(current.location_fa)}">`)}
          ${field(L('موقعیت انگلیسی', 'Location (English)'), `<input name="location_en" maxlength="160" dir="ltr" value="${esc(current.location_en)}">`)}
        </div>
        <div class="form-grid">
          ${field(L('توضیح پاسخ‌گویی فارسی', 'Response Note (Persian)'), `<textarea name="response_note_fa" maxlength="300" rows="2">${esc(current.response_note_fa)}</textarea>`)}
          ${field(L('توضیح پاسخ‌گویی انگلیسی', 'Response Note (English)'), `<textarea name="response_note_en" maxlength="300" rows="2" dir="ltr">${esc(current.response_note_en)}</textarea>`)}
        </div>
        <div class="section-heading">
          <h3>${L('لینک‌های اضافی (حداکثر ۶)', 'Additional HTTPS Links (max 6)')}</h3>
          <button type="button" class="text-button" id="add-extra-link">${icon('plus')}${L('افزودن لینک', 'Add link')}</button>
        </div>
        <div id="extra-links-container">${(current.extra_links || []).map((l) => extraRow(l)).join('')}</div>
        <button type="submit" class="button full">${L('ذخیره و انتشار در تماس با ما', 'Save & Publish Contact Details')}</button>
      </form>

      <div class="stack">
        <section class="panel" aria-live="polite">
          <div class="section-heading">
            <h2>${L('پیش‌نمایش زنده', 'Live Preview')}</h2>
            <div class="actions">
              <button type="button" class="button secondary" id="preview-lang-fa">FA</button>
              <button type="button" class="button secondary" id="preview-lang-en">EN</button>
            </div>
          </div>
          <div id="contact-live-preview" dir="${previewLang === 'fa' ? 'rtl' : 'ltr'}" lang="${previewLang}"></div>
        </section>

        <section class="panel">
          <div class="section-heading">
            <h2>${L('تاریخچه تغییرات تماس', 'Contact Change Audit')}</h2>
            ${icon('scroll-text')}
          </div>
          <div id="contact-audit-list">
            ${
              auditRows.length
                ? `<div class="audit-timeline">${auditRows
                    .map(
                      (a) => `<article>
                        <b dir="ltr">${esc(a.action)}</b>
                        <p class="muted">${esc(a.actor)}</p>
                        <small>${fmtDate(a.created_at)} · ${fmtTime(a.created_at)}</small>
                      </article>`,
                    )
                    .join('')}</div>`
                : `<p class="muted">${L('هنوز تغییری ثبت نشده است.', 'No changes recorded yet.')}</p>`
            }
          </div>
        </section>
      </div>
    </div>`;

    const form = el.querySelector<HTMLFormElement>('#contact-admin-form')!;
    const extraContainer = el.querySelector<HTMLElement>('#extra-links-container')!;
    const previewEl = el.querySelector<HTMLElement>('#contact-live-preview')!;
    const errorBox = el.querySelector<HTMLElement>('#contact-form-errors')!;

    const readFormDraft = () => {
      const f = new FormData(form);
      const extra_links = [...extraContainer.querySelectorAll<HTMLElement>('.extra-link-row')]
        .map((row) => ({
          label_fa: (row.querySelector('[data-link=label_fa]') as HTMLInputElement).value.trim(),
          label_en: (row.querySelector('[data-link=label_en]') as HTMLInputElement).value.trim(),
          url: (row.querySelector('[data-link=url]') as HTMLInputElement).value.trim(),
        }))
        .filter((l) => l.label_fa || l.label_en || l.url);

      return {
        headline_fa: String(f.get('headline_fa') || '').trim(),
        headline_en: String(f.get('headline_en') || '').trim(),
        intro_fa: String(f.get('intro_fa') || '').trim(),
        intro_en: String(f.get('intro_en') || '').trim(),
        email: String(f.get('email') || '').trim(),
        phone: String(f.get('phone') || '').trim(),
        telegram: String(f.get('telegram') || '').trim(),
        discord: String(f.get('discord') || '').trim(),
        instagram: String(f.get('instagram') || '').trim(),
        youtube: String(f.get('youtube') || '').trim(),
        website: String(f.get('website') || '').trim(),
        support_hours_fa: String(f.get('support_hours_fa') || '').trim(),
        support_hours_en: String(f.get('support_hours_en') || '').trim(),
        location_fa: String(f.get('location_fa') || '').trim(),
        location_en: String(f.get('location_en') || '').trim(),
        response_note_fa: String(f.get('response_note_fa') || '').trim(),
        response_note_en: String(f.get('response_note_en') || '').trim(),
        extra_links,
        expected_version: current.version,
      };
    };

    const refreshPreview = () => {
      const draft = readFormDraft();
      const parsed = ContactInput.safeParse(draft);
      if (!parsed.success) {
        errorBox.hidden = false;
        errorBox.textContent = parsed.error.issues
          .map((i) => `${i.path.join('.') || 'field'}: ${i.message}`)
          .join(' · ');
      } else {
        errorBox.hidden = true;
        errorBox.textContent = '';
      }
      const candidate = { ...defaultContact(current.version), ...draft };
      previewEl.dir = previewLang === 'fa' ? 'rtl' : 'ltr';
      previewEl.lang = previewLang;
      previewEl.innerHTML = renderContactBody(
        candidate,
        isContactConfigured(candidate),
        previewLang,
      );
      decorate();
    };

    const bindRowEvents = () => {
      extraContainer.querySelectorAll<HTMLButtonElement>('[data-remove-link]').forEach((b) => {
        b.onclick = () => {
          b.closest('.extra-link-row')?.remove();
          refreshPreview();
        };
      });
    };

    el.querySelector('#add-extra-link')?.addEventListener('click', () => {
      if (extraContainer.querySelectorAll('.extra-link-row').length >= 6) {
        toast(L('حداکثر ۶ لینک اضافی مجاز است.', 'Maximum 6 extra links allowed.'), true);
        return;
      }
      extraContainer.insertAdjacentHTML('beforeend', extraRow());
      bindRowEvents();
      refreshPreview();
      decorate();
    });

    el.querySelector('#contact-clear-all')?.addEventListener('click', () => {
      if (
        !window.confirm(
          L(
            'همه فیلدهای فرم پاک شوند؟ تا زمان ذخیره تغییری اعمال نمی‌شود.',
            'Clear all form fields? Changes are not saved until you submit.',
          ),
        )
      )
        return;
      form
        .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
        .forEach((i) => {
          i.value = '';
        });
      extraContainer.innerHTML = '';
      refreshPreview();
    });

    el.querySelector('#preview-lang-fa')?.addEventListener('click', () => {
      previewLang = 'fa';
      refreshPreview();
    });
    el.querySelector('#preview-lang-en')?.addEventListener('click', () => {
      previewLang = 'en';
      refreshPreview();
    });

    form.addEventListener('input', refreshPreview);
    form.onsubmit = (e) => {
      e.preventDefault();
      const draft = readFormDraft();
      const parsed = ContactInput.safeParse(draft);
      if (!parsed.success) {
        refreshPreview();
        toast(
          L('لطفاً خطاهای فرم تماس را اصلاح کنید.', 'Please resolve validation errors first.'),
          true,
        );
        return;
      }
      void busy(form.querySelector<HTMLButtonElement>('[type=submit]')!, async () => {
        const saved = await api<{
          contact: ContactSettings;
          configured: boolean;
          audit: AuditEvent[];
        }>('/admin/contact', parsed.data, token);
        current = saved.contact;
        auditRows = saved.audit;
        onPublicUpdated(saved.contact, saved.configured);
        toast(L('اطلاعات تماس با موفقیت ذخیره و منتشر شد.', 'Contact settings saved & published.'));
        await reloadOverview();
      });
    };

    bindRowEvents();
    refreshPreview();
    decorate();
  };

  renderForm();
}
