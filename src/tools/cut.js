// أداة القص: الذكاء الاصطناعي، والنقر، والفرشاة، وفرشاة الشعر، والقص بالإصبع (لاسو)
import { h, iconBtn, slider, toast, busy, selectBox } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { layerMatrix, invertMatrix, applyMatrix } from '../core/doc.js';
import { mk, ctx2d, cloneCanvas, getData, maskToCanvas, canvasToMask, filledMask } from '../core/canvas.js';
import { selectSubject, saliency, warmup } from '../ai/segment.js';
import { componentAt, regionGrow, combineMasks, matteRegion, u8ToF32, f32ToU8 } from '../img/mask.js';

export const VIEW_MODES = [
  ['normal', 'عادي'],
  ['overlay', 'قناع أحمر'],
  ['white', 'على أبيض'],
  ['black', 'على أسود'],
  ['red', 'على أحمر'],
  ['checker', 'على شفاف']
];

export class CutTool {
  constructor() {
    this.label = 'القص';
    this.mode = 'brush'; // click | brush | hair | lasso
    this.op = 'add';
    this.size = 40; // بكسل على الشاشة
    this.hardness = 70;
    this.tolerance = 30;
    this.view = 'overlay';
    this.stroke = null;
    this.wantsCoalesced = true;
  }

  get layer() {
    const l = this.app.selected;
    return l && l.type === 'image' ? l : null;
  }

  activate() {
    warmup();
    this.app.requestRender();
  }

  deactivate() {
    this.app.viewport?.draw();
  }

  onSelect() {
    this.app.emit('tool-options');
  }

  options() {
    const app = this.app;
    const seg = (items, cur, set, testid) =>
      h('div', { class: 'segmented', 'data-testid': testid }, items.map(([v, label, ic]) =>
        h('button', { type: 'button', class: v === cur ? 'on' : '', 'data-v': v, onclick: () => { set(v); app.emit('tool-options'); } }, ic ? icon(ic, 22) : null, label)));
    const wrap = h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
      h('button', { class: 'btn primary', type: 'button', 'data-testid': 'ai-subject', onclick: () => this.runSubject() }, icon('ai', 22), ' اختر العنصر الرئيسي'),
      seg([['click', 'نقر', 'click'], ['brush', 'فرشاة', 'brush'], ['hair', 'شعر', 'waves'], ['lasso', 'بالإصبع', 'lasso']], this.mode, (v) => (this.mode = v), 'cut-mode'),
      seg([['add', 'إضافة', 'plus'], ['sub', 'طرح', 'erase']], this.op, (v) => (this.op = v), 'cut-op'),
      this.mode === 'click'
        ? slider({ label: 'تسامح اللون', min: 5, max: 100, value: this.tolerance, onInput: (v) => (this.tolerance = v) })
        : this.mode === 'lasso' ? null : slider({ label: 'حجم الفرشاة', min: 4, max: 300, value: this.size, testid: 'brush-size', onInput: (v) => { this.size = v; app.viewport.draw(); } }),
      this.mode === 'brush' ? slider({ label: 'الصلابة', min: 0, max: 100, value: this.hardness, unit: '٪', onInput: (v) => (this.hardness = v) }) : null,
      selectBox(VIEW_MODES, this.view, (v) => { this.view = v; app.viewport.draw(); }, { testid: 'cut-view' }),
      iconBtn('contrast', 'عكس', () => this.invert(), { testid: 'mask-invert' }),
      iconBtn('reset', 'مسح القناع', () => this.clearMask(), { testid: 'mask-clear' }),
      iconBtn('copy', 'نسخ المقصوص', () => this.extract(), { testid: 'mask-extract', title: 'نسخ العنصر المقصوص إلى طبقة جديدة' })
    );
    if (!this.layer) return h('div', { class: 'row' }, h('span', { class: 'hint' }, 'اختر طبقة صورة أولًا من لوحة الطبقات، ثم اقصص منها العنصر.'));
    return wrap;
  }

  // ---------- العمليات ----------
  setMask(l, f32, label) {
    const c = maskToCanvas(f32ToU8(f32), l.src.width, l.src.height);
    this.app.edit(label, () => {
      l.mask = c;
      l.maskOn = true;
    });
  }

  currentMaskF32(l, def = 1) {
    if (l.mask) return u8ToF32(canvasToMask(l.mask));
    const f = new Float32Array(l.src.width * l.src.height);
    f.fill(def);
    return f;
  }

  async runSubject() {
    const l = this.layer;
    if (!l) return toast('اختر طبقة صورة أولًا', { kind: 'warn' });
    const b = busy('الذكاء الاصطناعي يحدد العنصر الرئيسي…');
    try {
      const t0 = performance.now();
      const m = await selectSubject(l.src);
      this.setMask(l, m, 'اختيار العنصر الرئيسي');
      toast(`تم القص خلال ${((performance.now() - t0) / 1000).toFixed(1)} ث. نقّح الحواف بالفرشاة أو من «الخصائص».`, { kind: 'ok' });
    } catch (e) {
      console.error(e);
      toast('تعذّر تشغيل الذكاء الاصطناعي: ' + e.message, { kind: 'error' });
    } finally {
      b.done();
    }
  }

  invert() {
    const l = this.layer;
    if (!l) return;
    const m = this.currentMaskF32(l, 1);
    for (let i = 0; i < m.length; i++) m[i] = 1 - m[i];
    this.setMask(l, m, 'عكس القناع');
  }

  clearMask() {
    const l = this.layer;
    if (!l || !l.mask) return;
    this.app.edit('مسح القناع', () => {
      l.mask = null;
    });
  }

  async extract() {
    const l = this.layer;
    if (!l || !l.mask) return toast('لا يوجد قناع بعد', { kind: 'warn' });
    const { rasterizeToDoc, layerFromDocCanvas } = await import('../core/ops.js');
    const c = rasterizeToDoc(this.app, { ...l, opacity: 1, blend: 'normal', visible: true });
    const nl = layerFromDocCanvas(this.app, c, l.name + ' (مقصوص)');
    this.app.addLayer(nl, { label: 'نسخ المقصوص' });
  }

  toLocal(e, l) {
    const inv = invertMatrix(layerMatrix(l));
    const [u, v] = applyMatrix(inv, e.x, e.y);
    return { u, v };
  }

  /** حجم الفرشاة بإحداثيات الأصل */
  localRadius(l) {
    const z = this.app.viewport.zoom * Math.abs(l.sx);
    return this.size / 2 / Math.max(1e-3, z);
  }

  async clickSelect(e, l) {
    const { u, v } = this.toLocal(e, l);
    const W = l.src.width;
    const H = l.src.height;
    if (u < 0 || v < 0 || u >= W || v >= H) return;
    const b = busy('جارِ تحديد العنصر…');
    try {
      let m = null;
      try {
        const { sal } = await saliency(l.src);
        m = componentAt(sal, W, H, u, v, 0.5);
      } catch (err) {
        console.warn(err);
      }
      if (!m) m = regionGrow(getData(l.src).data, W, H, u, v, this.tolerance);
      if (!m) return;
      const base = l.mask ? this.currentMaskF32(l) : null;
      const mode = !l.mask ? (this.op === 'sub' ? 'sub' : 'replace') : this.op;
      const res = combineMasks(mode === 'sub' && !base ? new Float32Array(W * H).fill(1) : base, m, mode);
      this.setMask(l, res, this.op === 'sub' ? 'طرح بالنقر' : 'تحديد بالنقر');
    } finally {
      b.done();
    }
  }

  down(e) {
    const l = this.layer;
    if (!l) return toast('اختر طبقة صورة أولًا', { kind: 'warn' });
    if (l.locked) return toast('الطبقة مقفلة', { kind: 'warn' });
    if (this.mode === 'click') {
      this.clickSelect(e, l);
      return;
    }
    const W = l.src.width;
    const H = l.src.height;
    this.app.checkpoint(this.mode === 'lasso' ? 'قص بالإصبع' : this.mode === 'hair' ? 'فرشاة الشعر' : this.op === 'add' ? 'فرشاة إضافة' : 'فرشاة طرح');
    const p = this.toLocal(e, l);
    if (this.mode === 'lasso') {
      this.stroke = { l, pts: [p] };
      return;
    }
    let mask;
    if (this.mode === 'hair') {
      mask = l.mask ? cloneCanvas(l.mask) : filledMask(W, H, 255);
      this.stroke = { l, region: mk(W, H), mask, last: p, r: this.localRadius(l) };
      this.stampRegion(this.stroke, p);
      return;
    }
    if (l.mask) mask = cloneCanvas(l.mask);
    else mask = this.op === 'add' ? mk(W, H) : filledMask(W, H, 255);
    l.mask = mask;
    l.maskOn = true;
    this.stroke = { l, mask, last: p, r: this.localRadius(l) };
    this.app.fastPreview = true;
    this.stamp(this.stroke, p);
    this.app.renderer.invalidate(l.id);
    this.app.changed({ save: false, structure: false });
  }

  brushStamp(r) {
    const key = r.toFixed(1) + ':' + this.hardness;
    if (this._stampKey === key) return this._stamp;
    const d = Math.max(2, Math.ceil(r * 2));
    const c = mk(d, d);
    const g = ctx2d(c);
    const gr = g.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, d / 2);
    const hard = this.hardness / 100;
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(Math.min(0.99, hard), 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, d, d);
    this._stamp = c;
    this._stampKey = key;
    return c;
  }

  /** يرسم خطًا من آخر نقطة إلى الحالية على القناع */
  stamp(s, p) {
    const g = ctx2d(s.mask);
    g.globalCompositeOperation = this.op === 'add' ? 'source-over' : 'destination-out';
    const st = this.brushStamp(s.r);
    const dist = Math.hypot(p.u - s.last.u, p.v - s.last.v);
    const step = Math.max(1, s.r * 0.25);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n || (i === 1 && n === 0); i++) {
      const t = n ? i / n : 1;
      const x = s.last.u + (p.u - s.last.u) * t;
      const y = s.last.v + (p.v - s.last.v) * t;
      g.drawImage(st, x - st.width / 2, y - st.height / 2);
    }
    s.last = p;
  }

  stampRegion(s, p) {
    const g = ctx2d(s.region);
    g.strokeStyle = '#fff';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = s.r * 2;
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
    if (this.mode === 'lasso') {
      s.pts.push(p);
      return;
    }
    if (this.mode === 'hair') {
      this.stampRegion(s, p);
      return;
    }
    this.stamp(s, p);
    this.app.renderer.invalidate(s.l.id);
    this.app.changed({ save: false, structure: false });
  }

  up() {
    const s = this.stroke;
    this.stroke = null;
    this.app.fastPreview = false;
    if (!s) return;
    const l = s.l;
    const W = l.src.width;
    const H = l.src.height;
    if (this.mode === 'lasso') {
      if (s.pts.length < 3) {
        this.app.history.undoStack.pop();
        return;
      }
      const base = l.mask ? cloneCanvas(l.mask) : this.op === 'add' ? mk(W, H) : filledMask(W, H, 255);
      const g = ctx2d(base);
      g.globalCompositeOperation = this.op === 'add' ? 'source-over' : 'destination-out';
      g.fillStyle = '#fff';
      g.beginPath();
      s.pts.forEach((p, i) => (i ? g.lineTo(p.u, p.v) : g.moveTo(p.u, p.v)));
      g.closePath();
      g.fill();
      l.mask = base;
      l.maskOn = true;
    } else if (this.mode === 'hair') {
      const b = busy('فرشاة الشعر تلتقط الخصلات…');
      try {
        const rgba = getData(l.src).data;
        const alpha = u8ToF32(canvasToMask(s.mask));
        const region = u8ToF32(canvasToMask(s.region));
        const out = matteRegion(rgba, alpha, region, W, H, s.r * 1.5);
        l.mask = maskToCanvas(f32ToU8(out), W, H);
        l.maskOn = true;
      } finally {
        b.done();
      }
    }
    this.app.renderer.invalidate(l.id);
    this.app.changed();
  }

  cancel() {
    if (!this.stroke) return;
    this.stroke = null;
    this.app.fastPreview = false;
    this.app.undo();
  }

  hover() {}

  // ---------- العرض ----------
  drawOverlay(g, vp) {
    const l = this.layer;
    const app = this.app;
    if (l && l.visible) {
      const m = layerMatrix(l);
      if (this.view === 'overlay') {
        g.save();
        g.transform(vp.zoom, 0, 0, vp.zoom, vp.tx, vp.ty);
        g.transform(...m);
        g.globalAlpha = 1;
        g.drawImage(l.src, 0, 0);
        g.drawImage(this.redOverlay(l), 0, 0);
        g.restore();
      } else if (this.view !== 'normal') {
        const d = app.doc;
        g.save();
        g.fillStyle = this.view === 'checker' ? vp.getChecker() : { white: '#ffffff', black: '#000000', red: '#e0201b' }[this.view];
        g.fillRect(vp.tx, vp.ty, d.width * vp.zoom, d.height * vp.zoom);
        g.transform(vp.zoom, 0, 0, vp.zoom, vp.tx, vp.ty);
        g.transform(...m);
        const p = app.renderer.processLayer(l);
        g.drawImage(p.canvas, p.ox, p.oy);
        g.restore();
      }
      if (this.stroke && this.mode === 'lasso') {
        g.save();
        g.transform(vp.zoom, 0, 0, vp.zoom, vp.tx, vp.ty);
        g.transform(...m);
        g.lineWidth = 2 / (vp.zoom * Math.abs(l.sx));
        g.strokeStyle = '#4cc2ff';
        g.setLineDash([6 / vp.zoom, 4 / vp.zoom]);
        g.beginPath();
        this.stroke.pts.forEach((p, i) => (i ? g.lineTo(p.u, p.v) : g.moveTo(p.u, p.v)));
        g.stroke();
        g.restore();
      }
      if (this.stroke && this.mode === 'hair') {
        g.save();
        g.transform(vp.zoom, 0, 0, vp.zoom, vp.tx, vp.ty);
        g.transform(...m);
        g.globalAlpha = 0.35;
        g.drawImage(this.tint(this.stroke.region, '#00d0ff'), 0, 0);
        g.restore();
      }
    }
    // مؤشر الفرشاة
    const hv = vp.hover;
    if (hv && (this.mode === 'brush' || this.mode === 'hair')) {
      g.beginPath();
      g.arc(hv.sx, hv.sy, this.size / 2, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(0,0,0,.7)';
      g.lineWidth = 3;
      g.stroke();
      g.strokeStyle = this.op === 'add' ? '#ffffff' : '#ff8080';
      g.lineWidth = 1.5;
      g.stroke();
    }
  }

  tint(c, color) {
    const t = mk(c.width, c.height);
    const g = ctx2d(t);
    g.drawImage(c, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, t.width, t.height);
    return t;
  }

  /** طبقة حمراء فوق المناطق المستبعدة (أسلوب القناع السريع) */
  redOverlay(l) {
    const key = l.mask;
    if (this._ovKey === key && this._ovCanvas && !this.stroke) return this._ovCanvas;
    const W = l.src.width;
    const H = l.src.height;
    const t = this._ovCanvas && this._ovCanvas.width === W && this._ovCanvas.height === H ? this._ovCanvas : mk(W, H);
    const g = ctx2d(t);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,40,60,0.55)';
    g.fillRect(0, 0, W, H);
    if (l.mask && l.maskOn) {
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(l.mask, 0, 0);
    } else if (!l.mask) g.clearRect(0, 0, W, H);
    this._ovCanvas = t;
    this._ovKey = key;
    return t;
  }
}
