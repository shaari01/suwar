// المرحلة 5: الترميم والختم والملء حسب المحتوى والمنظور وPuppet Warp
import { importVia } from './01-layers.mjs';

async function screenOf(page, u, v) {
  const box = await page.getByTestId('viewport').boundingBox();
  const p = await page.evaluate(([u, v]) => {
    const l = __app.selected, vp = __app.viewport;
    const c = Math.cos(l.rot), s = Math.sin(l.rot);
    const x = l.x + (u - l.src.width / 2) * l.sx * c - (v - l.src.height / 2) * l.sy * s;
    const y = l.y + (u - l.src.width / 2) * l.sx * s + (v - l.src.height / 2) * l.sy * c;
    return [x * vp.zoom + vp.tx, y * vp.zoom + vp.ty];
  }, [u, v]);
  return [box.x + p[0], box.y + p[1]];
}
async function drag(page, pts) {
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 5 });
  await page.mouse.up();
}
const px = (page, u, v) => page.evaluate(([u, v]) => {
  const l = __app.selected;
  const c = document.createElement('canvas'); c.width = l.src.width; c.height = l.src.height;
  const g = c.getContext('2d'); g.drawImage(l.src, 0, 0); if (l.retouch) g.drawImage(l.retouch, 0, 0);
  return [...g.getImageData(u, v, 1, 1).data];
}, [u, v]);
const lum = (p) => p[0] + p[1] + p[2];

async function setup(page, fixture) {
  await importVia(page, [await fixture('blemish', 400, 300)]);
  await page.getByTestId('tool-retouch').click();
  // حجم الفرشاة بالبكسل على الشاشة: نثبّته نحو 39 بكسلًا من الصورة مهما كان التكبير
  const z = await page.evaluate(() => __app.viewport.zoom);
  await page.getByTestId('retouch-size').fill(String(Math.round(39 * z)));
  await page.getByTestId('retouch-size').dispatchEvent('input');
}

export const tests = {
  async 'الإصلاح بلمسة يزيل البقعة'({ page, assert, fixture, shot }) {
    await setup(page, fixture);
    assert.ok(lum(await px(page, 200, 150)) < 20);
    await drag(page, [await screenOf(page, 190, 150), await screenOf(page, 210, 150)]);
    await page.waitForFunction(() => __app.selected.retouch, null, { timeout: 30000 });
    const c = lum(await px(page, 200, 150));
    assert.ok(c > 250, 'البقعة أزيلت: ' + c);
    await shot('spot');
    await page.getByTestId('undo').click();
    assert.ok(lum(await px(page, 200, 150)) < 20, 'التراجع يعيد الأصل');
  },

  async 'إزالة عنصر بالرسم حوله'({ page, assert, fixture }) {
    await setup(page, fixture);
    await page.locator('[data-testid=retouch-mode] [data-v=remove]').click();
    await drag(page, [await screenOf(page, 170, 120), await screenOf(page, 230, 120), await screenOf(page, 230, 180), await screenOf(page, 170, 180)]);
    await page.waitForFunction(() => __app.selected.retouch, null, { timeout: 30000 });
    assert.ok(lum(await px(page, 200, 150)) > 250);
  },

  async 'الختم والترميم من مصدر'({ page, assert, fixture }) {
    await setup(page, fixture);
    await page.locator('[data-testid=retouch-mode] [data-v=clone]').click();
    await page.getByTestId('pick-source').click();
    const [sx, sy] = await screenOf(page, 100, 150);
    await page.mouse.click(sx, sy);
    await drag(page, [await screenOf(page, 200, 150), await screenOf(page, 201, 150)]);
    const cloned = await px(page, 200, 150);
    const source = await px(page, 100, 150);
    assert.ok(Math.abs(lum(cloned) - lum(source)) < 30, 'الختم ينسخ المصدر');
    await page.getByTestId('undo').click();
    await page.locator('[data-testid=retouch-mode] [data-v=heal]').click();
    await drag(page, [await screenOf(page, 200, 150), await screenOf(page, 201, 150)]);
    const healed = lum(await px(page, 200, 150));
    // الترميم يأخذ إضاءة المكان (أفتح من المصدر الأيسر لأن التدرج يزيد يمينًا)
    assert.ok(healed > lum(source), `الترميم يطابق الإضاءة: ${lum(source)} → ${healed}`);
  },

  async 'توسيع الطبقة وإكمال الجزء المقطوع'({ page, assert, fixture }) {
    await setup(page, fixture);
    await page.getByTestId('extend-layer').click();
    const size = await page.evaluate(() => [__app.selected.src.width, __app.selected.src.height]);
    assert.deepEqual(size, [520, 420]);
    // الهامش الأيسر مخفي
    const alphaAt = (u, v) => page.evaluate(([u, v]) => __app.renderer.processLayer(__app.selected).canvas.getContext('2d').getImageData(u, v, 1, 1).data[3], [u, v]);
    assert.equal(await alphaAt(30, 210), 0);
    await drag(page, [await screenOf(page, 30, 180), await screenOf(page, 30, 240)]);
    await page.waitForFunction(() => __app.selected.retouch, null, { timeout: 30000 });
    assert.ok((await alphaAt(30, 210)) > 200, 'الجزء أُكمل وظهر');
    const c = await px(page, 30, 210);
    assert.ok(lum(c) > 200, 'مملوء بلون الصورة لا بالأسود');
  },

  async 'المنظور وPuppet Warp'({ page, assert, fixture, shot }) {
    await setup(page, fixture);
    await page.getByTestId('tool-warp').click();
    const b0 = await page.evaluate(() => { const p = __app.renderer.processLayer(__app.selected); return [p.ox, p.oy, p.canvas.width, p.canvas.height]; });
    await drag(page, [await screenOf(page, 400, 0), await screenOf(page, 470, -40)]);
    const w = await page.evaluate(() => __app.selected.warp);
    assert.equal(w.kind, 'perspective');
    assert.ok(w.pts[1][0] > 450);
    const b1 = await page.evaluate(() => { const p = __app.renderer.processLayer(__app.selected); return [p.ox, p.oy, p.canvas.width, p.canvas.height]; });
    assert.ok(b1[2] > b0[2] + 50, 'اتسع العرض');
    await shot('perspective');
    // Puppet
    await page.locator('[data-testid=warp-mode] [data-v=puppet]').click();
    for (const [u, v] of [[100, 150], [300, 150]]) {
      const [x, y] = await screenOf(page, u, v);
      await page.mouse.click(x, y);
    }
    assert.equal(await page.evaluate(() => __app.selected.warp.pins.length), 2);
    await drag(page, [await screenOf(page, 300, 150), await screenOf(page, 300, 60)]);
    const pin = await page.evaluate(() => __app.selected.warp.pins[1]);
    assert.ok(pin.y < 100, 'الدبوس تحرك');
    const p = await page.evaluate(() => { const p = __app.renderer.processLayer(__app.selected); return [p.oy, p.canvas.height]; });
    assert.ok(p[0] < -40, 'العنصر انثنى للأعلى');
    await shot('puppet');
    await page.getByTestId('warp-reset').click();
    assert.equal(await page.evaluate(() => __app.selected.warp), null);
  }
};
