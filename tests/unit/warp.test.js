import { describe, it, expect } from 'vitest';
import { homography, applyH, mlsRigid, buildGrid } from '../../src/img/warp.js';

describe('المنظور', () => {
  it('يطابق الزوايا الأربع', () => {
    const s = [[0, 0], [100, 0], [100, 50], [0, 50]];
    const d = [[10, 5], [120, -10], [90, 70], [-5, 60]];
    const H = homography(s, d);
    s.forEach((p, i) => {
      const q = applyH(H, ...p);
      expect(q[0]).toBeCloseTo(d[i][0], 5);
      expect(q[1]).toBeCloseTo(d[i][1], 5);
    });
  });
});

describe('Puppet Warp (MLS الصلب)', () => {
  const P = [[0, 0], [100, 0], [50, 80]];
  it('بلا تحريك: لا تغيير', () => {
    const v = mlsRigid([30, 40], P, P);
    expect(v[0]).toBeCloseTo(30, 5);
    expect(v[1]).toBeCloseTo(40, 5);
  });
  it('إزاحة كل الدبابيس تزيح النقطة', () => {
    const Q = P.map(([x, y]) => [x + 20, y - 10]);
    const v = mlsRigid([30, 40], P, Q);
    expect(v[0]).toBeCloseTo(50, 4);
    expect(v[1]).toBeCloseTo(30, 4);
  });
  it('تدوير الدبابيس يدوّر النقطة', () => {
    const a = Math.PI / 2;
    const rot = ([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    const v = mlsRigid([30, 40], P, P.map(rot));
    const e = rot([30, 40]);
    expect(v[0]).toBeCloseTo(e[0], 4);
    expect(v[1]).toBeCloseTo(e[1], 4);
  });
  it('نقطة الدبوس تتبعه', () => {
    const Q = [[0, 0], [100, 0], [80, 120]];
    const v = mlsRigid([50, 80], P, Q);
    expect(v).toEqual([80, 120]);
  });
  it('الشبكة', () => {
    const g = buildGrid(100, 50, 4, 2, (u, v) => [u, v]);
    expect(g.src.length).toBe(15);
  });
});
