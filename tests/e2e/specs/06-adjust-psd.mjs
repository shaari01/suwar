// المرحلة 6: طبقات التعديل وأقنعتها، وتبادل PSD، وحزمة الطبقات، والتوليد (مع خدمة وهمية)
import { readFileSync, writeFileSync } from 'node:fs';
import { importVia } from './01-layers.mjs';

// متوسط سطوع اللوحة المعروضة وقيم نقاط محددة (كنسبة من المقاس)
const stats = (page, pts = []) => page.evaluate((pts) => {
  const a = __app;
  const c = a.renderer.renderDoc(a.doc, { scale: 0.5, background: '#000' });
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let s = 0, s2 = 0;
  for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; s += v; s2 += v * v; }
  const n = d.length / 4, mean = s / n;
  const at = pts.map(([u, v]) => { const i = (Math.floor(v * (c.height - 1)) * c.width + Math.floor(u * (c.width - 1))) * 4; return [d[i], d[i + 1], d[i + 2]]; });
  return { mean, std: Math.sqrt(s2 / n - mean * mean), at };
}, pts);

async function setSlider(page, id, v) {
  const el = page.getByTestId(id);
  // fill يطلق input ثم change مثل سحب واحد بالإصبع (نقطة تراجع واحدة)
  await el.fill(String(v));
  await page.waitForTimeout(80);
}

async function addAdj(page, kind) {
  await page.getByTestId('tab-layers').click().catch(() => {});
  await page.getByTestId('layer-adjust').click();
  await page.getByTestId('adj-' + kind).click();
  await page.waitForFunction((k) => __app.selected?.type === 'adjust' && __app.selected.kind === k, kind);
}

async function docPoint(page, x, y) {
  const box = await page.getByTestId('viewport').boundingBox();
  const z = await page.evaluate(() => ({ zoom: __app.viewport.zoom, tx: __app.viewport.tx, ty: __app.viewport.ty }));
  return [box.x + x * z.zoom + z.tx, box.y + y * z.zoom + z.ty];
}

export const tests = {
  async 'تعديلات أساسية ومنحنيات ومستويات غير متلفة'({ page, assert, fixture, shot }) {
    await importVia(page, [await fixture('sky', 800, 600)]);
    const s0 = await stats(page);
    await addAdj(page, 'basic');
    await setSlider(page, 'adj-exposure', 60);
    const s1 = await stats(page);
    assert.ok(s1.mean > s0.mean + 15, `التعريض يفتح الصورة: ${s0.mean.toFixed(1)} → ${s1.mean.toFixed(1)}`);
    await shot('basic');
    // الأصل لم يتغير: إخفاء طبقة التعديل يعيد الصورة كما كانت
    await page.evaluate(() => { __app.selected.visible = false; __app.changed(); });
    const sHidden = await stats(page);
    assert.ok(Math.abs(sHidden.mean - s0.mean) < 0.5, 'غير متلف');
    await page.evaluate(() => { __app.selected.visible = true; __app.changed(); });

    await addAdj(page, 'curves');
    const before = await stats(page);
    await page.getByTestId('curve-s').click();
    const after = await stats(page);
    assert.ok(after.std > before.std + 2, `منحنى S يزيد التباين: ${before.std.toFixed(1)} → ${after.std.toFixed(1)}`);
    assert.equal(await page.getByTestId('curves').count(), 1);

    await addAdj(page, 'levels');
    const b2 = await stats(page);
    await setSlider(page, 'lv-black', 90);
    const a2 = await stats(page);
    assert.ok(a2.mean < b2.mean - 5, `النقطة السوداء تغمق الصورة: ${b2.mean.toFixed(1)} → ${a2.mean.toFixed(1)}`);
    await shot('curves-levels');
    // التراجع يعمل على تعديلات الطبقة
    await page.getByTestId('undo').click();
    const u = await stats(page);
    assert.ok(Math.abs(u.mean - b2.mean) < 1, 'التراجع يعيد المستويات');
  },

  async 'تحميل LUT من ملف .cube'({ page, assert, fixture, out }) {
    await importVia(page, [await fixture('colours', 600, 400)]);
    const s0 = await stats(page, [[0.1, 0.5], [0.9, 0.5]]);
    // LUT يعكس الألوان (2×2×2)
    const lines = ['TITLE "invert"', 'LUT_3D_SIZE 2'];
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) lines.push(`${1 - r} ${1 - g} ${1 - b}`);
    const p = out + '/invert.cube';
    writeFileSync(p, lines.join('\n'));
    await addAdj(page, 'lut');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('lut-load').click()]);
    await chooser.setFiles(p);
    await page.waitForFunction(() => __app.selected.params.lut);
    await page.waitForTimeout(150);
    const s1 = await stats(page, [[0.1, 0.5], [0.9, 0.5]]);
    for (let i = 0; i < 2; i++) for (let c = 0; c < 3; c++)
      assert.ok(Math.abs(s1.at[i][c] - (255 - s0.at[i][c])) < 12, `معكوس: ${s0.at[i]} → ${s1.at[i]}`);
  },

  async 'قناع دائري يحصر أثر طبقة التعديل'({ page, assert, fixture, shot }) {
    await importVia(page, [await fixture('sky', 800, 600)]);
    await addAdj(page, 'basic');
    await setSlider(page, 'adj-exposure', -80);
    const dark = await stats(page, [[0.5, 0.4], [0.03, 0.05]]);
    await page.getByTestId('am-open').click();
    await page.locator('[data-testid=am-mode] [data-v=radial]').click();
    const [x0, y0] = await docPoint(page, 400, 240);
    const [x1] = await docPoint(page, 560, 240);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y0, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(() => __app.selected.mask);
    await page.evaluate(() => __app.selected.visible = false);
    await page.evaluate(() => __app.changed());
    const orig = await stats(page, [[0.5, 0.4], [0.03, 0.05]]);
    await page.evaluate(() => { __app.selected.visible = true; __app.changed(); });
    const s = await stats(page, [[0.5, 0.4], [0.03, 0.05]]);
    const L = (p) => p[0] + p[1] + p[2];
    assert.ok(Math.abs(L(s.at[0]) - L(dark.at[0])) < 15, 'المركز ما زال معدَّلًا');
    assert.ok(Math.abs(L(s.at[1]) - L(orig.at[1])) < 15, `الركن عاد لأصله: ${orig.at[1]} / ${s.at[1]}`);
    await shot('radial-mask');
    await page.getByTestId('am-clear').click();
    assert.equal(await page.evaluate(() => __app.selected.mask), null);
  },

  async 'تصدير PSD ثم فتحه من جديد'({ page, assert, fixture, out }) {
    await importVia(page, [await fixture('sky', 640, 480), await fixture('subject', 300, 300)]);
    const n0 = await page.evaluate(() => __app.imageLayers().length);
    await page.getByTestId('export').click();
    await page.getByTestId('export-format').selectOption('psd');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-ok').click()]);
    const p = out + '/test.psd';
    await dl.saveAs(p);
    const buf = readFileSync(p);
    assert.equal(buf.subarray(0, 4).toString('latin1'), '8BPS');
    assert.equal(buf.readUInt32BE(14), 480);
    assert.equal(buf.readUInt32BE(18), 640);
    // فتحه يستبدل اللوحة بطبقاته
    await page.evaluate(() => (__app.doc.name = 'قبل'));
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('import').click()]);
    await chooser.setFiles(p);
    await page.waitForFunction(() => __app.doc.name === 'test', null, { timeout: 15000 });
    const s = await page.evaluate(() => ({ w: __app.doc.width, h: __app.doc.height, n: __app.imageLayers().length, names: __app.imageLayers().map((l) => l.name) }));
    assert.equal(s.w, 640);
    assert.equal(s.h, 480);
    assert.equal(s.n, n0, 'نفس عدد الطبقات: ' + s.names);
  },

  async 'حزمة طبقات لبرنامج الصور المتحركة'({ page, assert, fixture, out }) {
    await importVia(page, [await fixture('sky', 640, 480), await fixture('subject', 300, 300)]);
    await page.getByTestId('export').click();
    await page.getByTestId('export-format').selectOption('layers');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-ok').click()]);
    const p = out + '/layers.zip';
    await dl.saveAs(p);
    const buf = readFileSync(p);
    assert.equal(buf.subarray(0, 2).toString('latin1'), 'PK');
    const s = buf.toString('utf8');
    assert.ok(s.includes('manifest.json') && s.includes('"lawha-layers"') && s.includes('layers/002.png') && s.includes('preview.png'));
  },

  async 'التوليد بالذكاء الاصطناعي يضيف طبقة جديدة (خدمة وهمية)'({ page, assert, fixture, shot }) {
    await importVia(page, [await fixture('sky', 800, 600)]);
    // صورة الرد: مربع أحمر
    const b64 = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 1024; const g = c.getContext('2d'); g.fillStyle = '#e02020'; g.fillRect(0, 0, 1024, 1024); return c.toDataURL('image/png').split(',')[1]; });
    let called = 0;
    await page.route('https://api.openai.com/**', (r) => { called++; r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ data: [{ b64_json: b64 }] }) }); });
    await page.getByTestId('menu').click();
    await page.getByTestId('m-gen').click();
    await page.getByTestId('gen-key').fill('sk-test');
    await page.getByTestId('gen-save').click();
    await page.getByTestId('tool-generate').click();
    const n0 = await page.evaluate(() => __app.imageLayers().length);
    const [x0, y0] = await docPoint(page, 300, 200);
    const [x1, y1] = await docPoint(page, 500, 400);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 5 });
    await page.mouse.up();
    await page.getByTestId('prompt-input').fill('مربع أحمر');
    await page.getByTestId('prompt-ok').click();
    await page.waitForFunction((n) => __app.imageLayers().length > n, n0, { timeout: 20000 });
    assert.equal(called, 1);
    const s = await stats(page, [[0.5, 0.5], [0.1, 0.1]]);
    assert.ok(s.at[0][0] > 200 && s.at[0][1] < 60, 'المنطقة صارت حمراء: ' + s.at[0]);
    assert.ok(s.at[1][0] < 200 || s.at[1][1] > 60, 'خارجها لم يتغير');
    await shot('generated');
  }
};
