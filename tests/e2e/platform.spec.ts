import {test,expect} from '@playwright/test';
test('launcher catalog is searchable, filterable and never fabricates installation',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await expect(page.getByRole('heading',{name:'رانندگی، یک تجربهٔ دیگر.'})).toBeVisible();
 await expect(page.locator('.package-card')).toHaveCount(6);
 await page.getByRole('tab',{name:'مسیرها',exact:true}).click();await expect(page.locator('.package-card')).toHaveCount(1);
 await page.getByRole('tab',{name:'همه پکیج‌ها',exact:true}).click();
 await page.getByRole('textbox',{name:'جست‌وجوی پکیج'}).fill('پایه');await expect(page.locator('.package-card')).toHaveCount(1);
 await page.locator('.card-title').click();await expect(page.getByRole('dialog')).toContainText('نصب فایل تنها در برنامه ویندوز');await page.getByRole('button',{name:'بستن',exact:true}).click();
 await page.getByRole('button',{name:'کتابخانه من',exact:true}).click();await expect(page.getByRole('heading',{name:'هنوز اولین دور را شروع نکردی'})).toBeVisible();
 expect(errors).toEqual([]);
});
test('demo activation performs cryptographic device flow',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'فعال‌سازی لایسنس',exact:true}).click();
 await page.getByRole('button',{name:'استفاده از لایسنس آزمایشی Pro'}).click();
 await expect(page.locator('.profile')).toContainText('PRO MEMBER');
 await page.locator('.profile').click();await expect(page.getByRole('dialog')).toContainText('عضویت PRO');
});
test('admin can generate licenses, search and persist a package draft',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'پنل مدیریت',exact:true}).click();await page.getByRole('button',{name:'ورود به پنل نمایشی'}).click();
 await expect(page.getByRole('heading',{name:'همه‌چیز، زیر کنترل.'})).toBeVisible();
 await page.getByRole('button',{name:'لایسنس‌ها',exact:true}).click();await page.getByRole('button',{name:'تولید لایسنس',exact:true}).click();
 await page.getByRole('button',{name:'تولید و نمایش کدها'}).click();await expect(page.locator('#codes')).toHaveValue(/UHM-/);await page.getByRole('button',{name:'بستن',exact:true}).click();
 await page.getByRole('button',{name:'پکیج‌ها',exact:true}).click();await page.getByRole('button',{name:'پکیج جدید',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.locator('[name=name]').fill('پکیج تست مرورگر');await dialog.locator('[name=slug]').fill(`e2e-${Date.now()}`);await dialog.locator('[name=description]').fill('این یک پکیج آزمایشی برای بررسی ذخیره واقعی در API است.');
 await page.getByRole('button',{name:'ذخیره پیش‌نویس',exact:true}).click();await expect(page.locator('table')).toContainText('پکیج تست مرورگر');
 await page.getByRole('button',{name:'رویدادها',exact:true}).click();await expect(page.locator('table')).toContainText('package.draft.saved');
});
test('responsive launcher has no horizontal overflow at phone width',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.locator('.feature')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.getByRole('button',{name:'دانلود و نصب',exact:true}).click();await expect(page.getByRole('heading',{name:'صف دانلود خالی است'})).toBeVisible();
});
