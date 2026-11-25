// المرحلة 3: مكتبة العناصر الدائمة
import { importVia } from './01-layers.mjs';

export const tests = {
  async 'حفظ عنصر مقصوص واستخدامه في لوحة جديدة بعد إعادة التحميل'({ page, assert, fixture, shot }) {
    await importVia(page, [await fixture('subject', 400, 500)]);
    await page.getByTestId('tool-cut').click();
    await page.getByTestId('ai-subject').click();
    await page.waitForFunction(() => __app.selected?.mask, null, { timeout: 60000 });
    await page.getByTestId('tab-library').click();
    await page.getByTestId('el-save').click();
    await page.getByTestId('el-name').fill('رجل أحمر');
    await page.locator('[data-testid=el-cats] [data-v=person]').click();
    await page.getByTestId('el-save-ok').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=el-card]').length === 1, null, { timeout: 15000 });
    // لوحة جديدة ثم إعادة تحميل: المكتبة باقية
    await page.evaluate(() => __app.saveNow());
    await page.getByTestId('menu').click();
    await page.getByTestId('m-new').click();
    await page.getByTestId('new-preset').selectOption('1920x1080');
    await page.getByTestId('new-ok').click();
    await page.waitForFunction(() => __app.imageLayers().length === 0);
    await page.waitForTimeout(300);
    await page.waitForFunction(() => !__app.saving && !__app._saveAgain);
    await page.reload();
    await page.waitForFunction(() => document.body.classList.contains('ready'));
    assert.equal(await page.evaluate(() => __app.imageLayers().length), 0, 'فُتحت اللوحة الجديدة');
    await page.getByTestId('tab-library').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=el-card]').length === 1);
    await page.getByTestId('el-search').fill('رجل');
    assert.equal(await page.getByTestId('el-card').count(), 1);
    await page.getByTestId('el-search').fill('شجرة');
    assert.equal(await page.getByTestId('el-card').count(), 0);
    await page.getByTestId('el-search').fill('');
    await page.locator('[data-testid=el-card] .lib-add').first().click();
    await page.waitForFunction(() => __app.imageLayers().length === 1);
    const l = await page.evaluate(() => { const l = __app.selected; return { mask: !!l.mask, el: !!l.elementId, w: l.src.width, name: l.name }; });
    assert.ok(l.mask, 'القناع محفوظ وقابل للتعديل');
    assert.ok(l.el);
    assert.equal(l.name, 'رجل أحمر');
    assert.ok(l.w < 400, 'العنصر مقصوص إلى حدوده');
    await shot('library');
  },

  async 'حذف عنصر من المكتبة'({ page, assert, fixture }) {
    await importVia(page, [await fixture('subject', 300, 300)]);
    await page.getByTestId('tab-props').click();
    await page.getByTestId('el-save-layer').click();
    await page.getByTestId('el-save-ok').click();
    await page.getByTestId('tab-library').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=el-card]').length === 1);
    await page.getByTestId('el-more').click();
    await page.getByTestId('el-del').click();
    await page.getByTestId('confirm-ok').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=el-card]').length === 0);
  }
};
