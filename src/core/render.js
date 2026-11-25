// محرّك التركيب: يحوّل شجرة الطبقات إلى صورة واحدة.
// كل طبقة صورة تمر بخط معالجة في فضائها الخاص (الأصل ← الترميم ← المؤثرات ← القناع ← التشويه)
// ثم تُرسم في فضاء المستند بتحويلها وشفافيتها ونمط دمجها.
import { mk, ctx2d } from './canvas.js';
import { blendToComposite, layerMatrix, getLayer } from './doc.js';
import { rasterId } from './util.js';

/** خطوات إضافية تسجّلها المراحل اللاحقة */
export const layerSteps = []; // [{ name, key(l)=>string|null, run(canvas, l, ctx)=>canvas }]
export const docSpaceEffects = []; // [{ name, applies(l), run(layerDocCanvas, backdrop, l, scale)=>canvas }]
export const adjusters = {}; // kind -> (canvas, params, doc, scale) => canvas
export const shadowRenderer = { fn: null }; // (shadowLayer, refLayer, processed, doc, scale) => canvas

export class Renderer {
  constructor() {
    this.cache = new Map(); // layerId -> { key, out }
    this.adjCache = new Map();
  }

  invalidate(id) {
    if (id) this.cache.delete(id);
    else this.cache.clear();
  }

  /** مفتاح التخزين المؤقت لطبقة: يتغير عند تغير أي شيء يؤثر في البكسلات */
  layerKey(l) {
    const parts = [rasterId(l.src), rasterId(l.retouch), l.maskOn ? rasterId(l.mask) : 0];
    for (const s of layerSteps) parts.push(s.key(l) ?? '');
    return parts.join('|');
  }

  /** يعيد الطبقة بعد المعالجة في فضائها: { canvas, ox, oy } */
  processLayer(l) {
    const key = this.layerKey(l);
    const c = this.cache.get(l.id);
    if (c && c.key === key) return c.out;
    let canvas = l.src;
    if (l.retouch) {
      const t = mk(l.src.width, l.src.height);
      const g = ctx2d(t);
      g.drawImage(l.src, 0, 0);
      g.drawImage(l.retouch, 0, 0);
      canvas = t;
    }
    const ctx = { ox: 0, oy: 0, renderer: this };
    for (const s of layerSteps) {
      if (s.key(l) == null) continue;
      canvas = s.run(canvas, l, ctx) || canvas;
    }
    // القناع الخام إن لم تعالجه خطوة التنقيح
    if (l.mask && l.maskOn && !ctx.maskApplied) {
      const t = mk(canvas.width, canvas.height);
      const g = ctx2d(t);
      g.drawImage(canvas, 0, 0);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(l.mask, 0, 0);
      canvas = t;
    }
    if (ctx.post) for (const p of ctx.post) canvas = p(canvas, ctx) || canvas;
    const out = { canvas, ox: ctx.ox, oy: ctx.oy };
    this.cache.set(l.id, { key, out });
    return out;
  }

  /** يرسم طبقة صورة في سياق المستند */
  drawImageLayer(g, l, scale) {
    const p = this.processLayer(l);
    const m = layerMatrix(l);
    g.save();
    g.setTransform(m[0] * scale, m[1] * scale, m[2] * scale, m[3] * scale, m[4] * scale, m[5] * scale);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(p.canvas, p.ox, p.oy);
    g.restore();
  }

  /** الطبقة وحدها في فضاء المستند (لمؤثرات تحتاج الخلفية) */
  layerToDocCanvas(l, W, H, scale) {
    const t = mk(W, H);
    this.drawImageLayer(ctx2d(t), l, scale);
    return t;
  }

  /**
   * يركّب قائمة طبقات على لوحة.
   * opts.stopAt: معرّف طبقة نتوقف قبلها (للحصول على ما تحتها)
   * opts.skip: مجموعة معرّفات لا تُرسم
   */
  composeList(list, target, doc, scale, opts) {
    const W = target.width;
    const H = target.height;
    let g = ctx2d(target);
    for (const l of list) {
      if (opts.stopAt && l.id === opts.stopAt) {
        opts.stopped = true;
        return target;
      }
      if (!l.visible || (opts.skip && opts.skip.has(l.id))) continue;
      if (l.type === 'image') {
        const fxs = docSpaceEffects.filter((e) => e.applies(l));
        if (fxs.length) {
          let lc = this.layerToDocCanvas(l, W, H, scale);
          for (const e of fxs) lc = e.run(lc, target, l, scale, doc) || lc;
          g.save();
          g.globalAlpha = l.opacity;
          g.globalCompositeOperation = blendToComposite(l.blend);
          g.drawImage(lc, 0, 0);
          g.restore();
        } else {
          g.save();
          g.globalAlpha = l.opacity;
          g.globalCompositeOperation = blendToComposite(l.blend);
          this.drawImageLayer(g, l, scale);
          g.restore();
        }
      } else if (l.type === 'group') {
        const t = mk(W, H);
        this.composeList(l.children, t, doc, scale, opts);
        g.save();
        g.globalAlpha = l.opacity;
        g.globalCompositeOperation = blendToComposite(l.blend);
        g.drawImage(t, 0, 0);
        g.restore();
        if (opts.stopped) return target;
      } else if (l.type === 'shadow') {
        const ref = getLayer(doc, l.ref);
        if (!ref || !shadowRenderer.fn) continue;
        const sc = shadowRenderer.fn(l, ref, this, doc, scale, W, H);
        if (!sc) continue;
        g.save();
        g.globalAlpha = l.opacity;
        g.globalCompositeOperation = blendToComposite(l.blend);
        g.drawImage(sc, 0, 0);
        g.restore();
      } else if (l.type === 'adjust') {
        const fn = adjusters[l.kind];
        if (!fn) continue;
        const adjusted = fn(target, l.params, doc, scale);
        if (!adjusted) continue;
        // الدمج: النتيجة فوق الأصل بقوة الشفافية وعبر القناع
        let top = adjusted;
        if (l.mask) {
          top = mk(W, H);
          const tg = ctx2d(top);
          tg.drawImage(adjusted, 0, 0);
          tg.globalCompositeOperation = 'destination-in';
          tg.drawImage(l.mask, 0, 0, W, H);
        }
        const out = mk(W, H);
        const og = ctx2d(out);
        og.drawImage(target, 0, 0);
        og.globalAlpha = l.opacity;
        og.globalCompositeOperation = blendToComposite(l.blend);
        // نرسم فوق البكسلات الموجودة فقط حتى لا نلوّن الشفاف
        og.drawImage(top, 0, 0);
        og.globalAlpha = 1;
        og.globalCompositeOperation = 'destination-in';
        og.drawImage(target, 0, 0);
        g = ctx2d(target);
        g.save();
        g.globalCompositeOperation = 'copy';
        g.drawImage(out, 0, 0);
        g.restore();
      }
    }
    return target;
  }

  /** يرسم المستند كله بمقياس معيّن */
  renderDoc(doc, { scale = 1, background = true, stopAt = null, skip = null, target = null } = {}) {
    const W = Math.max(1, Math.round(doc.width * scale));
    const H = Math.max(1, Math.round(doc.height * scale));
    const out = target && target.width === W && target.height === H ? target : mk(W, H);
    const g = ctx2d(out);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, W, H);
    if (background && doc.background) {
      g.fillStyle = doc.background;
      g.fillRect(0, 0, W, H);
    }
    this.composeList(doc.layers, out, doc, scale, { stopAt, skip, stopped: false });
    return out;
  }
}
