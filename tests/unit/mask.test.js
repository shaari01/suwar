import { describe, it, expect } from 'vitest';
import { boxBlur, gaussBlur } from '../../src/img/blur.js';
import { guidedFilter, refineAlpha, decontaminate, componentAt, regionGrow, matteRegion, combineMasks } from '../../src/img/mask.js';

function disc(w, h, cx, cy, r) {
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = Math.hypot(x - cx, y - cy) <= r ? 1 : 0;
  return a;
}
function rgbaFromAlpha(a, fg, bg) {
  const d = new Uint8ClampedArray(a.length * 4);
  for (let i = 0; i < a.length; i++) for (let k = 0; k < 3; k++) d[i * 4 + k] = fg[k] * a[i] + bg[k] * (1 - a[i]);
  for (let i = 0; i < a.length; i++) d[i * 4 + 3] = 255;
  return d;
}
const sum = (a) => a.reduce((s, v) => s + v, 0);

describe('الضبابية', () => {
  it('تحفظ المجموع تقريبًا وتنعّم', () => {
    const a = disc(64, 64, 32, 32, 10);
    const b = boxBlur(a, 64, 64, 3);
    expect(Math.abs(sum(a) - sum(b)) / sum(a)).toBeLessThan(0.02);
    const g = gaussBlur(a, 64, 64, 2);
    expect(g[32 * 64 + 32]).toBeGreaterThan(0.95);
    expect(g[32 * 64 + 42]).toBeGreaterThan(0.2);
    expect(g[32 * 64 + 42]).toBeLessThan(0.8);
  });
});

describe('تنقيح الحواف', () => {
  const w = 80, h = 80;
  const a = disc(w, h, 40, 40, 20);
  const rgba = rgbaFromAlpha(a, [220, 30, 30], [30, 200, 40]);
  it('الإزاحة للخارج تكبّر وللداخل تصغّر', () => {
    const out = refineAlpha(a, rgba, w, h, { shift: 40 });
    const inn = refineAlpha(a, rgba, w, h, { shift: -40 });
    expect(sum(out)).toBeGreaterThan(sum(a) * 1.1);
    expect(sum(inn)).toBeLessThan(sum(a) * 0.9);
  });
  it('النعومة تصنع حافة متدرجة والتباين يعيد حدتها', () => {
    const f = refineAlpha(a, rgba, w, h, { feather: 3 });
    const edge = f[40 * w + 60];
    expect(edge).toBeGreaterThan(0.1);
    expect(edge).toBeLessThan(0.9);
    const c = refineAlpha(f, rgba, w, h, { contrast: 100 });
    const soft = f.filter((v) => v > 0.1 && v < 0.9).length;
    const hard = c.filter((v) => v > 0.1 && v < 0.9).length;
    expect(hard).toBeLessThan(soft);
  });
  it('المرشح الموجه يلصق القناع المزاح بحافة الصورة', () => {
    const shifted = gaussBlur(disc(w, h, 43, 40, 20), w, h, 2);
    const q = guidedFilter(a, shifted, w, h, 8, 1e-4);
    const mis = (m) => m.reduce((s, v, i) => s + ((v > 0.5) !== (a[i] > 0.5) ? 1 : 0), 0);
    expect(mis(q)).toBeLessThan(mis(shifted) * 0.2);
  });
});

describe('تنظيف لون الحافة', () => {
  it('يزيل لون الخلفية الأخضر من بكسلات الحافة', () => {
    const w = 80, h = 80;
    const hard = disc(w, h, 40, 40, 20);
    const soft = gaussBlur(hard, w, h, 2);
    const rgba = rgbaFromAlpha(soft, [220, 30, 30], [30, 200, 40]);
    const out = decontaminate(rgba, soft, w, h, 1, 8);
    // بكسل على الحافة بألفا ~0.5
    let idx = -1;
    for (let i = 0; i < soft.length; i++) if (soft[i] > 0.4 && soft[i] < 0.6) { idx = i; break; }
    const gBefore = rgba[idx * 4 + 1];
    const gAfter = out[idx * 4 + 1];
    expect(gAfter).toBeLessThan(gBefore - 40);
  });
});

describe('التحديد بالنقر', () => {
  it('يختار المكوّن المتصل فقط', () => {
    const w = 60, h = 30;
    const sal = new Float32Array(w * h);
    for (let y = 5; y < 25; y++) { for (let x = 5; x < 20; x++) sal[y * w + x] = 1; for (let x = 35; x < 55; x++) sal[y * w + x] = 1; }
    const m = componentAt(sal, w, h, 10, 10);
    expect(m[10 * w + 10]).toBe(1);
    expect(m[10 * w + 40]).toBe(0);
    expect(componentAt(sal, w, h, 28, 2)).toBeNull();
  });
  it('العصا السحرية تختار اللون المتقارب', () => {
    const w = 40, h = 40;
    const a = disc(w, h, 20, 20, 10);
    const rgba = rgbaFromAlpha(a, [250, 250, 250], [10, 10, 80]);
    const m = regionGrow(rgba, w, h, 20, 20, 30);
    expect(m[20 * w + 20]).toBeGreaterThan(0.9);
    expect(m[2 * w + 2]).toBeLessThan(0.1);
  });
  it('دمج الأقنعة', () => {
    const a = Float32Array.from([0, 0.5, 1]);
    const b = Float32Array.from([1, 0.2, 0]);
    expect([...combineMasks(a, b, 'add')]).toEqual([1, 0.5, 1]);
    expect([...combineMasks(a, b, 'sub')].map((v) => +v.toFixed(2))).toEqual([0, 0.5, 1]);
  });
});

describe('فرشاة الشعر', () => {
  it('تستخرج ألفا جزئية لخصلات رفيعة من الألوان', () => {
    const w = 60, h = 60;
    // جسم أحمر في النصف الأيسر، وخلفية زرقاء، وخطوط رفيعة حمراء بنسبة 50% في المنطقة الوسطى
    const trueA = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) trueA[y * w + x] = x < 20 ? 1 : x < 40 ? (y % 4 === 0 ? 0.5 : 0) : 0;
    const rgba = rgbaFromAlpha(trueA, [200, 40, 40], [40, 60, 200]);
    const rough = new Float32Array(w * h).map((_, i) => ((i % w) < 30 ? 1 : 0)); // قناع خشن يغطي الخصلات كلها
    const region = new Float32Array(w * h).map((_, i) => ((i % w) >= 18 && (i % w) < 42 ? 1 : 0));
    const out = matteRegion(rgba, rough, region, w, h, 12);
    const errBefore = sum(rough.map((v, i) => Math.abs(v - trueA[i])));
    const errAfter = sum(out.map((v, i) => Math.abs(v - trueA[i])));
    expect(errAfter).toBeLessThan(errBefore * 0.5);
  });
});
