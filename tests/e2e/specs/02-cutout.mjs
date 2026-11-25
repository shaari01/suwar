// المرحلة 2: القص بالذكاء الاصطناعي، والفرشاة، والتنقيح، وتنظيف لون الحافة
import { importVia } from './01-layers.mjs';

const alphaAt = (page, u, v) => page.evaluate(([u, v]) => {
  const l = __app.selected;
  const p = __app.renderer.processLayer(l);
  return p.canvas.getContext('2d').getImageData(Math.round(u), Math.round(v), 1, 1).data[3];
}, [u, v]);
const pixelAt = (page, u, v) => page.evaluate(([u, v]) => [...__app.renderer.processLayer(__app.selected).canvas.getContext('2d').getImageData(u, v, 1, 1).data], [u, v]);

/** يحوّل نقطة في الأصل إلى نقطة على الشاشة */
async function screenOf(page, u, v) {
  const box = await page.getByTestId('viewport').boundingBox();
  const p = await page.evaluate(([u, v]) => {
    const l = __app.selected;
    const vp = __app.viewport;
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
  for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 4 });
  await page.mouse.up();
}

async function subject(page) {
  await page.getByTestId('tool-cut').click();
  await page.getByTestId('ai-subject').click();
  await page.waitForFunction(() => __app.selected?.mask, null, { timeout: 60000 });
  await page.waitForTimeout(200);
}

export const tests = {
  async 'اختر العنصر الرئيسي يقص الجسم ويحذف الخلفية'({ page, assert, fixture, shot }) {
    await importVia(page, [await fixture('subject', 400, 500)]);
    await subject(page);
    const center = await alphaAt(page, 200, 300);
    const corner = await alphaAt(page, 10, 10);
    assert.ok(center > 200, 'مركز العنصر ظاهر: ' + center);
    assert.ok(corner < 40, 'زاوية الخلفية محذوفة: ' + corner);
    await page.getByTestId('cut-view').selectOption('white');
    await page.waitForTimeout(200);
    await shot('subject-on-white');
    // التراجع يزيل القناع، والأصل لم يُمس
    await page.getByTestId('undo').click();
    assert.equal(await page.evaluate(() => __app.selected.mask), null);
  },

  async 'فرشاة الإضافة والطرح والقص بالإصبع'({ page, assert, fixture }) {
    await importVia(page, [await fixture('subject', 400, 500)]);
    await page.getByTestId('tool-cut').click();
    // طرح: بلا قناع يبدأ من الكل ثم يمحو
    await page.locator('[data-testid=cut-op] [data-v=sub]').click();
    await page.getByTestId('brush-size').fill('60');
    await page.getByTestId('brush-size').dispatchEvent('input');
    await drag(page, [await screenOf(page, 50, 50), await screenOf(page, 150, 50)]);
    assert.ok((await alphaAt(page, 100, 50)) < 30, 'مُحيت المنطقة');
    assert.ok((await alphaAt(page, 300, 400)) > 250, 'الباقي ظاهر');
    // إضافة: تعيد المحو
    await page.locator('[data-testid=cut-op] [data-v=add]').click();
    await drag(page, [await screenOf(page, 60, 50), await screenOf(page, 140, 50)]);
    assert.ok((await alphaAt(page, 100, 50)) > 200, 'أعيدت المنطقة');
    // القص بالإصبع: طرح مثلث
    await page.locator('[data-testid=cut-mode] [data-v=lasso]').click();
    await page.locator('[data-testid=cut-op] [data-v=sub]').click();
    await drag(page, [await screenOf(page, 250, 380), await screenOf(page, 390, 380), await screenOf(page, 390, 490), await screenOf(page, 250, 490)]);
    assert.ok((await alphaAt(page, 330, 450)) < 30, 'اللاسو طرح المنطقة');
    const undo = await page.evaluate(() => __app.history.undoStack.length);
    assert.ok(undo >= 4);
  },

  async 'التحديد بالنقر يختار العنصر'({ page, assert, fixture }) {
    await importVia(page, [await fixture('subject', 400, 500)]);
    await page.getByTestId('tool-cut').click();
    await page.locator('[data-testid=cut-mode] [data-v=click]').click();
    const [x, y] = await screenOf(page, 200, 320);
    await page.mouse.click(x, y);
    await page.waitForFunction(() => __app.selected?.mask, null, { timeout: 60000 });
    assert.ok((await alphaAt(page, 200, 320)) > 200);
    assert.ok((await alphaAt(page, 20, 480)) < 40);
  },

  async 'تنقيح الحواف وتنظيف لون الحافة وفرشاة الشعر'({ page, assert, fixture, shot }) {
    await importVia(page, [await fixture('subject', 400, 500)]);
    await subject(page);
    await page.getByTestId('tab-props').click();
    const setS = async (id, v) => {
      await page.getByTestId(id).fill(String(v));
      await page.getByTestId(id).dispatchEvent('change');
    };
    const sumAlpha = () => page.evaluate(() => {
      const d = __app.renderer.processLayer(__app.selected).canvas.getContext('2d').getImageData(0, 0, 400, 500).data;
      let s = 0;
      for (let i = 3; i < d.length; i += 4) s += d[i];
      return s;
    });
    const s0 = await sumAlpha();
    await setS('refine-shift', 80);
    const s1 = await sumAlpha();
    assert.ok(s1 > s0 * 1.02, 'الإزاحة للخارج تكبر العنصر');
    await setS('refine-shift', -80);
    const s2 = await sumAlpha();
    assert.ok(s2 < s0 * 0.98, 'الإزاحة للداخل تصغره');
    await setS('refine-shift', 0);
    await setS('refine-feather', 6);
    await setS('refine-radius', 10);
    await setS('refine-decontam', 100);
    // بكسل حافة: يجب ألا يكون أخضر بعد التنظيف
    const edge = await page.evaluate(() => {
      const c = __app.renderer.processLayer(__app.selected).canvas;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let greenish = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        if (a > 40 && a < 215) { n++; if (d[i + 1] > d[i] + 20) greenish++; }
      }
      return { greenish, n };
    });
    assert.ok(edge.n > 50, 'توجد بكسلات حافة');
    assert.ok(edge.greenish / edge.n < 0.15, `هالة خضراء: ${edge.greenish}/${edge.n}`);
    // فرشاة الشعر تعمل دون أخطاء
    await page.getByTestId('tool-cut').click();
    await page.locator('[data-testid=cut-mode] [data-v=hair]').click();
    const before = await page.evaluate(() => __app.history.undoStack.length);
    await drag(page, [await screenOf(page, 200, 60), await screenOf(page, 200, 160)]);
    await page.waitForFunction((b) => __app.history.undoStack.length > b, before);
    for (const v of ['black', 'red', 'checker', 'overlay', 'normal']) await page.getByTestId('cut-view').selectOption(v);
    await page.getByTestId('cut-view').selectOption('black');
    await page.waitForTimeout(200);
    await shot('refined-on-black');
  },

  async 'القص على صورة حقيقية أسرع من 15 ثانية'({ page, assert, fixture }) {
    await importVia(page, [await fixture('subject', 1600, 1200)]);
    const t0 = Date.now();
    await subject(page);
    const ms = Date.now() - t0;
    assert.ok(ms < 15000, 'استغرق ' + ms);
  }
};
