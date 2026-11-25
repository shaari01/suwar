import { describe, it, expect } from 'vitest';
import { History } from '../../src/core/history.js';
import { layerMatrix, applyMatrix, invertMatrix, findLayer, flattenForUi } from '../../src/core/doc.js';
import { deepCloneKeepRasters } from '../../src/core/util.js';

const raster = (w, h) => ({ __raster: true, width: w, height: h });

describe('التاريخ (تراجع/إعادة)', () => {
  it('يتراجع ويعيد ويحافظ على مراجع اللوحات', () => {
    const r = raster(10, 10);
    let doc = { a: 1, layers: [{ id: 'x', src: r, x: 0 }] };
    const h = new History();
    h.checkpoint(doc, 'نقل');
    doc.layers[0].x = 50;
    const prev = h.undo(doc);
    expect(prev.layers[0].x).toBe(0);
    expect(prev.layers[0].src).toBe(r);
    const next = h.redo(prev);
    expect(next.layers[0].x).toBe(50);
  });
  it('بلا حد عددي', () => {
    const h = new History();
    let doc = { v: 0 };
    for (let i = 0; i < 5000; i++) {
      h.checkpoint(doc);
      doc.v = i + 1;
    }
    for (let i = 0; i < 5000; i++) doc = h.undo(doc);
    expect(doc.v).toBe(0);
    expect(h.canUndo()).toBe(false);
  });
  it('النسخ العميق لا يشارك الكائنات العادية', () => {
    const o = { a: { b: [1, 2] } };
    const c = deepCloneKeepRasters(o);
    c.a.b.push(3);
    expect(o.a.b.length).toBe(2);
  });
});

describe('مصفوفة الطبقة', () => {
  it('مركز الأصل يقع على موضع الطبقة', () => {
    const l = { src: raster(200, 100), x: 300, y: 400, sx: 2, sy: 2, rot: 0.7 };
    const m = layerMatrix(l);
    const [x, y] = applyMatrix(m, 100, 50);
    expect(x).toBeCloseTo(300);
    expect(y).toBeCloseTo(400);
    const inv = invertMatrix(m);
    const [u, v] = applyMatrix(inv, x, y);
    expect(u).toBeCloseTo(100);
    expect(v).toBeCloseTo(50);
  });
});

describe('شجرة الطبقات', () => {
  it('يجد الطبقات داخل المجموعات ويرتبها للعرض', () => {
    const doc = { layers: [{ id: 'a', type: 'image' }, { id: 'g', type: 'group', open: true, children: [{ id: 'b', type: 'image' }] }] };
    expect(findLayer(doc, 'b').parent.id).toBe('g');
    expect(flattenForUi(doc.layers).map((r) => r.layer.id)).toEqual(['g', 'b', 'a']);
  });
});
