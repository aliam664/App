import { api, supabase } from './api';
import { esc, icon, decorate, fa, date, badge, category, toast, handleError, modal, busy, field, empty } from './ui';
import { PackageSpec, type License, type AuditEvent, type InstallReport } from '../../../packages/contracts/src/index';
export type Overview = { admin: { id: string; role: string }; licenses: Omit<License,'code_hash'>[]; packages: PackageSpec[]; events: AuditEvent[]; reports: InstallReport[] };
let overview: Overview;
let token = '';
let refreshPage: () => Promise<void>;
const statuses: Record<string,string> = { active:'فعال',unused:'فعال‌نشده',suspended:'معلق',revoked:'لغوشده',published:'منتشرشده',draft:'پیش‌نویس',archived:'بایگانی' };
const can = (section: string) => overview.admin.role === 'owner' || overview.admin.role === `${section}_manager`;
export async function renderAdmin(container: HTMLElement, page: string, adminToken: string, reload: () => Promise<void>) {
  token = adminToken; refreshPage = reload;
  overview = await api<Overview>('/admin/overview', undefined, token);
  if (page === 'dashboard') dashboard(container);
  else if (page === 'licenses') licenses(container);
  else if (page === 'packages' || page === 'versions') packages(container, page === 'versions');
  else if (page === 'devices') devices(container);
  else logs(container);
  decorate();
}
function dashboard(el: HTMLElement) {
  const { licenses, packages, events, reports } = overview;
  const active = licenses.filter(l => l.status === 'active' && Date.parse(l.expires_at!) > Date.now()).length;
  const expired = licenses.filter(l => l.expires_at && Date.parse(l.expires_at) <= Date.now()).length;
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow">CONTROL ROOM / 01</p><h1>همه‌چیز، زیر کنترل.</h1><p class="muted">نمای روشن از اشتراک‌ها، محتوا و اتفاق‌های اخیر.</p></div><button class="button secondary" id="admin-refresh">${icon('refresh-cw')}به‌روزرسانی</button></div>
  <div class="metrics">${[[licenses.length,'کل لایسنس‌ها','key-round'],[active,'اشتراک فعال','badge-check'],[expired,'منقضی‌شده','clock-3'],[packages.filter(p=>p.status==='published').length,'پکیج منتشرشده','package']].map(([n,label,i])=>`<div class="metric">${icon(String(i))}<span>${label}</span><strong>${fa(Number(n))}</strong></div>`).join('')}</div>
  <div class="dashboard-grid"><section class="panel"><div class="section-heading"><h2>ترکیب اشتراک‌ها</h2><span class="subtle">بر اساس دادهٔ ثبت‌شده</span></div><div class="tier-bars">${['normal','pro','vip'].map(t=>{const count=licenses.filter(l=>l.tier===t).length;return `<div><div>${badge(t)}<b>${fa(count)} <small>لایسنس</small></b></div><progress max="${Math.max(licenses.length,1)}" value="${count}"></progress></div>`;}).join('')}</div><div class="panel-note">${icon('info')}تعداد لایسنس به‌معنی تعداد اشخاص احراز هویت‌شده نیست.</div></section>
  <section class="panel"><div class="section-heading"><h2>وضعیت محتوا</h2><span class="subtle">چرخهٔ انتشار</span></div><div class="release-stats">${['published','draft','archived'].map(s=>`<div><span class="status ${s}">${statuses[s]}</span><strong>${fa(packages.filter(p=>p.status===s).length)}</strong></div>`).join('')}</div><p class="muted">${fa(reports.filter(r=>r.status==='installed').length)} نصب موفق و ${fa(reports.filter(r=>r.status==='failed').length)} خطا توسط کلاینت‌ها گزارش شده است.</p></section></div>
  <section class="panel"><div class="section-heading"><h2>آخرین فعالیت‌ها</h2><span class="subtle">ردپای عملیات مدیریتی</span></div>${eventTable(events.slice(0,6))}</section>`;
  el.querySelector('#admin-refresh')!.addEventListener('click',()=>void refreshPage());
}
function licenses(el: HTMLElement) {
  el.innerHTML = `<div class="page-title"><div><p class="eyebrow">ACCESS MANAGEMENT / 02</p><h1>هر دسترسی، یک هویت.</h1><p class="muted">تولید، تمدید و کنترل لایسنس‌های تک‌دستگاهی.</p></div>${can('license')?`<button class="button" id="generate">${icon('plus')}تولید لایسنس</button>`:''}</div>
  <div class="toolbar"><label class="search">${icon('search')}<input id="license-search" placeholder="جست‌وجوی شناسه یا پیشوند لایسنس…"></label><select id="license-filter"><option value="all">همه وضعیت‌ها</option>${Object.entries(statuses).slice(0,4).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}<option value="expired">منقضی‌شده</option></select></div><div class="panel table-panel" id="license-table"></div>`;
  const render = () => {
    const q=(el.querySelector('#license-search') as HTMLInputElement).value.toLowerCase(), filter=(el.querySelector('#license-filter') as HTMLSelectElement).value;
    const items=overview.licenses.filter(l=>(`${l.id} ${l.prefix}`.toLowerCase().includes(q))&&(filter==='all'||(filter==='expired'?l.expires_at&&Date.parse(l.expires_at)<Date.now():l.status===filter)));
    el.querySelector('#license-table')!.innerHTML=items.length?`<div class="table-scroll"><table><thead><tr><th>شناسه / پیشوند</th><th>سطح</th><th>وضعیت</th><th>اعتبار تا</th><th>دستگاه</th><th>عملیات</th></tr></thead><tbody>${items.map(l=>`<tr><td><code>${esc(l.prefix)}••••</code><small class="cell-sub" dir="ltr">${l.id.slice(0,8)}</small></td><td>${badge(l.tier)}</td><td><span class="status ${l.status}">${l.expires_at&&Date.parse(l.expires_at)<Date.now()?'منقضی‌شده':statuses[l.status]}</span></td><td>${date(l.expires_at)}<small class="cell-sub">${fa(l.duration_days)} روز از فعال‌سازی</small></td><td>${l.device_thumbprint?`<span class="device-dot"></span><code>${esc(l.device_thumbprint.slice(0,8))}</code>`:'—'}</td><td>${can('license')?`<button class="text-button" data-license="${l.id}">مدیریت ${icon('chevron-left')}</button>`:'فقط مشاهده'}</td></tr>`).join('')}</tbody></table></div>`:empty('لایسنسی پیدا نشد','فیلتر را تغییر دهید یا یک لایسنس جدید بسازید.','key-round');
    el.querySelectorAll<HTMLButtonElement>('[data-license]').forEach(b=>b.onclick=()=>licenseDialog(overview.licenses.find(l=>l.id===b.dataset.license)!)); decorate();
  };
  el.querySelector('#license-search')!.addEventListener('input',render); el.querySelector('#license-filter')!.addEventListener('change',render);
  el.querySelector('#generate')?.addEventListener('click',generateDialog); render();
}
function generateDialog() {
  const d=modal('تولید لایسنس',`<p class="muted">کد کامل فقط یک‌بار نمایش داده می‌شود. شروع اعتبار در اولین فعال‌سازی است.</p><form id="generate-form"><div class="form-grid">${field('سطح اشتراک','<select name="tier"><option value="normal">Normal</option><option value="pro">Pro</option><option value="vip">VIP</option></select>')}${field('اعتبار (روز)','<input name="duration_days" type="number" min="1" max="1095" value="30" required>')}${field('تعداد','<input name="count" type="number" min="1" max="100" value="1" required>')}</div><div class="notice">${icon('monitor')}هر لایسنس فقط یک دستگاه فعال دارد.</div><button class="button full" type="submit">تولید و نمایش کدها</button></form>`);
  d.querySelector('form')!.onsubmit=e=>{e.preventDefault();void busy(d.querySelector('button[type=submit]')!,async()=>{
    const f=new FormData(d.querySelector('form')!); const {codes}=await api('/admin/licenses',{tier:f.get('tier'),duration_days:Number(f.get('duration_days')),count:Number(f.get('count'))},token);
    d.close(); const out=modal('کدهای شما آماده‌اند',`<p class="muted">این کدها در فهرست مدیریت قابل بازیابی نیستند. اکنون آن‌ها را ذخیره کنید.</p><textarea id="codes" rows="7" readonly dir="ltr">${esc(codes.join('\n'))}</textarea><div class="actions"><button class="button" id="download-codes">${icon('download')}خروجی CSV</button><button class="button secondary" id="copy-codes">کپی کدها</button></div>`);
    out.querySelector('#copy-codes')!.addEventListener('click',()=>void navigator.clipboard.writeText(codes.join('\n')).then(()=>toast('کدها کپی شدند.')).catch(handleError));
    out.querySelector('#download-codes')!.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob(['code\n'+codes.join('\n')],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='uhm-licenses.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    await refreshPage();
  });};
}
function licenseDialog(l: Overview['licenses'][number]) {
  const d=modal('مدیریت لایسنس',`<div class="detail-meta">${badge(l.tier)}<code>${esc(l.prefix)}••••</code><span class="status ${l.status}">${statuses[l.status]}</span></div><dl class="definition"><dt>فعال‌سازی اول</dt><dd>${date(l.activated_at)}</dd><dt>انقضا</dt><dd>${date(l.expires_at)}</dd><dt>تعداد اتصال‌ها</dt><dd>${fa(l.activation_count)}</dd><dt>دستگاه</dt><dd dir="ltr">${esc(l.device_thumbprint?.slice(0,18)||'متصل نشده')}</dd></dl><div class="stack">${[['extend','تمدید ۳۰ روز'],['suspend','تعلیق دسترسی'],['resume','رفع تعلیق'],['reset','آزادسازی دستگاه'],['revoke','لغو لایسنس']].map(([a,t])=>`<button class="button ${a==='revoke'?'danger-button':'secondary'}" data-action="${a}">${t}</button>`).join('')}</div><p class="fine-print">آزادسازی، مجوز آفلاین صادرشده روی دستگاه قبلی را فوراً باطل نمی‌کند.</p>`);
  d.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(b=>b.onclick=()=>{
    const confirm=modal('تأیید عملیات',`<p>آیا از «${esc(b.textContent)}» مطمئن هستید؟ این تغییر ثبت می‌شود.</p><button class="button full" id="confirm-action">تأیید و ثبت</button>`);
    confirm.querySelector<HTMLButtonElement>('#confirm-action')!.onclick=function(){void busy(this as HTMLButtonElement,async()=>{await api(`/admin/licenses/${l.id}/${b.dataset.action}`,b.dataset.action==='extend'?{days:30}:{},token);confirm.close();d.close();toast('تغییر ثبت شد.');await refreshPage();});};
  });
}
function packages(el: HTMLElement, versions: boolean) {
  el.innerHTML=`<div class="page-title"><div><p class="eyebrow">CONTENT STUDIO / 03</p><h1>${versions?'انتشار بعدی، دقیق‌تر.':'محتوا را شما می‌سازید.'}</h1><p class="muted">${versions?'نسخه، تغییرات و چرخهٔ انتشار پکیج‌ها.':'چند فایل، چند مرحله؛ بدون نیاز به ساخت دوباره لانچر.'}</p></div>${can('content')?'<button class="button" id="new-package">'+icon('plus')+'پکیج جدید</button>':''}</div><div class="panel table-panel"><div class="table-scroll"><table><thead><tr><th>پکیج</th><th>نسخه</th><th>سطح</th><th>وضعیت</th><th>فایل / پیش‌نیاز</th><th>عملیات</th></tr></thead><tbody>${overview.packages.map(p=>`<tr><td><div class="table-product"><img src="${esc(p.image)}" alt=""><span>${esc(p.name)}<small class="cell-sub" dir="ltr">${esc(p.slug)}</small></span></div></td><td><code>v${esc(p.version)}</code></td><td>${badge(p.tier)}</td><td><span class="status ${p.status}">${statuses[p.status]}</span></td><td>${fa(p.files.length)} / ${fa(p.dependencies.length)}</td><td><button class="text-button" data-edit="${p.id}">${can('content')?'ویرایش / انتشار':'مشاهده'} ${icon('chevron-left')}</button></td></tr>`).join('')}</tbody></table></div></div><p class="fine-print">انتشار نسخه‌های بدون فایل در این پیش‌نمایش صرفاً نمونه است. API انتشار واقعی، فایل و هش معتبر را الزامی می‌کند. نسخهٔ منتشرشده تغییرناپذیر است.</p>`;
  el.querySelector('#new-package')?.addEventListener('click',()=>editPackage());
  el.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach(b=>b.onclick=()=>editPackage(overview.packages.find(p=>p.id===b.dataset.edit)));
}
function editPackage(existing?: PackageSpec) {
  const writable=can('content');
  const p=existing || {id:crypto.randomUUID(),slug:'',name:'',description:'',category:'graphics',tier:'normal',image:'/images/01.jpg',version:'1.0.0',changelog:'',dependencies:[],files:[],steps:[],status:'draft',released_at:null} as PackageSpec;
  const d=modal(existing?'استودیوی پکیج':'ساخت پکیج جدید',`<form id="package-form"><fieldset ${writable?'':'disabled'}><div class="form-grid">${field('نام پکیج',`<input name="name" required minlength="2" maxlength="80" value="${esc(p.name)}">`)}${field('شناسه خوانا (انگلیسی)',`<input name="slug" required dir="ltr" pattern="[a-z0-9-]{2,64}" value="${esc(p.slug)}">`)}${field('نسخه',`<input name="version" required dir="ltr" pattern="[0-9]+\.[0-9]+\.[0-9]+" value="${esc(p.version)}">`)}${field('سطح دسترسی',`<select name="tier">${['normal','pro','vip'].map(t=>`<option ${p.tier===t?'selected':''} value="${t}">${t.toUpperCase()}</option>`).join('')}</select>`)}${field('دسته‌بندی',`<select name="category">${Object.entries(category).map(([v,l])=>`<option value="${v}" ${p.category===v?'selected':''}>${l}</option>`).join('')}</select>`)}${field('تصویر',`<select name="image">${Array.from({length:9},(_,i)=>`<option value="/images/0${i+1}.jpg" ${p.image===`/images/0${i+1}.jpg`?'selected':''}>تصویر ${fa(i+1)}</option>`).join('')}</select>`)}</div>${field('توضیحات',`<textarea name="description" minlength="10" maxlength="3000" required>${esc(p.description)}</textarea>`)}${field('تغییرات این نسخه',`<textarea name="changelog" maxlength="3000">${esc(p.changelog)}</textarea>`)}<h3 class="form-section">پیش‌نیازها</h3><div class="checks">${overview.packages.filter(q=>q.id!==p.id).map(q=>`<label><input type="checkbox" name="dependencies" value="${q.id}" ${p.dependencies.includes(q.id)?'checked':''}>${esc(q.name)} ${badge(q.tier)}</label>`).join('')||'<span class="muted">پکیج دیگری وجود ندارد.</span>'}</div><div class="section-heading form-section"><h3>فایل‌ها و ترتیب نصب</h3><button type="button" class="text-button" id="add-file">${icon('plus')}افزودن فایل</button></div><div id="file-rows"></div><p class="fine-print">مقصد نسبت به ریشه بازی است. اجرای خودکار EXE ممنوع است. برای استخراج RAR/7z به استخراج‌کنندهٔ تأییدشده در نسخه Native نیاز است.</p><div class="actions"><button class="button" type="submit">ذخیره پیش‌نویس</button>${existing&&p.status==='draft'?'<button type="button" class="button secondary" id="publish-package">انتشار نسخه</button>':''}${existing&&p.status==='published'?'<button type="button" class="button secondary" id="archive-package">بایگانی</button>':''}</div></fieldset></form>`,true);
  const rows=d.querySelector('#file-rows')!;
  function row(file?: PackageSpec['files'][number], step?: PackageSpec['steps'][number]) {
    const el=document.createElement('div');el.className='file-row';el.dataset.id=file?.id||crypto.randomUUID();
    el.innerHTML=`<div class="section-heading"><b>فایل نصب</b><button type="button" class="icon-button remove-file" aria-label="حذف فایل">${icon('trash-2')}</button></div><div class="form-grid">${field('نام فایل',`<input data-f="name" required value="${esc(file?.name||'')}" dir="ltr">`)}${field('فرمت',`<select data-f="format">${['zip','rar','7z','file','exe'].map(f=>`<option ${file?.format===f?'selected':''}>${f}</option>`).join('')}</select>`)}</div>${field('لینک مستقیم HTTPS',`<input data-f="url" type="url" required dir="ltr" value="${esc(file?.url||'')}" placeholder="https://…">`)}${field('SHA-256 (۶۴ کاراکتر)',`<input data-f="sha256" required pattern="[a-f0-9]{64}" dir="ltr" value="${esc(file?.sha256||'')}">`)}<div class="form-grid">${field('حجم دقیق (بایت)',`<input data-f="size" type="number" min="1" required value="${file?.size||''}">`)}${field('عملیات',`<select data-f="action"><option value="extract" ${step?.action==='extract'?'selected':''}>استخراج</option><option value="copy" ${step?.action==='copy'?'selected':''}>کپی فایل</option></select>`)}${field('مسیر نسبی مقصد',`<input data-f="destination" required dir="ltr" value="${esc(step?.destination||'extension')}">`)}${field('فایل موجود',`<select data-f="overwrite"><option value="backup">بکاپ و جایگزینی</option><option value="fail" ${step?.overwrite==='fail'?'selected':''}>توقف در صورت تداخل</option></select>`)}</div>`;
    rows.append(el);el.querySelector('.remove-file')!.addEventListener('click',()=>el.remove());decorate();
  }
  p.files.forEach(f=>row(f,p.steps.find(s=>s.file_id===f.id)));
  d.querySelector('#add-file')!.addEventListener('click',()=>row());
  d.querySelector('form')!.onsubmit=e=>{e.preventDefault();void busy(d.querySelector('button[type=submit]')!,async()=>{
    const form=d.querySelector('form')!;const f=new FormData(form);const files: any[]=[],steps: any[]=[];
    rows.querySelectorAll<HTMLElement>('.file-row').forEach(el=>{const get=(k:string)=>(el.querySelector(`[data-f=${k}]`) as HTMLInputElement).value;files.push({id:el.dataset.id,name:get('name'),format:get('format'),url:get('url'),sha256:get('sha256'),size:Number(get('size'))});steps.push({id:crypto.randomUUID(),file_id:el.dataset.id,action:get('action'),destination:get('destination'),overwrite:get('overwrite')});});
    const pkg=PackageSpec.parse({...p,...Object.fromEntries(f),dependencies:f.getAll('dependencies'),files,steps,status:'draft',released_at:null});
    await api('/admin/packages',pkg,token);d.close();toast('پیش‌نویس ذخیره شد؛ برای انتشار دوباره آن را باز کنید.');await refreshPage();
  });};
  d.querySelector<HTMLButtonElement>('#publish-package')?.addEventListener('click',function(){void busy(this as HTMLButtonElement,async()=>{await api(`/admin/packages/${p.id}/publish`,{},token);d.close();toast('نسخه منتشر شد.');await refreshPage();});});
  d.querySelector<HTMLButtonElement>('#archive-package')?.addEventListener('click',function(){void busy(this as HTMLButtonElement,async()=>{await api(`/admin/packages/${p.id}/archive`,{},token);d.close();toast('پکیج بایگانی شد.');await refreshPage();});});
}
function devices(el: HTMLElement) {
  const items=overview.licenses.filter(l=>l.device_thumbprint);
  el.innerHTML=`<div class="page-title"><div><p class="eyebrow">DEVICE REGISTRY / 04</p><h1>یک لایسنس. یک دستگاه.</h1><p class="muted">اتصال‌ها بر اساس کلید دستگاه هستند، نه IP کاربر.</p></div></div><div class="panel table-panel">${items.length?`<div class="table-scroll"><table><thead><tr><th>اثر انگشت کلید</th><th>اشتراک</th><th>فعال‌سازی</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>${items.map(l=>`<tr><td><code dir="ltr">${esc(l.device_thumbprint?.slice(0,24))}…</code></td><td>${badge(l.tier)}</td><td>${date(l.activated_at)}</td><td><span class="status ${l.status}">${statuses[l.status]}</span></td><td>${can('license')?`<button class="text-button" data-device="${l.id}">مدیریت اتصال</button>`:'فقط مشاهده'}</td></tr>`).join('')}</tbody></table></div>`:empty('هنوز دستگاهی متصل نیست','با فعال‌سازی لایسنس در لانچر، دستگاه اینجا نمایش داده می‌شود.','monitor')}</div>`;
  el.querySelectorAll<HTMLButtonElement>('[data-device]').forEach(b=>b.onclick=()=>licenseDialog(overview.licenses.find(l=>l.id===b.dataset.device)!));
}
function eventTable(events: AuditEvent[]) {
  return events.length?`<div class="table-scroll"><table><thead><tr><th>رویداد</th><th>عامل</th><th>هدف</th><th>زمان</th></tr></thead><tbody>${events.map(e=>`<tr><td><code>${esc(e.action)}</code></td><td><code>${esc(e.actor.slice(0,14))}</code></td><td><code>${esc(e.target.slice(0,16))}</code></td><td>${date(e.created_at)} <small>${new Date(e.created_at).toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'})}</small></td></tr>`).join('')}</tbody></table></div>`:empty('رویدادی ثبت نشده','عملیات واقعی پنل در این بخش ثبت می‌شوند.','scroll-text');
}
function logs(el: HTMLElement) {
  el.innerHTML=`<div class="page-title"><div><p class="eyebrow">AUDIT TRAIL / 05</p><h1>هیچ تغییری بی‌ردپا نیست.</h1><p class="muted">تاریخچهٔ عملیات؛ بدون ثبت کد کامل لایسنس یا کلید خصوصی.</p></div></div><section class="panel">${eventTable(overview.events)}</section>`;
}
export function loginDialog(demo: boolean, onSuccess: (token: string) => void) {
  const d=modal('ورود به اتاق کنترل',`<p class="muted">${demo?'محیط توسعه: ورود نمایشی به داده‌های محلی. این ورود در نسخه عملیاتی وجود ندارد.':'ورود مدیران با Supabase Auth و تأیید دومرحله‌ای.'}</p>${demo?'<button class="button full" id="demo-admin">ورود به پنل نمایشی</button>':`<form id="admin-login">${field('ایمیل','<input name="email" type="email" required dir="ltr" autocomplete="username">')}${field('رمز عبور','<input name="password" type="password" required dir="ltr" autocomplete="current-password">')}<button class="button full" type="submit">ورود امن</button></form>`}`);
  d.querySelector<HTMLButtonElement>('#demo-admin')?.addEventListener('click',function(){void busy(this as HTMLButtonElement,async()=>{const session=await api('/demo/session',{});d.close();onSuccess(session.token);});});
  d.querySelector<HTMLFormElement>('#admin-login')?.addEventListener('submit',e=>{e.preventDefault();void busy(d.querySelector('button[type=submit]')!,async()=>{
    if(!supabase)throw new Error('تنظیمات Supabase برای پنل وارد نشده است.');
    const f=new FormData(e.target as HTMLFormElement); const {error}=await supabase.auth.signInWithPassword({email:String(f.get('email')),password:String(f.get('password'))});if(error)throw new Error('ورود ناموفق بود.');
    const {data:factors,error:factorError}=await supabase.auth.mfa.listFactors();if(factorError)throw factorError;
    const factor=factors.totp.find(f=>f.status==='verified');
    if(!factor)throw new Error('ابتدا MFA مدیر را در فرایند راه‌اندازی امن ثبت کنید. دسترسی مدیریتی بدون MFA داده نمی‌شود.');
    d.close();const m=modal('تأیید دومرحله‌ای',`<form id="mfa-form">${field('کد برنامه احراز هویت','<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required dir="ltr" autocomplete="one-time-code">')}<button class="button full" type="submit">تأیید</button></form>`);
    m.querySelector('form')!.onsubmit=e=>{e.preventDefault();void busy(m.querySelector('button[type=submit]')!,async()=>{const code=String(new FormData(e.target as HTMLFormElement).get('code'));const {error}=await supabase!.auth.mfa.challengeAndVerify({factorId:factor.id,code});if(error)throw new Error('کد معتبر نیست.');const {data}=await supabase!.auth.getSession();m.close();onSuccess(data.session!.access_token);});};
  });});
}
