// واجهة الجوال: شريط سفلي ولوحة منزلقة وأيقونات مدمجة (طريقة VivaVideo)
import { importVia } from './01-layers.mjs';
export const viewport = { width: 412, height: 870 };
export const touch = true;
export const mobile = true;

export const tests = {
  async 'واجهة الجوال: أيقونات مدمجة ولوحة منزلقة'({ page, assert, fixture, shot }) {
    const rail = await page.getByTestId('toolrail').boundingBox();
    assert.ok(rail.y > 700, 'شريط الأدوات في الأسفل');
    const btn = await page.getByTestId('tool-move').boundingBox();
    // مدمج لكن يبقى سهل اللمس: بين 40 و60 بكسل
    assert.ok(btn.height >= 40 && btn.height <= 60 && btn.width >= 40, 'زر مدمج: ' + JSON.stringify(btn));
    assert.ok(rail.height <= 64, 'الشريط السفلي رفيع: ' + rail.height);
    await importVia(page, [await fixture('sky', 600, 900)]);
    await page.getByTestId('sheet-toggle').tap();
    await page.waitForTimeout(400);
    const side = await page.getByTestId('side').boundingBox();
    assert.ok(side.y < 700, 'اللوحة ظهرت');
    await shot('mobile-sheet');
    // لا تمرير أفقي في الصفحة
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false);
  },

  async 'المنزلق لا يتغير أثناء التمرير بالإصبع، ويتغير بالسحب الأفقي، ثم ✗ يلغي و✓ يعتمد'({ page, assert, fixture, shot }) {
    await importVia(page, [await fixture('sky', 600, 900)]);
    await page.getByTestId('sheet-toggle').tap();
    await page.getByTestId('tab-props').tap();
    await page.waitForTimeout(400);
    const cdp = await page.context().newCDPSession(page);
    const swipe = async (x0, y0, x1, y1) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
      for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / 8, y: y0 + (y1 - y0) * i / 8 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(150);
    };
    const tapEl = async (id) => {
      const r = await page.getByTestId(id).boundingBox();
      const p = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(400);
    };
    const op = page.getByTestId('opacity');
    await op.scrollIntoViewIfNeeded();
    const b = await op.boundingBox();
    const v0 = await op.inputValue();
    // تمرير عمودي يبدأ فوق المنزلق: لا يتغير
    await swipe(b.x + b.width * 0.3, b.y + b.height / 2, b.x + b.width * 0.35, b.y + b.height / 2 - 120);
    assert.equal(await op.inputValue(), v0, 'التمرير لم يغيّر القيمة');
    assert.equal(await page.getByTestId('reviewbar').isVisible(), false);
    // لمسة واحدة: لا قفز
    await swipe(b.x + 20, b.y + b.height / 2, b.x + 20, b.y + b.height / 2);
    assert.equal(await op.inputValue(), v0, 'اللمس لا يقفز بالقيمة');
    // سحب أفقي (المنزلق من اليمين لليسار في الواجهة العربية: السحب لليمين يُنقص)
    await op.scrollIntoViewIfNeeded();
    const b2 = await op.boundingBox();
    await swipe(b2.x + b2.width * 0.3, b2.y + b2.height / 2, b2.x + b2.width * 0.9, b2.y + b2.height / 2);
    const v1 = await op.inputValue();
    assert.ok(+v1 < +v0, `السحب غيّر القيمة: ${v0} → ${v1}`);
    assert.ok(await page.getByTestId('reviewbar').isVisible(), 'ظهر شريط المعاينة');
    await shot('review');
    await tapEl('review-cancel');
    assert.equal(await page.evaluate(() => __app.selected.opacity * 100), +v0, '✗ ألغى التغيير');
    assert.equal(await page.getByTestId('reviewbar').isVisible(), false);
    await swipe(b2.x + b2.width * 0.3, b2.y + b2.height / 2, b2.x + b2.width * 0.9, b2.y + b2.height / 2);
    await tapEl('review-ok');
    assert.ok(await page.evaluate(() => __app.selected.opacity) < 1, '✓ اعتمد التغيير');
    // التراجع ما زال يعمل بعد الاعتماد
    await page.getByTestId('undo').tap();
    assert.equal(await page.evaluate(() => __app.selected.opacity), 1);
  }
};
