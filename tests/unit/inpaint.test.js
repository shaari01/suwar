import { describe, it, expect } from 'vitest';
import { inpaint, inpaintRegion, diffuseFill } from '../../src/img/inpaint.js';

function stripes(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const v = Math.floor(y / 6) % 2 ? 230 : 30;
    d[i] = v; d[i + 1] = 255 - v; d[i + 2] = 100; d[i + 3] = 255;
  }
  return d;
}
const holeRect = (w, h, x0, y0, x1, y1) => { const m = new Uint8Array(w * h); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1; return m; };
const err = (a, b, hole) => { let e = 0, n = 0; for (let i = 0; i < hole.length; i++) if (hole[i]) { e += Math.abs(a[i * 4] - b[i * 4]); n++; } return e / n; };

describe('الملء حسب المحتوى', () => {
  it('يكمل نمط الخطوط أفضل من الانتشار البسيط', () => {
    const w = 96, h = 96;
    const truth = stripes(w, h);
    const hole = holeRect(w, h, 36, 36, 60, 60);
    const t0 = Date.now();
    const out = inpaint(truth, hole, w, h);
    const ms = Date.now() - t0;
    // الانتشار وحده
    const rgb = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) { rgb[i * 3] = truth[i * 4]; rgb[i * 3 + 1] = truth[i * 4 + 1]; rgb[i * 3 + 2] = truth[i * 4 + 2]; }
    const dif = diffuseFill(rgb, hole, w, h);
    const difImg = new Uint8ClampedArray(truth); for (let i = 0; i < w * h; i++) if (hole[i]) difImg[i * 4] = dif[i * 3];
    const ePM = err(out, truth, hole);
    const eD = err(difImg, truth, hole);
    expect(ePM).toBeLessThan(eD * 0.6);
    expect(ePM).toBeLessThan(45);
    expect(ms).toBeLessThan(5000);
    // خارج الثقب لم يتغير
    expect(out[0]).toBe(truth[0]);
  });
  it('العمل داخل مستطيل الثقب فقط', () => {
    const w = 400, h = 300;
    const img = stripes(w, h);
    const hole = holeRect(w, h, 200, 100, 220, 130);
    const { data, box } = inpaintRegion(img, hole, w, h);
    expect(box.w).toBeLessThan(w);
    expect(err(data, img, hole)).toBeLessThan(60);
  });
});
