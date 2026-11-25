// المرحلة 1: الطبقات، والاستيراد، والنقل والتحجيم، وتصدير PNG وJPG
import { readFileSync } from 'node:fs';

export async function importVia(page, paths) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('import').click()]);
  await chooser.setFiles(paths);
  await page.waitForFunction((n) => window.__app.imageLayers().length >= n, paths.length);
  await page.waitForTimeout(150);
}

const state = (page) => page.evaluate(() => {
  const a = window.__app;
  return { w: a.doc.width, h: a.doc.height, layers: a.imageLayers().map((l) => ({ id: l.id, name: l.name, x: l.x, y: l.y, sx: l.sx, visible: l.visible, locked: l.locked, opacity: l.opacity })), sel: a.doc.selectedId, undo: a.history.undoStack.length, all: a.doc.layers.length };
});

function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

export const tests = {
  async 'استيراد صورتين: الأولى تحدد مقاس اللوحة'({ page, assert, fixture, shot }) {
    const a = await fixture('sky', 900, 600);
    const b = await fixture('subject', 400, 500);
    await importVia(page, [a, b]);
    const s = await state(page);
    assert.equal(s.w, 900);
    assert.equal(s.h, 600);
    assert.equal(s.layers.length, 2);
    assert.equal(await page.getByTestId('layer-row').count(), 2);
    await shot('imported');
  },

  async 'نقل الطبقة بالسحب ثم تراجع وإعادة'({ page, assert, fixture }) {
    await importVia(page, [await fixture('sky', 900, 600), await fixture('subject', 300, 300)]);
    const before = await state(page);
    const top = before.layers[1];
    const box = await page.getByTestId('viewport').boundingBox();
    // مركز اللوحة على الشاشة
    const z = await page.evaluate(() => ({ zoom: __app.viewport.zoom, tx: __app.viewport.tx, ty: __app.viewport.ty }));
    const sx = box.x + top.x * z.zoom + z.tx;
    const sy = box.y + top.y * z.zoom + z.ty;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 100, sy + 50, { steps: 6 });
    await page.mouse.up();
    let s = await state(page);
    assert.ok(Math.abs(s.layers[1].x - (top.x + 100 / z.zoom)) < 2, 'تحركت أفقيًا');
    assert.ok(Math.abs(s.layers[1].y - (top.y + 50 / z.zoom)) < 2, 'تحركت عموديًا');
    await page.getByTestId('undo').click();
    s = await state(page);
    assert.equal(Math.round(s.layers[1].x), Math.round(top.x));
    await page.getByTestId('redo').click();
    s = await state(page);
    assert.ok(s.layers[1].x > top.x + 10);
    await page.keyboard.press('Control+z');
    s = await state(page);
    assert.equal(Math.round(s.layers[1].x), Math.round(top.x));
  },

  async 'تحجيم وتدوير من الخصائص، وتغيير الشفافية ونمط الدمج'({ page, assert, fixture }) {
    await importVia(page, [await fixture('sky', 900, 600), await fixture('subject', 300, 300)]);
    await page.getByTestId('tab-props').click();
    await page.getByTestId('scale').fill('50');
    await page.getByTestId('scale').dispatchEvent('change');
    let s = await state(page);
    assert.ok(Math.abs(s.layers[1].sx - 0.5) < 0.01);
    await page.getByTestId('opacity').fill('40');
    await page.getByTestId('opacity').dispatchEvent('change');
    await page.getByTestId('blend').selectOption('multiply');
    const l = await page.evaluate(() => ({ o: __app.selected.opacity, b: __app.selected.blend }));
    assert.equal(l.o, 0.4);
    assert.equal(l.b, 'multiply');
    // ثلاث نقاط تراجع على الأقل
    s = await state(page);
    assert.ok(s.undo >= 3);
  },

  async 'إخفاء وقفل ونسخ وتجميع ودمج وحذف'({ page, assert, fixture }) {
    await importVia(page, [await fixture('sky', 900, 600), await fixture('subject', 300, 300)]);
    await page.getByTestId('tab-layers').click();
    await page.getByTestId('layer-eye').first().click();
    let s = await state(page);
    assert.equal(s.layers[1].visible, false);
    await page.getByTestId('layer-lock').first().click();
    s = await state(page);
    assert.equal(s.layers[1].locked, true);
    await page.getByTestId('layer-dup').click();
    s = await state(page);
    assert.equal(s.layers.length, 3);
    await page.getByTestId('layer-group').click();
    let types = await page.evaluate(() => __app.doc.layers.map((l) => l.type));
    assert.ok(types.includes('group'));
    await page.getByTestId('layer-group').click(); // فك التجميع
    types = await page.evaluate(() => __app.doc.layers.map((l) => l.type));
    assert.ok(!types.includes('group'));
    // إظهار الطبقة المخفية ثم دمجها مع الأسفل
    await page.evaluate(() => __app.doc.layers.forEach((l) => (l.visible = true)));
    await page.getByTestId('layer-merge').click();
    s = await state(page);
    assert.equal(s.layers.length, 2);
    await page.getByTestId('layer-del').click();
    await page.getByTestId('confirm-ok').click();
    s = await state(page);
    assert.equal(s.layers.length, 1);
  },

  async 'تصدير PNG وJPG بدقة مختارة'({ page, assert, fixture, out }) {
    await importVia(page, [await fixture('sky', 900, 600), await fixture('subject', 300, 300)]);
    await page.getByTestId('export').click();
    await page.getByTestId('export-scale').fill('50');
    let [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-ok').click()]);
    const p1 = out + '/export.png';
    await dl.saveAs(p1);
    const buf = readFileSync(p1);
    assert.equal(buf.toString('ascii', 1, 4), 'PNG');
    assert.deepEqual(pngSize(buf), { w: 450, h: 300 });
    await page.getByTestId('export').click();
    await page.getByTestId('export-format').selectOption('jpeg');
    [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-ok').click()]);
    assert.ok(dl.suggestedFilename().endsWith('.jpg'), dl.suggestedFilename());
    const p2 = out + '/export.jpg';
    await dl.saveAs(p2);
    const j = readFileSync(p2);
    assert.equal(j[0], 0xff);
    assert.equal(j[1], 0xd8);
  },

  async 'الحفظ التلقائي يسترجع المشروع بعد إعادة التحميل'({ page, assert, fixture }) {
    await importVia(page, [await fixture('sky', 900, 600), await fixture('subject', 300, 300)]);
    await page.evaluate(() => __app.saveNow());
    await page.reload();
    await page.waitForFunction(() => document.body.classList.contains('ready'));
    await page.waitForFunction(() => window.__app.imageLayers().length === 2, null, { timeout: 10000 });
    const s = await state(page);
    assert.equal(s.w, 900);
  },

  async 'يعمل بلا إنترنت بعد التحميل الأول'({ page, ctx, assert, base }) {
    await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker.ready.then(() => true), null, { timeout: 30000 });
    await page.evaluate(() => navigator.serviceWorker.ready);
    // انتظار انتهاء التخزين المسبق
    await page.waitForFunction(async () => (await caches.keys()).length > 0 && (await (await caches.open((await caches.keys())[0])).keys()).length > 10, null, { timeout: 60000, polling: 500 });
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 20000 });
    assert.ok(await page.getByTestId('toolrail').isVisible());
    await ctx.setOffline(false);
  }
};
