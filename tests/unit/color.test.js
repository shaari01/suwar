import { describe, it, expect } from 'vitest';
import { rgb2lab, lab2rgb, labStats, colorTransfer, sharpness } from '../../src/img/color.js';

const img = (n, rgb) => { const d = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) { d.set(rgb(i), i * 4); d[i * 4 + 3] = 255; } return d; };

describe('الألوان', () => {
  it('Lab ذهابًا وإيابًا', () => {
    for (const c of [[0, 0, 0], [255, 255, 255], [200, 30, 40], [12, 180, 90]]) {
      const lab = rgb2lab(...c);
      const back = lab2rgb(...lab);
      back.forEach((v, k) => expect(Math.abs(v - c[k])).toBeLessThan(1.5));
    }
  });
  it('مطابقة الألوان تقرّب المتوسط من الهدف حسب القوة', () => {
    const src = img(400, (i) => [200 + (i % 20), 60, 50]);
    const dst = img(400, (i) => [40, 70 + (i % 30), 160]);
    const s = labStats(src), d = labStats(dst);
    const full = labStats(colorTransfer(src, s, d, 1));
    const half = labStats(colorTransfer(src, s, d, 0.5));
    for (let k = 0; k < 3; k++) expect(Math.abs(full.mean[k] - d.mean[k])).toBeLessThan(3);
    expect(Math.abs(half.mean[2] - d.mean[2])).toBeLessThan(Math.abs(s.mean[2] - d.mean[2]));
    expect(Math.abs(half.mean[2] - d.mean[2])).toBeGreaterThan(3);
  });
  it('الحدة: الصورة المفصلة أحدّ من المسطحة', () => {
    const w = 40;
    const sharp = img(w * w, (i) => ((i % 2) ^ ((i / w) & 1) ? [255, 255, 255] : [0, 0, 0]));
    const flat = img(w * w, (i) => [128 + (i % w), 128, 128]);
    expect(sharpness(sharp, w, w)).toBeGreaterThan(sharpness(flat, w, w) * 100);
  });
});
