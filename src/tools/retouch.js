// أداة الإصلاح: فرشاة الترميم (Healing)، والختم (Clone)، والإصلاح بلمسة (Spot)، وإزالة عنصر، وإكمال جزء مقطوع
// كل الرسم يذهب إلى طبقة «ترميم» فوق الأصل، فيبقى الأصل محفوظًا.
import { h, iconBtn, slider, toast, busy } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { layerMatrix, invertMatrix, applyMatrix } from '../core/doc.js';
import { mk, ctx2d, cloneCanvas, canvasToMask, maskToCanvas } from '../core/canvas.js';
import { inpaintRegion } from '../img/inpaint.js';
import { weightedFill, f32ToU8, u8ToF32 } from '../img/mask.js';
import { gaussBlur } from '../img/blur.js';
import { nextFrame } from '../core/util.js';

export class RetouchTool {
  constructor() {
    this.label = 'الإصلاح';
    this.mode = 'spot'; // heal | clone | spot | remove | extend
    this.size = 40;
    this.hardness = 60;
    this.picking = false;
    this.srcPt = null;
    this.offset = null;
    this.stroke = null;
    this.wantsCoalesced = true;
  }

  get layer() {
    const l = this.app.selected;
    return l && l.type === 'image' ? l : null;
  }

  onSelect() {
    // نحتفظ بالمصدر ما دامت الطبقة نفسها (حتى بعد التراجع)
    const id = this.app.doc.selectedId;
    if (id !== this._selId) {
      this.srcPt = null;
      this.offset = null;
      this._selId = id;
    }
    this.app.emit('tool-options');
  }

  options() {
    const app = this.app;
    if (!this.layer) return h('span', { class: 'hint' }, 'اختر طبقة صورة لإصلاحها.');
    const modes = [['spot', 'إصلاح بلمسة', 'heal'], ['heal', 'ترميم', 'bandage'], ['clone', 'ختم', 'stamp'], ['remove', 'إزالة عنصر', 'lasso'], ['extend', 'إكمال جزء', 'plus']];
    const seg = h('div', { class: 'segmented', 'data-testid': 'retouch-mode' }, modes.map(([v, t, ic]) =>
      h('button', { type: 'button', class: v === this.mode ? 'on' : '', 'data-v': v, onclick: () => { this.mode = v; this.picking = false; app.emit('tool-options'); } }, icon(ic === 'bandage' ? 'heal' : ic, 22), t)));
    const needsSrc = this.mode === 'heal' || this.mode === 'clone';
    return h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
      seg,
      needsSrc ? h('button', { type: 'button', class: 'btn' + (this.picking ? ' primary' : ''), 'data-testid': 'pick-source', onclick: () => { this.picking = !this.picking; app.emit('tool-options'); } }, icon('click', 22), this.picking ? ' المس نقطة المصدر…' : this.srcPt ? ' غيّر المصدر' : ' حدد المصدر') : null,
      this.mode === 'remove' ? h('span', { class: 'hint' }, 'ارسم حول العنصر بإصبعك') : slider({ label: 'حجم الفرشاة', min: 4, max: 300, value: this.size, testid: 'retouch-size', onInput: (v) => { this.size = v; app.viewport.draw(); } }),
      iconBtn('fit', 'توسيع حدود الطبقة', () => this.extendLayer(), { testid: 'extend-layer', title: 'يضيف مساحة شفافة حول الطبقة لإكمال الأجزاء المقطوعة' }),
      iconBtn('reset', 'مسح الإصلاحات', () => this.clearRetouch(), { testid: 'retouch-clear' })
    );
  }

  toLocal(e, l) {
    const [u, v] = applyMatrix(invertMatrix(layerMatrix(l)), e.x, e.y);
    return { u, v };
  }

  localRadius(l) {
    return this.size / 2 / Math.max(1e-3, this.app.viewport.zoom * Math.abs(l.sx));
  }

  baseCanvas(l) {
    const c = cloneCanvas(l.src);
    if (l.retouch) ctx2d(c).drawImage(l.retouch, 0, 0);
    return c;
  }

  clearRetouch() {
    const l = this.layer;
    if (!l || !l.retouch) return;
    this.app.edit('مسح الإصلاحات', () => (l.retouch = null));
  }

  extendLayer() {
    const l = this.layer;
    if (!l) return;
    const W = l.src.width;
    const H = l.src.height;
    const p = Math.round(Math.max(W, H) * 0.15);
    const pad = (c, fill) => {
      const t = mk(W + 2 * p, H + 2 * p);
      const g = ctx2d(t);
      if (fill) g.drawImage(fill, p, p);
      if (c) g.drawImage(c, p, p);
      return t;
    };
    this.app.edit('توسيع حدود الطبقة', () => {
      // القناع: المنطقة الأصلية ظاهرة والهامش مخفي حتى تكمله
      const m = l.mask || (() => { const t = mk(W, H); const g = ctx2d(t); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); return t; })();
      l.src = pad(l.src);
      l.retouch = l.retouch ? pad(l.retouch) : null;
      l.mask = pad(m);
      l.maskOn = true;
      // نحافظ على موضع المحتوى (المركز ثابت لأن التوسيع متماثل)
      if (l.warp) l.warp = null;
    });
    toast('أُضيف هامش حول الطبقة. اختر «إكمال جزء» وارسم مكان الجزء الناقص.', { ms: 5000 });
    this.mode = 'extend';
    this.app.emit('tool-options');
  }

  brushStamp(r) {
    const d = Math.max(2, Math.ceil(r * 2));
    const c = mk(d, d);
    const g = ctx2d(c);
    const gr = g.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, d / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(this.hardness / 100, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, d, d);
    return c;
  }

  down(e) {
    const l = this.layer;
    if (!l) return toast('اختر طبقة صورة أولًا', { kind: 'warn' });
    if (l.locked) return toast('الطبقة مقفلة', { kind: 'warn' });
    const p = this.toLocal(e, l);
    if (this.picking) {
      this.srcPt = p;
      this._selId = l.id;
      this.offset = null;
      this.picking = false;
      this.app.emit('tool-options');
      toast('حُدد المصدر. ارسم الآن فوق المنطقة المراد إصلاحها.');
      return;
    }
    const W = l.src.width;
    const H = l.src.height;
    const r = this.localRadius(l);
    if (this.mode === 'heal' || this.mode === 'clone') {
      if (!this.srcPt) {
        toast('حدد نقطة المصدر أولًا', { kind: 'warn' });
        this.picking = true;
        this.app.emit('tool-options');
        return;
      }
      if (!this.offset) this.offset = { du: this.srcPt.u - p.u, dv: this.srcPt.v - p.v };
      this.app.checkpoint(this.mode === 'heal' ? 'فرشاة الترميم' : 'الختم');
      const base = this.baseCanvas(l);
      const ret = l.retouch ? cloneCanvas(l.retouch) : mk(W, H);
      l.retouch = ret;
      this.stroke = { l, base, ret, mask: mk(W, H), last: p, r, st: this.brushStamp(r), tmp: mk(Math.ceil(r * 2) + 2, Math.ceil(r * 2) + 2) };
      this.app.fastPreview = true;
      this.paint(p);
      return;
    }
    this.app.checkpoint({ spot: 'إصلاح بلمسة', remove: 'إزالة عنصر', extend: 'إكمال جزء مقطوع' }[this.mode]);
    this.stroke = { l, mask: mk(W, H), last: p, r, pts: [p] };
    if (this.mode !== 'remove') this.paintMask(p);
  }

  paint(p) {
    const s = this.stroke;
    const step = Math.max(1, s.r * 0.25);
    const dist = Math.hypot(p.u - s.last.u, p.v - s.last.v);
    const n = Math.max(1, Math.ceil(dist / step));
    const g = ctx2d(s.ret);
    const mg = ctx2d(s.mask);
    const tg = ctx2d(s.tmp);
    const d = s.st.width;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = s.last.u + (p.u - s.last.u) * t;
      const y = s.last.v + (p.v - s.last.v) * t;
      tg.globalCompositeOperation = 'copy';
      tg.drawImage(s.base, x + this.offset.du - d / 2, y + this.offset.dv - d / 2, d, d, 0, 0, d, d);
      tg.globalCompositeOperation = 'destination-in';
      tg.drawImage(s.st, 0, 0);
      g.drawImage(s.tmp, 0, 0, d, d, x - d / 2, y - d / 2, d, d);
      mg.drawImage(s.st, x - d / 2, y - d / 2);
    }
    s.last = p;
    this.app.renderer.invalidate(s.l.id);
    this.app.changed({ save: false, structure: false });
  }

  paintMask(p) {
    const s = this.stroke;
    const g = ctx2d(s.mask);
    g.strokeStyle = '#fff';
    g.lineWidth = s.r * 2;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(s.last.u, s.last.v);
    g.lineTo(p.u + 0.01, p.v);
    g.stroke();
    s.last = p;
  }

  move(e) {
    const s = this.stroke;
    if (!s) return;
    const p = this.toLocal(e, s.l);
    if (this.mode === 'heal' || this.mode === 'clone') this.paint(p);
    else if (this.mode === 'remove') s.pts.push(p);
    else this.paintMask(p);
  }

  async up() {
    const s = this.stroke;
    this.stroke = null;
    this.app.fastPreview = false;
    if (!s) return;
    const l = s.l;
    if (this.mode === 'clone') {
      this.app.renderer.invalidate(l.id);
      this.app.changed();
      return;
    }
    if (this.mode === 'heal') {
      this.healFinish(s);
      return;
    }
    if (this.mode === 'remove') {
      if (s.pts.length < 3) {
        this.app.history.undoStack.pop();
        return;
      }
      const g = ctx2d(s.mask);
      g.fillStyle = '#fff';
      g.beginPath();
      s.pts.forEach((p, i) => (i ? g.lineTo(p.u, p.v) : g.moveTo(p.u, p.v)));
      g.closePath();
      g.fill();
      // نوسّع قليلًا لتغطية الحواف
      g.lineWidth = 6;
      g.strokeStyle = '#fff';
      g.stroke();
    }
    const b = busy(this.mode === 'extend' ? 'جارِ إكمال الجزء المقطوع…' : 'جارِ الملء حسب المحتوى…');
    await nextFrame();
    await nextFrame();
    try {
      await this.fillHole(l, s.mask, this.mode === 'extend');
    } catch (e) {
      console.error(e);
      toast('تعذّر الإصلاح: ' + e.message, { kind: 'error' });
    } finally {
      b.done();
    }
  }

  /** الملء حسب المحتوى داخل القناع، والنتيجة تُكتب في طبقة الترميم */
  async fillHole(l, maskCanvas, reveal) {
    const W = l.src.width;
    const H = l.src.height;
    const m = canvasToMask(maskCanvas);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x] > 60) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x1 < 0) return;
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const ctxM = Math.max(30, Math.round(Math.max(bw, bh) * 1.5));
    const X0 = Math.max(0, x0 - ctxM), Y0 = Math.max(0, y0 - ctxM);
    const X1 = Math.min(W, x1 + 1 + ctxM), Y1 = Math.min(H, y1 + 1 + ctxM);
    const RW = X1 - X0, RH = Y1 - Y0;
    // نصغّر المناطق الكبيرة جدًا للسرعة ثم نكبّر النتيجة
    const S = Math.min(1, 700 / Math.max(RW, RH));
    const sw = Math.max(8, Math.round(RW * S)), sh = Math.max(8, Math.round(RH * S));
    const base = this.baseCanvas(l);
    const region = mk(sw, sh);
    const rg = ctx2d(region, { willReadFrequently: true });
    rg.imageSmoothingQuality = 'high';
    rg.drawImage(base, X0, Y0, RW, RH, 0, 0, sw, sh);
    const holeC = mk(sw, sh);
    ctx2d(holeC).drawImage(maskCanvas, X0, Y0, RW, RH, 0, 0, sw, sh);
    const hm = canvasToMask(holeC);
    const rgba = rg.getImageData(0, 0, sw, sh).data;
    const hole = new Uint8Array(sw * sh);
    for (let i = 0; i < hole.length; i++) {
      hole[i] = hm[i] > 40 ? 1 : 0;
      // البكسلات الشفافة (هامش التوسيع) لا تصلح مصدرًا
      if (reveal && rgba[i * 4 + 3] < 10) hole[i] = 1;
    }
    const { data } = inpaintRegion(rgba, hole, sw, sh, { context: 3 });
    const filled = mk(sw, sh);
    ctx2d(filled).putImageData(new ImageData(data, sw, sh), 0, 0);
    // حافة ناعمة: القناع مموه قليلًا
    const soft = maskToCanvas(f32ToU8(gaussBlur(u8ToF32(canvasToMask(maskCanvas)), W, H, 1.5)), W, H);
    const patch = mk(W, H);
    const pg = ctx2d(patch);
    pg.imageSmoothingQuality = 'high';
    pg.drawImage(filled, 0, 0, sw, sh, X0, Y0, RW, RH);
    pg.globalCompositeOperation = 'destination-in';
    pg.drawImage(soft, 0, 0);
    const ret = l.retouch ? cloneCanvas(l.retouch) : mk(W, H);
    ctx2d(ret).drawImage(patch, 0, 0);
    let newMask = l.mask;
    if (reveal) {
      newMask = l.mask ? cloneCanvas(l.mask) : null;
      if (newMask) ctx2d(newMask).drawImage(soft, 0, 0);
    }
    l.retouch = ret;
    if (reveal && newMask) l.mask = newMask;
    this.app.renderer.invalidate(l.id);
    this.app.changed();
  }

  /** فرشاة الترميم: نسيج المصدر + ألوان وإضاءة المكان الهدف المحيط */
  healFinish(s) {
    const l = s.l;
    const W = l.src.width;
    const H = l.src.height;
    const m = canvasToMask(s.mask);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x] > 5) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x1 < 0) return;
    const pad = Math.ceil(s.r * 2);
    const X0 = Math.max(0, x0 - pad), Y0 = Math.max(0, y0 - pad);
    const RW = Math.min(W, x1 + pad + 1) - X0, RH = Math.min(H, y1 + pad + 1) - Y0;
    const get = (c) => ctx2d(c, { willReadFrequently: true }).getImageData(X0, Y0, RW, RH).data;
    const T = get(s.base); // الهدف الأصلي
    // المصدر المنسوخ: نأخذه من الأساس بالإزاحة
    const srcC = mk(RW, RH);
    ctx2d(srcC).drawImage(s.base, X0 + this.offset.du, Y0 + this.offset.dv, RW, RH, 0, 0, RW, RH);
    const S = ctx2d(srcC, { willReadFrequently: true }).getImageData(0, 0, RW, RH).data;
    const n = RW * RH;
    const M = new Float32Array(n);
    for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) M[y * RW + x] = m[(Y0 + y) * W + X0 + x] / 255;
    const outside = new Float32Array(n).map((_, i) => (M[i] > 0.02 ? 0 : 1));
    const ones = new Float32Array(n).fill(1);
    const ch = (D, k) => new Float32Array(n).map((_, i) => D[i * 4 + k]);
    const R = Math.max(3, Math.round(s.r));
    const Tc = [ch(T, 0), ch(T, 1), ch(T, 2)];
    const Sc = [ch(S, 0), ch(S, 1), ch(S, 2)];
    const tLow = weightedFill(Tc, outside, RW, RH, R); // إضاءة المكان المحيط بلا العيب
    const sLow = weightedFill(Sc, ones, RW, RH, R);
    const out = new ImageData(RW, RH);
    for (let i = 0; i < n; i++) {
      const a = M[i];
      for (let k = 0; k < 3; k++) out.data[i * 4 + k] = Sc[k][i] + tLow[k][i] - sLow[k][i];
      out.data[i * 4 + 3] = a * 255;
    }
    const patch = mk(RW, RH);
    ctx2d(patch).putImageData(out, 0, 0);
    // نعيد بناء طبقة الترميم: الترميم السابق + الرقعة المعالجة (بدل النسخ الخام)
    const prev = this.app.history.undoStack.at(-1)?.state;
    const prevL = prev ? findIn(prev.layers, l.id) : null;
    const ret = prevL?.retouch ? cloneCanvas(prevL.retouch) : mk(W, H);
    ctx2d(ret).drawImage(patch, X0, Y0);
    l.retouch = ret;
    this.app.renderer.invalidate(l.id);
    this.app.changed();
  }

  cancel() {
    if (!this.stroke) return;
    this.stroke = null;
    this.app.fastPreview = false;
    this.app.undo();
  }

  drawOverlay(g, vp) {
    const l = this.layer;
    if (l && this.stroke && this.stroke.mask && this.mode !== 'heal' && this.mode !== 'clone') {
      g.save();
      g.transform(vp.zoom, 0, 0, vp.zoom, vp.tx, vp.ty);
      g.transform(...layerMatrix(l));
      if (this.mode === 'remove') {
        g.lineWidth = 2 / (vp.zoom * Math.abs(l.sx));
        g.strokeStyle = '#ff5d6c';
        g.beginPath();
        this.stroke.pts.forEach((p, i) => (i ? g.lineTo(p.u, p.v) : g.moveTo(p.u, p.v)));
        g.stroke();
      } else {
        g.globalAlpha = 0.45;
        const t = mk(this.stroke.mask.width, this.stroke.mask.height);
        const tg = ctx2d(t);
        tg.drawImage(this.stroke.mask, 0, 0);
        tg.globalCompositeOperation = 'source-in';
        tg.fillStyle = '#ff3355';
        tg.fillRect(0, 0, t.width, t.height);
        g.drawImage(t, 0, 0);
      }
      g.restore();
    }
    // علامة المصدر
    if (l && this.srcPt && (this.mode === 'heal' || this.mode === 'clone')) {
      const m = layerMatrix(l);
      let [x, y] = applyMatrix(m, this.srcPt.u, this.srcPt.v);
      if (this.stroke && this.offset) [x, y] = applyMatrix(m, this.stroke.last.u + this.offset.du, this.stroke.last.v + this.offset.dv);
      const [sx, sy] = vp.toScreen(x, y);
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(sx - 12, sy);
      g.lineTo(sx + 12, sy);
      g.moveTo(sx, sy - 12);
      g.lineTo(sx, sy + 12);
      g.stroke();
      g.beginPath();
      g.arc(sx, sy, this.size / 2, 0, Math.PI * 2);
      g.setLineDash([4, 4]);
      g.stroke();
      g.setLineDash([]);
    }
    const hv = vp.hover;
    if (hv && this.mode !== 'remove') {
      g.beginPath();
      g.arc(hv.sx, hv.sy, this.size / 2, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(0,0,0,.7)';
      g.lineWidth = 3;
      g.stroke();
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.stroke();
    }
  }
}

function findIn(list, id) {
  for (const l of list) {
    if (l.id === id) return l;
    if (l.children) {
      const r = findIn(l.children, id);
      if (r) return r;
    }
  }
  return null;
}
