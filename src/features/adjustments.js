// المرحلة 6 (أ): طبقات التعديل غير الإتلافية، وCurves، وLevels، وLUT، وأقنعة طبقات التعديل
import { adjusters } from '../core/render.js';
import { registerSection, propSlider } from '../ui/props.js';
import { h, iconBtn, modal, toast, selectBox, pickFiles, slider } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { mk, ctx2d, cloneCanvas, filledMask } from '../core/canvas.js';
import { createAdjustLayer, findLayer } from '../core/doc.js';
import { applyBasic, applyCurves, applyLevels, applyColorBalance, applyHSL, applyLUT3D, parseCube, curveLUT, histogram, IDENTITY_CURVE } from '../img/adjust.js';

export const ADJ_KINDS = [
  { kind: 'basic', label: 'سطوع وتباين وألوان', icon: 'sun', params: () => ({ exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, temperature: 0, tint: 0, saturation: 0, vibrance: 0, sharpness: 0 }) },
  { kind: 'curves', label: 'المنحنيات (Curves)', icon: 'spline', params: () => ({ rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] }) },
  { kind: 'levels', label: 'المستويات (Levels)', icon: 'sliders', params: () => ({ rgb: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 } }) },
  { kind: 'colorBalance', label: 'توازن اللون', icon: 'palette', params: () => ({ shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0] }) },
  { kind: 'hsl', label: 'التدرج والتشبع', icon: 'droplet', params: () => ({ hue: 0, saturation: 0, lightness: 0 }) },
  { kind: 'lut', label: 'LUT (ملف .cube)', icon: 'film', params: () => ({ lut: null, name: '', intensity: 100 }) },
  { kind: 'grain', label: 'حبيبات', icon: 'scan', params: () => ({ amount: 22, size: 1.5, mono: true }) }
];

function pixelAdjuster(fn) {
  return (src, p) => {
    const W = src.width;
    const H = src.height;
    const g = src.getContext('2d', { willReadFrequently: true });
    const img = g.getImageData(0, 0, W, H);
    fn(img.data, p, src);
    const out = mk(W, H);
    ctx2d(out).putImageData(img, 0, 0);
    return out;
  };
}

function sharpenCanvas(c, amount) {
  if (!amount) return c;
  const W = c.width;
  const H = c.height;
  const b = mk(W, H);
  const bg = ctx2d(b, { willReadFrequently: true });
  bg.filter = 'blur(1.2px)';
  bg.drawImage(c, 0, 0);
  const bd = bg.getImageData(0, 0, W, H).data;
  const g = c.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const k = amount / 50;
  for (let i = 0; i < d.length; i += 4) for (let j = 0; j < 3; j++) d[i + j] = d[i + j] + (d[i + j] - bd[i + j]) * k;
  g.putImageData(img, 0, 0);
  return c;
}

export function addAdjustLayer(app, kind) {
  const def = ADJ_KINDS.find((k) => k.kind === kind);
  const l = createAdjustLayer(kind, def.params(), def.label);
  app.edit('طبقة تعديل', (doc) => {
    // فوق الطبقة المحددة، وإلا في الأعلى
    const f = doc.selectedId ? findLayer(doc, doc.selectedId) : null;
    if (f) f.list.splice(f.index + 1, 0, l);
    else doc.layers.push(l);
    doc.selectedId = l.id;
  });
  app.emit('select');
  app.showTab?.('props');
  return l;
}

export async function addAdjustDialog(app) {
  const list = h('div', { class: 'menu-list' });
  const body = h('div', {}, h('p', { class: 'hint' }, 'طبقة التعديل تؤثر على كل ما تحتها دون تغيير الأصل، ويمكن حصرها بقناع.'), list);
  const p = modal('طبقة تعديل جديدة', body, []);
  for (const k of ADJ_KINDS) {
    list.append(h('button', { class: 'menu-item', type: 'button', 'data-testid': 'adj-' + k.kind, onclick: () => { body.closeModal(null); addAdjustLayer(app, k.kind); } }, icon(k.icon, 24), h('span', {}, k.label)));
  }
  return p;
}

// ---------- محرر المنحنيات ----------
function curvesEditor(app, l) {
  const p = l.params;
  let ch = 'rgb';
  const S = 260;
  const c = h('canvas', { width: S * 2, height: S * 2, class: 'curves', 'data-testid': 'curves', style: { width: '100%', maxWidth: S + 'px', aspectRatio: '1', touchAction: 'none' } });
  const hist = (() => {
    try {
      return app.comp ? histogram(app.comp.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, app.comp.width, app.comp.height).data) : null;
    } catch {
      return null;
    }
  })();
  const colors = { rgb: '#ffffff', r: '#ff5d5d', g: '#4fd67a', b: '#5aa8ff' };
  const draw = () => {
    const g = c.getContext('2d');
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.clearRect(0, 0, S, S);
    g.fillStyle = '#15171c';
    g.fillRect(0, 0, S, S);
    if (hist) {
      const H = hist[ch === 'rgb' ? 'l' : ch];
      const mx = Math.max(...H) || 1;
      g.fillStyle = 'rgba(255,255,255,.12)';
      for (let i = 0; i < 256; i++) {
        const v = Math.sqrt(H[i] / mx) * S;
        g.fillRect((i / 255) * S, S - v, S / 256 + 0.5, v);
      }
    }
    g.strokeStyle = '#2c3040';
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      g.beginPath();
      g.moveTo((i * S) / 4, 0);
      g.lineTo((i * S) / 4, S);
      g.moveTo(0, (i * S) / 4);
      g.lineTo(S, (i * S) / 4);
      g.stroke();
    }
    const lut = curveLUT(p[ch]);
    g.strokeStyle = colors[ch];
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * S;
      const y = S - (lut[i] / 255) * S;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    for (const [x, y] of p[ch]) {
      g.beginPath();
      g.arc((x / 255) * S, S - (y / 255) * S, 7, 0, Math.PI * 2);
      g.fillStyle = colors[ch];
      g.fill();
    }
  };
  let drag = -1;
  const pos = (e) => {
    const r = c.getBoundingClientRect();
    return [Math.max(0, Math.min(255, ((e.clientX - r.left) / r.width) * 255)), Math.max(0, Math.min(255, (1 - (e.clientY - r.top) / r.height) * 255))];
  };
  c.addEventListener('pointerdown', (e) => {
    c.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    app.checkpoint('المنحنيات');
    const pts = p[ch];
    drag = pts.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 16);
    if (drag < 0) {
      pts.push([Math.round(x), Math.round(y)]);
      pts.sort((a, b) => a[0] - b[0]);
      drag = pts.findIndex(([px]) => px === Math.round(x));
    }
    draw();
    app.changed({ save: false, structure: false });
  });
  c.addEventListener('pointermove', (e) => {
    if (drag < 0) return;
    const [x, y] = pos(e);
    const pts = p[ch];
    const lo = drag > 0 ? pts[drag - 1][0] + 1 : 0;
    const hi = drag < pts.length - 1 ? pts[drag + 1][0] - 1 : 255;
    pts[drag] = [Math.round(Math.max(lo, Math.min(hi, x))), Math.round(y)];
    draw();
    app.changed({ save: false, structure: false });
  });
  c.addEventListener('pointerup', () => {
    drag = -1;
    app.changed();
  });
  c.addEventListener('dblclick', (e) => {
    const [x, y] = pos(e);
    const pts = p[ch];
    const i = pts.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 16);
    if (i > 0 && i < pts.length - 1) app.edit('حذف نقطة', () => pts.splice(i, 1));
    draw();
  });
  const chans = h('div', { class: 'segmented', 'data-testid': 'curve-ch' }, [['rgb', 'الكل'], ['r', 'أحمر'], ['g', 'أخضر'], ['b', 'أزرق']].map(([v, t]) =>
    h('button', { type: 'button', class: v === ch ? 'on' : '', 'data-v': v, onclick: (e) => { ch = v; [...e.target.parentNode.children].forEach((b) => b.classList.toggle('on', b.dataset.v === v)); draw(); } }, t)));
  const presets = h('div', { class: 'row-btns' },
    iconBtn('contrast', 'منحنى S (تباين)', () => app.edit('منحنى S', () => (p[ch] = [[0, 0], [64, 46], [192, 210], [255, 255]])), { testid: 'curve-s' }),
    iconBtn('fit', 'أسود باهت (فيلم)', () => app.edit('منحنى فيلم', () => (p[ch] = [[0, 28], [128, 128], [255, 245]]))),
    iconBtn('reset', 'إعادة', () => app.edit('إعادة المنحنى', () => (p[ch] = [...IDENTITY_CURVE.map((x) => [...x])]))));
  draw();
  app.on('restored', draw);
  return h('div', {}, chans, c, h('p', { class: 'hint' }, 'المس المنحنى لإضافة نقطة واسحبها. نقر مزدوج يحذف النقطة.'), presets);
}

function levelsEditor(app, l) {
  const p = l.params;
  let ch = 'rgb';
  const wrap = h('div', {});
  const render = () => {
    p[ch] ||= { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
    const q = p[ch];
    wrap.replaceChildren(
      h('div', { class: 'segmented' }, [['rgb', 'الكل'], ['r', 'أحمر'], ['g', 'أخضر'], ['b', 'أزرق']].map(([v, t]) => h('button', { type: 'button', class: v === ch ? 'on' : '', onclick: () => { ch = v; render(); } }, t))),
      propSlider(app, q, 'inBlack', { label: 'النقطة السوداء', min: 0, max: 254, testid: 'lv-black' }),
      propSlider(app, q, 'gamma', { label: 'الدرجات الوسطى (غاما)', min: 0.1, max: 3, step: 0.01, testid: 'lv-gamma' }),
      propSlider(app, q, 'inWhite', { label: 'النقطة البيضاء', min: 1, max: 255, testid: 'lv-white' }),
      propSlider(app, q, 'outBlack', { label: 'أدنى ناتج', min: 0, max: 255 }),
      propSlider(app, q, 'outWhite', { label: 'أعلى ناتج', min: 0, max: 255 })
    );
  };
  render();
  return wrap;
}

function basicEditor(app, l) {
  const p = l.params;
  const s = (k, label, testid) => propSlider(app, p, k, { label, min: -100, max: 100, testid });
  return h('div', {},
    s('exposure', 'التعريض', 'adj-exposure'), s('brightness', 'السطوع'), s('contrast', 'التباين', 'adj-contrast'),
    s('highlights', 'الإضاءات'), s('shadows', 'الظلال'), s('temperature', 'حرارة اللون', 'adj-temp'), s('tint', 'الصبغة'),
    s('saturation', 'التشبع', 'adj-sat'), s('vibrance', 'الحيوية'),
    propSlider(app, p, 'sharpness', { label: 'الحدة', min: 0, max: 100 }));
}

function balanceEditor(app, l) {
  const p = l.params;
  let zone = 'midtones';
  const wrap = h('div', {});
  const render = () => {
    const v = p[zone];
    const s = (i, label) => propSlider(app, v, i, { label, min: -100, max: 100 });
    wrap.replaceChildren(
      h('div', { class: 'segmented' }, [['shadows', 'الظلال'], ['midtones', 'الوسط'], ['highlights', 'الإضاءات']].map(([z, t]) => h('button', { type: 'button', class: z === zone ? 'on' : '', onclick: () => { zone = z; render(); } }, t))),
      s(0, 'سماوي ← أحمر'), s(1, 'أرجواني ← أخضر'), s(2, 'أصفر ← أزرق'));
  };
  render();
  return wrap;
}

function hslEditor(app, l) {
  const p = l.params;
  return h('div', {},
    propSlider(app, p, 'hue', { label: 'التدرج اللوني', min: -180, max: 180, unit: '°' }),
    propSlider(app, p, 'saturation', { label: 'التشبع', min: -100, max: 100 }),
    propSlider(app, p, 'lightness', { label: 'الإضاءة', min: -100, max: 100 }));
}

function lutEditor(app, l) {
  const p = l.params;
  const use = (name, lut) => {
    app.edit('مرشح LUT', () => {
      p.lut = lut;
      p.name = name;
    });
    app.emit('props-refresh');
  };
  // مرشحاتي المحفوظة: لمسة واحدة لتطبيقها
  const mine = h('div', { class: 'chips', 'data-testid': 'lut-mine' });
  import('./assets.js').then(async ({ listUserLuts }) => {
    for (const r of await listUserLuts()) mine.append(h('button', { type: 'button', class: 'chip' + (p.name === r.name ? ' on' : ''), onclick: () => use(r.name, r.lut) }, r.name));
  });
  return h('div', {},
    h('p', { class: 'hint' }, p.name ? `المرشح: ${p.name} (${p.lut?.size}³)` : 'اختر مرشحًا من «مرشحاتي» أو حمّل ملف ‎.cube.'),
    mine,
    iconBtn('upload', 'تحميل ملف .cube', async () => {
      const [f] = await pickFiles({ accept: '.cube', multiple: false });
      if (!f) return;
      try {
        const lut = parseCube(await f.text());
        const name = f.name.replace(/\.cube$/i, '');
        // يُحفظ تلقائيًا في «مرشحاتي» ليُستعمل لاحقًا بلمسة
        const { saveLut } = await import('./assets.js');
        await saveLut(name, lut);
        use(name, lut);
      } catch (e) {
        toast(e.message, { kind: 'error' });
      }
    }, { testid: 'lut-load' }),
    propSlider(app, p, 'intensity', { label: 'الشدة', min: 0, max: 100, unit: '٪' }));
}

const EDITORS = { basic: basicEditor, curves: curvesEditor, levels: levelsEditor, colorBalance: balanceEditor, hsl: hslEditor, lut: lutEditor };

// ---------- أداة قناع طبقة التعديل ----------
class AdjMaskTool {
  constructor() {
    this.label = 'قناع التعديل';
    this.mode = 'brush'; // brush | radial | linear
    this.op = 'add';
    this.size = 120;
    this.stroke = null;
    this.wantsCoalesced = true;
  }
  get layer() {
    const l = this.app.selected;
    return l && l.type === 'adjust' ? l : null;
  }
  onSelect() {
    this.app.emit('tool-options');
  }
  options() {
    const app = this.app;
    const l = this.layer;
    if (!l) return h('span', { class: 'hint' }, 'اختر طبقة تعديل لرسم قناعها، فيقتصر أثرها على مناطق محددة.');
    const seg = (items, cur, set) => h('div', { class: 'segmented' }, items.map(([v, t, ic]) => h('button', { type: 'button', class: v === cur ? 'on' : '', 'data-v': v, onclick: () => { set(v); app.emit('tool-options'); } }, ic ? icon(ic, 22) : null, t)));
    return h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
      h('div', { 'data-testid': 'am-mode' }, seg([['brush', 'فرشاة', 'brush'], ['radial', 'دائري (نقطة)', 'circle'], ['linear', 'تدرج خطي', 'square']], this.mode, (v) => (this.mode = v))),
      h('div', { 'data-testid': 'am-op' }, seg([['add', 'إظهار', 'plus'], ['sub', 'إخفاء', 'erase']], this.op, (v) => (this.op = v))),
      this.mode === 'brush' ? slider({ label: 'الحجم', min: 10, max: 400, value: this.size, onInput: (v) => (this.size = v) }) : null,
      iconBtn('contrast', 'عكس', () => this.invert()),
      iconBtn('reset', 'إزالة القناع', () => app.edit('إزالة القناع', () => (l.mask = null)), { testid: 'am-clear' }));
  }
  invert() {
    const l = this.layer;
    if (!l) return;
    const d = this.app.doc;
    const c = filledMask(d.width, d.height, 255);
    const g = ctx2d(c);
    g.globalCompositeOperation = 'destination-out';
    if (l.mask) g.drawImage(l.mask, 0, 0, d.width, d.height);
    else g.clearRect(0, 0, d.width, d.height);
    this.app.edit('عكس القناع', () => (l.mask = c));
  }
  down(e) {
    const l = this.layer;
    if (!l) return toast('اختر طبقة تعديل أولًا', { kind: 'warn' });
    const d = this.app.doc;
    this.app.checkpoint('قناع التعديل');
    let mask;
    if (this.mode === 'brush') {
      mask = l.mask ? cloneCanvas(l.mask) : this.op === 'add' ? mk(d.width, d.height) : filledMask(d.width, d.height, 255);
    } else mask = l.mask ? cloneCanvas(l.mask) : mk(d.width, d.height);
    this.stroke = { l, mask, base: l.mask, x0: e.x, y0: e.y, last: e };
    l.mask = mask;
    if (this.mode === 'brush') this.dab(e);
  }
  dab(e) {
    const s = this.stroke;
    const g = ctx2d(s.mask);
    g.globalCompositeOperation = this.op === 'add' ? 'source-over' : 'destination-out';
    const r = this.size / 2 / this.app.viewport.zoom;
    const steps = Math.max(1, Math.ceil(Math.hypot(e.x - s.last.x, e.y - s.last.y) / (r * 0.25)));
    for (let i = 1; i <= steps; i++) {
      const x = s.last.x + ((e.x - s.last.x) * i) / steps;
      const y = s.last.y + ((e.y - s.last.y) * i) / steps;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.5, 'rgba(255,255,255,.8)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    s.last = e;
  }
  move(e) {
    const s = this.stroke;
    if (!s) return;
    if (this.mode === 'brush') this.dab(e);
    else {
      // الأشكال: نعيد الرسم من القناع الأساسي
      const d = this.app.doc;
      const m = s.base ? cloneCanvas(s.base) : mk(d.width, d.height);
      const g = ctx2d(m);
      g.globalCompositeOperation = this.op === 'add' ? 'source-over' : 'destination-out';
      const dist = Math.hypot(e.x - s.x0, e.y - s.y0);
      if (this.mode === 'radial') {
        const gr = g.createRadialGradient(s.x0, s.y0, 0, s.x0, s.y0, Math.max(1, dist));
        gr.addColorStop(0, 'rgba(255,255,255,1)');
        gr.addColorStop(0.55, 'rgba(255,255,255,.85)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
      } else {
        const gr = g.createLinearGradient(s.x0, s.y0, e.x, e.y);
        gr.addColorStop(0, 'rgba(255,255,255,1)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
      }
      g.fillRect(0, 0, d.width, d.height);
      s.mask = m;
      s.l.mask = m;
      s.end = e;
    }
    this.app.changed({ save: false, structure: false });
  }
  up() {
    if (!this.stroke) return;
    this.stroke = null;
    this.app.changed();
  }
  cancel() {
    if (this.stroke) {
      this.stroke = null;
      this.app.undo();
    }
  }
  drawOverlay(g, vp) {
    const l = this.layer;
    if (!l || !l.mask) return;
    // عرض القناع بلون أحمر شفاف أثناء الرسم
    if (this.stroke) {
      g.save();
      g.globalAlpha = 0.3;
      const t = mk(l.mask.width, l.mask.height);
      const tg = ctx2d(t);
      tg.drawImage(l.mask, 0, 0);
      tg.globalCompositeOperation = 'source-in';
      tg.fillStyle = '#ff3355';
      tg.fillRect(0, 0, t.width, t.height);
      g.drawImage(t, vp.tx, vp.ty, this.app.doc.width * vp.zoom, this.app.doc.height * vp.zoom);
      g.restore();
    }
    const hv = vp.hover;
    if (hv && this.mode === 'brush') {
      g.beginPath();
      g.arc(hv.sx, hv.sy, this.size / 2, 0, Math.PI * 2);
      g.strokeStyle = '#fff';
      g.stroke();
    }
  }
}

export default {
  install({ app, toolDefs, menuItems }) {
    adjusters.basic = (src, p) => sharpenCanvas(pixelAdjuster(applyBasic)(src, p), p.sharpness);
    adjusters.curves = pixelAdjuster(applyCurves);
    adjusters.levels = pixelAdjuster(applyLevels);
    adjusters.colorBalance = pixelAdjuster(applyColorBalance);
    adjusters.hsl = pixelAdjuster(applyHSL);
    adjusters.lut = (src, p) => (p.lut ? pixelAdjuster((d) => applyLUT3D(d, p.lut, p.intensity / 100))(src, p) : null);

    app.registerTool('adjmask', new AdjMaskTool());
    toolDefs.push({ name: 'adjmask', icon: 'paint', label: 'قناع تعديل', key: 'm' });
    menuItems.push({ icon: 'sliders', label: 'طبقة تعديل جديدة', run: () => addAdjustDialog(app), testid: 'm-adjust' });
    const foot = app.layersPanel?.foot;
    if (foot) foot.insertBefore(iconBtn('sliders', 'تعديل', () => addAdjustDialog(app), { testid: 'layer-adjust' }), foot.children[1]);

    registerSection({
      id: 'adjust',
      title: 'التعديل',
      order: 5,
      when: (l) => l.type === 'adjust' && EDITORS[l.kind],
      build: (l) => EDITORS[l.kind](app, l)
    });
    registerSection({
      id: 'adjmask',
      title: 'قناع التعديل',
      order: 50,
      when: (l) => l.type === 'adjust',
      build: (l) => h('div', {},
        h('p', { class: 'hint' }, l.mask ? 'للتعديل قناع: يؤثر في المناطق البيضاء فقط.' : 'بلا قناع: يؤثر في اللوحة كلها. ارسم قناعًا لحصره في منطقة (مثل التعديل الانتقائي في Snapseed).'),
        iconBtn('paint', 'ارسم القناع', () => app.setTool('adjmask'), { testid: 'am-open' }))
    });
  }
};
