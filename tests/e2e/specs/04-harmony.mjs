// المرحلة 4: أدوات الانسجام
import { importVia } from './01-layers.mjs';

const meanColor = (page) => page.evaluate(() => {
  const c = __app.renderer.processLayer(__app.selected).canvas;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const s = [0, 0, 0]; let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++; }
  return s.map((v) => v / n);
});
const compPixel = (page, x, y) => page.evaluate(([x, y]) => {
  const c = __app.renderer.renderDoc(__app.doc, { scale: 1 });
  return [...c.getContext('2d').getImageData(x, y, 1, 1).data];
}, [x, y]);

async function setup(page, fixture) {
  await importVia(page, [await fixture('sky', 1000, 700), await fixture('subject', 300, 400)]);
  await page.getByTestId('tool-cut').click();
  await page.getByTestId('ai-subject').click();
  await page.waitForFunction(() => __app.selected?.mask, null, { timeout: 60000 });
  await page.getByTestId('tool-harmony').click();
  await page.getByTestId('tab-props').click();
}

export const tests = {
  async 'مطابقة الألوان تقرّب العنصر من ألوان الخلفية'({ page, assert, fixture }) {
    await setup(page, fixture);
    const before = await meanColor(page);
    await page.getByTestId('match-color').click();
    await page.waitForFunction(() => __app.selected.fx.colorMatch);
    const after = await meanColor(page);
    // الخلفية بنفسجية: يجب أن يزيد الأزرق
    assert.ok(after[2] > before[2] + 15, `الأزرق ${before[2]} → ${after[2]}`);
    await page.getByTestId('match-strength').fill('0');
    await page.getByTestId('match-strength').dispatchEvent('change');
    const zero = await meanColor(page);
    assert.ok(Math.abs(zero[2] - before[2]) < 3, 'القوة صفر تعيد الأصل');
  },

  async 'اتجاه الضوء يفتّح الجهة المضاءة'({ page, assert, fixture }) {
    await setup(page, fixture);
    await page.getByTestId('light-on').click();
    await page.waitForFunction(() => __app.selected.fx.light);
    const side = (x) => page.evaluate((x) => {
      const c = __app.renderer.processLayer(__app.selected).canvas;
      const d = c.getContext('2d').getImageData(x, 250, 1, 1).data;
      return d[0] + d[1] + d[2];
    }, x);
    // الشمس افتراضيًا أعلى اليسار: الجهة اليسرى أفتح من اليمنى
    const left = await side(115);
    const right = await side(185);
    assert.ok(left > right + 10, `يسار ${left} يمين ${right}`);
    // سحب القرص لوضع الشمس يمينًا
    const dial = await page.getByTestId('light-dial').boundingBox();
    await page.mouse.move(dial.x + dial.width - 8, dial.y + dial.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    const angle = await page.evaluate(() => __app.doc.light.angle);
    assert.ok(Math.abs(angle) < 20, 'الزاوية ' + angle);
    const left2 = await side(115);
    const right2 = await side(185);
    assert.ok(right2 > left2 + 10, `بعد التغيير: يسار ${left2} يمين ${right2}`);
  },

  async 'ظل التلامس والظل الملقى يظلّلان الأرض'({ page, assert, fixture, shot }) {
    await setup(page, fixture);
    const foot = await page.evaluate(() => {
      const l = __app.selected;
      return { x: Math.round(l.x), y: Math.round(l.y + 0.72 * l.src.height / 2) };
    });
    // نقطة تحت القدمين مباشرة
    const ground = { x: foot.x + 60, y: foot.y + 4 };
    const before = await compPixel(page, ground.x, ground.y);
    await page.getByTestId('shadow-contact').click();
    await page.getByTestId('shadow-cast').click();
    const types = await page.evaluate(() => __app.doc.layers.map((l) => l.type));
    assert.equal(types.filter((t) => t === 'shadow').length, 2);
    assert.ok(types.indexOf('shadow') < types.lastIndexOf('image'), 'الظل تحت العنصر');
    const total = () => page.evaluate(() => {
      const c = __app.renderer.renderDoc(__app.doc, { scale: 0.5 });
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      return s;
    });
    const withShadow = await total();
    await page.evaluate(() => __app.doc.layers.forEach((l) => { if (l.type === 'shadow') l.visible = false; }));
    const noShadow = await total();
    await page.evaluate(() => __app.doc.layers.forEach((l) => { if (l.type === 'shadow') l.visible = true; }));
    assert.ok(withShadow < noShadow * 0.998, `الظلال تغمّق اللوحة: ${noShadow} → ${withShadow}`);
    // تغيير الطول من الخصائص
    await page.getByTestId('tab-layers').click();
    await page.locator('[data-testid=layer-row]').filter({ hasText: 'الظل المُلقى' }).click();
    await page.getByTestId('tab-props').click();
    await page.getByTestId('shadow-length').fill('-80');
    await page.getByTestId('shadow-length').dispatchEvent('change');
    await page.evaluate(() => __app.renderNow());
    await shot('shadows');
  },

  async 'التفاف الضوء والضبابية ومطابقة الحدة والحبيبات'({ page, assert, fixture, shot }) {
    await setup(page, fixture);
    await page.getByTestId('wrap-on').click();
    await page.waitForFunction(() => __app.selected.fx.lightWrap);
    await page.getByTestId('wrap-strength').fill('100');
    await page.getByTestId('wrap-strength').dispatchEvent('change');
    await page.evaluate(() => __app.renderNow());
    await page.getByTestId('fx-blur').fill('3');
    await page.getByTestId('fx-blur').dispatchEvent('change');
    assert.equal(await page.evaluate(() => __app.selected.fx.blur), 3);
    await page.getByTestId('match-sharp').click();
    await page.waitForTimeout(300);
    await page.getByTestId('grain-add').click();
    const g = await page.evaluate(() => __app.doc.layers.at(-1));
    assert.equal(g?.kind, 'grain');
    // الحبيبات ترفع التباين المحلي في منطقة مسطحة من السماء
    const variance = () => page.evaluate(() => {
      const c = __app.renderer.renderDoc(__app.doc, { scale: 1 });
      const d = c.getContext('2d').getImageData(20, 620, 60, 60).data;
      let s = 0, s2 = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { const v = d[i] + d[i + 1] + d[i + 2]; s += v; s2 += v * v; n++; }
      return s2 / n - (s / n) ** 2;
    });
    const v1 = await variance();
    await page.evaluate(() => { __app.doc.layers.at(-1).visible = false; });
    const v0 = await variance();
    assert.ok(v1 > v0 + 5, `تباين ${v0} → ${v1}`);
    await page.evaluate(() => { __app.doc.layers.at(-1).visible = true; __app.renderNow(); });
    await shot('harmony');
  }
};
