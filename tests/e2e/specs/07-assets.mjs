// موادي: خطوط ومرشحات وملصقات يضيفها المستخدم ويحذفها، وطبقة النص
import { writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importVia } from './01-layers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

async function docPoint(page, x, y) {
  const box = await page.getByTestId('viewport').boundingBox();
  const z = await page.evaluate(() => ({ zoom: __app.viewport.zoom, tx: __app.viewport.tx, ty: __app.viewport.ty }));
  return [box.x + x * z.zoom + z.tx, box.y + y * z.zoom + z.ty];
}
async function choose(page, testid, files) {
  const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId(testid).click()]);
  await ch.setFiles(files);
}

export const tests = {
  async 'أداة النص: لمسة تضيف نصًا، وتغيير الحجم والنص يعيد رسمه'({ page, assert, fixture, shot }) {
    await importVia(page, [await fixture('sky', 800, 600)]);
    await page.getByTestId('tool-text').click();
    const [x, y] = await docPoint(page, 400, 200);
    await page.mouse.click(x, y);
    await page.getByTestId('prompt-input').fill('مرحبا بالعالم');
    await page.getByTestId('prompt-ok').click();
    await page.waitForFunction(() => __app.selected?.text);
    const a = await page.evaluate(() => ({ w: __app.selected.src.width, x: __app.selected.x, y: __app.selected.y, tool: __app.toolName }));
    assert.equal(a.x, 400);
    assert.equal(a.tool, 'move');
    await page.getByTestId('text-size').waitFor();
    await page.getByTestId('text-size').fill('200');
    const b = await page.evaluate(() => __app.selected.src.width);
    assert.ok(b > a.w * 1.5, `الحجم كبّر النص: ${a.w} → ${b}`);
    await page.getByTestId('text-value').fill('سطر أول\nسطر ثانٍ أطول قليلًا');
    const c = await page.evaluate(() => ({ h: __app.selected.src.height, v: __app.selected.text.value }));
    assert.ok(c.v.includes('\n'));
    await shot('text');
    // ✗ يلغي إضافة النص وتعديلاته كلها
    assert.ok(await page.getByTestId('reviewbar').isVisible());
    await page.getByTestId('review-cancel').click();
    assert.equal(await page.evaluate(() => __app.imageLayers().length), 1);
  },

  async 'خطوطي: إضافة خط واستعماله في النص ثم حذفه'({ page, assert, fixture, out }) {
    const font = join(out, 'MyFont.woff2');
    copyFileSync(join(root, 'node_modules/@fontsource/tajawal/files/tajawal-arabic-200-normal.woff2'), font);
    await importVia(page, [await fixture('sky', 800, 600)]);
    await page.getByTestId('menu').click();
    await page.getByTestId('m-assets').click();
    await choose(page, 'asset-add-font', [font]);
    await page.getByTestId('asset-row').first().waitFor();
    assert.equal(await page.getByTestId('asset-row').count(), 1);
    await page.getByTestId('assets-done').click();
    await page.getByTestId('tool-text').click();
    const [x, y] = await docPoint(page, 400, 300);
    await page.mouse.click(x, y);
    await page.getByTestId('prompt-input').fill('خطي');
    await page.getByTestId('prompt-ok').click();
    await page.getByTestId('text-font').waitFor();
    const opts = await page.getByTestId('text-font').locator('option').allTextContents();
    assert.ok(opts.includes('MyFont'), opts.join(','));
    await page.getByTestId('text-font').selectOption({ label: 'MyFont' });
    await page.waitForFunction(() => __app.selected.text.font === 'u-MyFont');
    // يبقى بعد إعادة التحميل
    await page.waitForFunction(() => !__app.saving && !__app._saveAgain);
    await page.reload();
    await page.waitForFunction(() => document.body.classList.contains('ready'));
    assert.ok(await page.evaluate(() => document.fonts.check('20px "u-MyFont"')), 'الخط محمّل بعد إعادة التشغيل');
    await page.getByTestId('menu').click();
    await page.getByTestId('m-assets').click();
    await page.getByTestId('asset-del').click();
    await page.getByTestId('confirm-ok').click();
    await page.waitForFunction(() => !document.querySelector('[data-testid=asset-row]'));
  },

  async 'مرشحاتي: إضافة LUT ثم تطبيقه بلمسة وحذفه'({ page, assert, fixture, out }) {
    const lines = ['LUT_3D_SIZE 2'];
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) lines.push(`${1 - r} ${1 - g} ${1 - b}`);
    const p = join(out, 'عكس.cube');
    writeFileSync(p, lines.join('\n'));
    await importVia(page, [await fixture('sky', 600, 400)]);
    await page.getByTestId('menu').click();
    await page.getByTestId('m-assets').click();
    await choose(page, 'asset-add-lut', [p]);
    await page.getByTestId('asset-row').first().waitFor();
    await page.getByTestId('assets-done').click();
    await page.getByTestId('tab-layers').click();
    await page.getByTestId('layer-adjust').click();
    await page.getByTestId('adj-lut').click();
    await page.locator('[data-testid=lut-mine] .chip', { hasText: 'عكس' }).click();
    await page.waitForFunction(() => __app.selected.params.lut?.size === 2);
    await page.getByTestId('menu').click();
    await page.getByTestId('m-assets').click();
    await page.getByTestId('asset-del').click();
    await page.getByTestId('confirm-ok').click();
    await page.waitForFunction(() => !document.querySelector('[data-testid=asset-row]'));
  },

  async 'ملصقاتي: إضافة صورة وGIF إلى العناصر ثم حذف واحد'({ page, assert, fixture, out }) {
    const png = await fixture('subject', 300, 300);
    const gif = join(out, 'نجمة.gif');
    writeFileSync(gif, Buffer.from('R0lGODlhAgACAIABAP8AAP///yH5BAEAAAEALAAAAAACAAIAAAICDAoAOw==', 'base64'));
    await page.getByTestId('tab-library').click();
    await choose(page, 'el-add-files', [png, gif]);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=el-card]').length === 2);
    await page.getByTestId('el-card').first().click();
    await page.waitForFunction(() => __app.imageLayers().length === 1);
    await page.getByTestId('el-more').first().click();
    await page.getByTestId('el-del').click();
    await page.getByTestId('confirm-ok').click().catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=el-card]').length === 1);
  }
};
