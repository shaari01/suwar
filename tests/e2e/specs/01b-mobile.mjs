// واجهة الجوال: شريط سفلي ولوحة منزلقة وأزرار لمس كبيرة
import { importVia } from './01-layers.mjs';
export const viewport = { width: 412, height: 870 };
export const touch = true;
export const mobile = true;

export const tests = {
  async 'واجهة الجوال: أيقونات كبيرة ولوحة منزلقة'({ page, assert, fixture, shot }) {
    const rail = await page.getByTestId('toolrail').boundingBox();
    assert.ok(rail.y > 700, 'شريط الأدوات في الأسفل');
    const btn = await page.getByTestId('tool-move').boundingBox();
    assert.ok(btn.height >= 48 && btn.width >= 48, 'زر لمس كبير');
    await importVia(page, [await fixture('sky', 600, 900)]);
    await page.getByTestId('sheet-toggle').tap();
    await page.waitForTimeout(400);
    const side = await page.getByTestId('side').boundingBox();
    assert.ok(side.y < 700, 'اللوحة ظهرت');
    await shot('mobile-sheet');
    // لا تمرير أفقي في الصفحة
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false);
  }
};
