// المرحلة 4: أدوات الانسجام — مطابقة الألوان، واتجاه الضوء، ومولّد الظل، والتفاف الضوء، والحدة، والحبيبات
import { registerStep, docSpaceEffects, shadowRenderer, adjusters } from '../core/render.js';
import { registerSection, propSlider } from '../ui/props.js';
import { h, iconBtn, toast, busy, toggle, selectBox } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { mk, ctx2d, getData, canvasToMask } from '../core/canvas.js';
import { createShadowLayer, createAdjustLayer, layerCorners, findLayer } from '../core/doc.js';
import { labStats, colorTransfer, sharpness } from '../img/color.js';
import { gaussBlur } from '../img/blur.js';
import { u8ToF32 } from '../img/mask.js';
import { rasterId } from '../core/util.js';
import { MoveTool } from '../tools/move.js';

const DEG = Math.PI / 180;

export function docLight(doc) {
  if (!doc.light) doc.light = { angle: -135, elevation: 40 };
  return doc.light;
}

// ---------- مطابقة الألوان ----------
function bboxOf(l, doc, pad = 0) {
  const pts = layerCorners(l);
  let x0 = Math.min(...pts.map((p) => p[0]));
  let y0 = Math.min(...pts.map((p) => p[1]));
  let x1 = Math.max(...pts.map((p) => p[0]));
  let y1 = Math.max(...pts.map((p) => p[1]));
  const pw = (x1 - x0) * pad;
  const ph = (y1 - y0) * pad;
  x0 = Math.max(0, Math.floor(x0 - pw));
  y0 = Math.max(0, Math.floor(y0 - ph));
  x1 = Math.min(doc.width, Math.ceil(x1 + pw));
  y1 = Math.min(doc.height, Math.ceil(y1 + ph));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/** ما تحت الطبقة في المستند (الخلفية التي سيُطابَق معها) بمقياس مصغر */
function backdropFor(app, l, maxSide = 600) {
  const doc = app.doc;
  const s = Math.min(1, maxSide / Math.max(doc.width, doc.height));
  const c = app.renderer.renderDoc(doc, { scale: s, stopAt: l.id, background: true });
  return { canvas: c, scale: s };
}

function elementStats(l) {
  const S = Math.min(1, 500 / Math.max(l.src.width, l.src.height));
  const w = Math.max(1, Math.round(l.src.width * S));
  const hh = Math.max(1, Math.round(l.src.height * S));
  const c = mk(w, hh);
  const g = ctx2d(c, { willReadFrequently: true });
  g.drawImage(l.src, 0, 0, w, hh);
  if (l.retouch) g.drawImage(l.retouch, 0, 0, w, hh);
  let alpha = null;
  if (l.mask && l.maskOn) {
    const m = mk(w, hh);
    ctx2d(m).drawImage(l.mask, 0, 0, w, hh);
    alpha = u8ToF32(canvasToMask(m));
  }
  return labStats(getData(c).data, alpha);
}

export function matchColor(app, l, strength = 0.8) {
  const src = elementStats(l);
  const { canvas, scale } = backdropFor(app, l);
  const b = bboxOf(l, app.doc, 0.5);
  const x = Math.floor(b.x * scale);
  const y = Math.floor(b.y * scale);
  const w = Math.max(1, Math.ceil(b.w * scale));
  const hh = Math.max(1, Math.ceil(b.h * scale));
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, Math.min(w, canvas.width - x), Math.min(hh, canvas.height - y)).data;
  const dst = labStats(d, null);
  if (!src || !dst) {
    toast('لا توجد خلفية تحت العنصر للمطابقة معها', { kind: 'warn' });
    return false;
  }
  app.edit('مطابقة الألوان', () => {
    l.fx.colorMatch = { strength, lumOnly: false, src, dst };
  });
  return true;
}

// ---------- اتجاه الضوء على العنصر ----------
function applyLight(canvas, l, light) {
  const W = canvas.width;
  const H = canvas.height;
  const img = getData(canvas);
  const d = img.data;
  const n = W * H;
  const A = new Float32Array(n);
  let m = null;
  if (l.mask && l.maskOn) m = canvasToMask(l.mask.width === W ? l.mask : (() => { const t = mk(W, H); ctx2d(t).drawImage(l.mask, 0, 0, W, H); return t; })());
  for (let i = 0, j = 3; i < n; i++, j += 4) A[i] = (d[j] / 255) * (m ? m[i] / 255 : 1);
  const sig = Math.max(2, Math.max(W, H) / 40) * (0.5 + (l.fx.light.wrap ?? 50) / 100);
  const Ab = gaussBlur(A, W, H, sig);
  // اتجاه الضوء في فضاء الطبقة
  let phi = light.angle * DEG - l.rot;
  let lx = Math.cos(phi);
  let ly = Math.sin(phi);
  if (l.sx < 0) lx = -lx;
  if (l.sy < 0) ly = -ly;
  const st = (l.fx.light.strength ?? 50) / 100;
  const cx = W / 2;
  const cy = H / 2;
  const kEdge = sig * 2.2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (A[i] <= 0.004) continue;
      const gx = (Ab[i + (x < W - 1 ? 1 : 0)] - Ab[i - (x > 0 ? 1 : 0)]) * 0.5;
      const gy = (Ab[i + (y < H - 1 ? W : 0)] - Ab[i - (y > 0 ? W : 0)]) * 0.5;
      // العمودي للخارج = عكس التدرج
      const rim = -(gx * lx + gy * ly) * kEdge;
      const lin = ((x - cx) / W) * 2 * lx + ((y - cy) / H) * 2 * ly;
      let s = st * (0.45 * lin + Math.max(-1, Math.min(1, rim)) * 0.9);
      const j = i * 4;
      for (let k = 0; k < 3; k++) {
        const c = d[j + k];
        d[j + k] = s >= 0 ? c + (255 - c) * s * 0.55 : c * (1 + s * 0.6);
      }
    }
  }
  const out = mk(W, H);
  ctx2d(out).putImageData(img, 0, 0);
  return out;
}

// ---------- مولّد الظل ----------
const shadowCache = new Map();

function alphaBox(c, b) {
  // أسفل نقطة معتمة في الصورة الظلية (خط الأرض)
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(b.x, b.y, b.w, b.h).data;
  for (let y = b.h - 1; y >= 0; y--) {
    for (let x = 0; x < b.w; x++) if (d[(y * b.w + x) * 4 + 3] > 40) return b.y + y + 1;
  }
  return b.y + b.h;
}

export function renderShadow(sh, ref, renderer, doc, scale, W, H) {
  if (!ref.visible || ref.type !== 'image') return null;
  const p = sh.params;
  const light = docLight(doc);
  const key = [renderer.layerKey(ref), ref.x, ref.y, ref.sx, ref.sy, ref.rot, JSON.stringify(p), light.angle, light.elevation, scale, W, H].join('|');
  const hit = shadowCache.get(sh.id);
  if (hit && hit.key === key) return hit.canvas;
  const sil = renderer.layerToDocCanvas(ref, W, H, scale);
  const bb = bboxOf(ref, { width: W / scale, height: H / scale }, 0);
  const b = { x: Math.floor(bb.x * scale), y: Math.floor(bb.y * scale), w: Math.max(1, Math.ceil(bb.w * scale)), h: Math.max(1, Math.ceil(bb.h * scale)) };
  b.w = Math.min(b.w, W - b.x);
  b.h = Math.min(b.h, H - b.y);
  if (b.w <= 0 || b.h <= 0) return null;
  const yb = alphaBox(sil, b) + (p.offsetY || 0) * scale;
  const out = mk(W, H);
  const og = ctx2d(out);
  const color = p.color || '#000000';
  const bh = b.h;
  if (p.kind === 'contact') {
    const band = Math.max(2, bh * (p.size ?? 8) / 100);
    const t = mk(W, H);
    const tg = ctx2d(t);
    // شريط القاعدة مضغوط عموديًا
    tg.drawImage(sil, 0, yb - band, W, band, -b.w * 0.03, yb - band * 0.18, W * 1.06, band * 0.36);
    og.filter = `blur(${Math.max(1, ((p.blur ?? 6) * scale) + band * 0.12)}px)`;
    og.drawImage(t, 0, 0);
    og.filter = 'none';
  } else {
    const L = (p.length ?? 60) / 100;
    const ang = light.angle * DEG;
    // الظل يمتد عكس اتجاه الضوء أفقيًا
    const shx = -Math.cos(ang) * ((p.skew ?? 80) / 100) * Math.max(0.3, Math.abs(L));
    const sy = L;
    const P = mk(W, H);
    const pg = ctx2d(P);
    // x' = x + shx·(yb − y) ، y' = yb − sy·(yb − y)
    pg.setTransform(1, 0, -shx, sy, shx * yb, yb * (1 - sy));
    pg.drawImage(sil, 0, 0);
    pg.setTransform(1, 0, 0, 1, 0, 0);
    const maxD = Math.max(4, Math.abs(sy) * bh);
    const b0 = Math.max(0.5, (p.blur ?? 4) * scale);
    const b1 = b0 + (p.softness ?? 60) / 100 * maxD * 0.12;
    const K = 5;
    const dir = sy >= 0 ? -1 : 1; // الاتجاه العمودي للظل على الشاشة
    for (let i = 0; i < K; i++) {
      const t = mk(W, H);
      const tg = ctx2d(t);
      tg.filter = `blur(${b0 + (b1 - b0) * (i / (K - 1))}px)`;
      tg.drawImage(P, 0, 0);
      tg.filter = 'none';
      tg.globalCompositeOperation = 'destination-in';
      const gr = tg.createLinearGradient(0, yb, 0, yb + dir * maxD * 1.05);
      const stop = (v) => Math.min(1, Math.max(0, v));
      if (i > 0) gr.addColorStop(stop((i - 1) / (K - 1)), 'rgba(0,0,0,0)');
      gr.addColorStop(stop(i / (K - 1)), 'rgba(0,0,0,1)');
      if (i < K - 1) gr.addColorStop(stop((i + 1) / (K - 1)), 'rgba(0,0,0,0)');
      tg.fillStyle = gr;
      // ما قبل خط الأرض يأخذ أول شريحة كاملة
      tg.fillRect(0, 0, W, H);
      og.globalCompositeOperation = 'lighter';
      og.drawImage(t, 0, 0);
    }
    og.globalCompositeOperation = 'destination-in';
    const fade = og.createLinearGradient(0, yb, 0, yb + dir * maxD);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(1, `rgba(0,0,0,${1 - (p.fade ?? 70) / 100})`);
    og.fillStyle = fade;
    og.fillRect(0, 0, W, H);
  }
  og.globalCompositeOperation = 'source-in';
  og.fillStyle = color;
  og.fillRect(0, 0, W, H);
  og.globalCompositeOperation = 'source-over';
  shadowCache.set(sh.id, { key, canvas: out });
  return out;
}

export function addShadow(app, l, kind) {
  const light = docLight(app.doc);
  const params = kind === 'contact'
    ? { kind, size: 8, blur: 6, color: '#000000' }
    : { kind, length: Math.round(Math.min(150, 40 / Math.tan(Math.max(10, light.elevation) * DEG))), skew: 80, blur: 3, softness: 60, fade: 70, color: '#000000' };
  const sh = createShadowLayer(l.id, params, kind === 'contact' ? 'ظل التلامس' : 'الظل المُلقى');
  sh.opacity = kind === 'contact' ? 0.85 : 0.55;
  app.insertBelow(sh, l.id, kind === 'contact' ? 'إضافة ظل تلامس' : 'إضافة ظل');
  return sh;
}

// ---------- التفاف الضوء ----------
function lightWrapEffect(lc, backdrop, l, scale) {
  const lw = l.fx.lightWrap;
  const W = lc.width;
  const H = lc.height;
  const width = Math.max(1, lw.width * scale);
  // شريط الحافة الداخلية
  const band = mk(W, H);
  const bg = ctx2d(band);
  bg.drawImage(lc, 0, 0);
  bg.globalCompositeOperation = 'destination-out';
  bg.filter = `blur(${width}px)`;
  bg.drawImage(lc, 0, 0);
  bg.filter = 'none';
  // ضوء الخلفية المنتشر
  const wrap = mk(W, H);
  const wg = ctx2d(wrap);
  wg.filter = `blur(${width * 1.5}px)`;
  wg.drawImage(backdrop, 0, 0);
  wg.filter = 'none';
  wg.globalCompositeOperation = 'destination-in';
  wg.drawImage(band, 0, 0);
  wg.drawImage(band, 0, 0); // تقوية الشريط
  const out = mk(W, H);
  const o = ctx2d(out);
  o.drawImage(lc, 0, 0);
  o.globalAlpha = Math.min(1, lw.strength / 100);
  o.globalCompositeOperation = 'screen';
  o.drawImage(wrap, 0, 0);
  o.globalAlpha = 1;
  o.globalCompositeOperation = 'destination-in';
  o.drawImage(lc, 0, 0);
  return out;
}

// ---------- الحبيبات ----------
const noiseTiles = new Map();
function noiseTile(mono, seed = 7) {
  const k = mono + ':' + seed;
  if (noiseTiles.has(k)) return noiseTiles.get(k);
  const S = 256;
  const c = mk(S, S);
  const img = new ImageData(S, S);
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  // توزيع قريب من الطبيعي
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 0.87;
  for (let i = 0; i < S * S * 4; i += 4) {
    if (mono) {
      const v = 128 + gauss() * 64;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    } else {
      img.data[i] = 128 + gauss() * 64;
      img.data[i + 1] = 128 + gauss() * 64;
      img.data[i + 2] = 128 + gauss() * 64;
    }
    img.data[i + 3] = 255;
  }
  ctx2d(c).putImageData(img, 0, 0);
  noiseTiles.set(k, c);
  return c;
}

export function grainAdjust(src, p, doc, scale) {
  const W = src.width;
  const H = src.height;
  const out = mk(W, H);
  const g = ctx2d(out);
  g.drawImage(src, 0, 0);
  const tile = noiseTile(!!p.mono);
  const size = Math.max(0.5, (p.size ?? 1.5) * scale);
  const pat = g.createPattern(tile, 'repeat');
  pat.setTransform(new DOMMatrix([size, 0, 0, size, 0, 0]));
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = Math.min(1, (p.amount ?? 25) / 100);
  g.fillStyle = pat;
  g.fillRect(0, 0, W, H);
  return out;
}

export function addGrain(app) {
  const l = createAdjustLayer('grain', { amount: 22, size: 1.5, mono: true }, 'حبيبات موحدة');
  app.edit('إضافة حبيبات', (doc) => {
    doc.layers.push(l);
    doc.selectedId = l.id;
  });
  app.emit('select');
  return l;
}

// ---------- مطابقة الحدة ----------
export function matchSharpness(app, l) {
  const doc = app.doc;
  const b = bboxOf(l, doc, 0.3);
  const s = Math.min(1, 800 / Math.max(b.w, b.h));
  const back = app.renderer.renderDoc(doc, { scale: s, stopAt: l.id });
  const crop = (c) => {
    const t = mk(Math.max(1, b.w * s), Math.max(1, b.h * s));
    ctx2d(t).drawImage(c, -b.x * s, -b.y * s);
    return t;
  };
  const backC = crop(back);
  const sb = sharpness(getData(backC).data, backC.width, backC.height);
  const saved = l.fx.blur;
  l.fx.blur = 0;
  app.renderer.invalidate(l.id);
  const el = crop(app.renderer.layerToDocCanvas(l, Math.round(doc.width * s), Math.round(doc.height * s), s));
  l.fx.blur = saved;
  app.renderer.invalidate(l.id);
  const se = sharpness(getData(el).data, el.width, el.height);
  if (sb == null || se == null) {
    toast('لا تكفي التفاصيل لقياس الحدة', { kind: 'warn' });
    return null;
  }
  if (se <= sb * 1.1) {
    toast('العنصر ليس أحدّ من الخلفية؛ لا حاجة لتنعيمه', { kind: 'ok' });
    app.edit('مطابقة الحدة', () => (l.fx.blur = 0));
    return 0;
  }
  // نجرّب درجات ضبابية حتى تتساوى الحدة
  let best = 0;
  let bestErr = Infinity;
  for (let sig = 0.25; sig <= 8; sig += 0.25) {
    const t = mk(el.width, el.height);
    const tg = ctx2d(t);
    tg.filter = `blur(${sig}px)`;
    tg.drawImage(el, 0, 0);
    const v = sharpness(getData(t).data, t.width, t.height);
    if (v == null) break;
    const err = Math.abs(Math.log((v + 1) / (sb + 1)));
    if (err < bestErr) {
      bestErr = err;
      best = sig;
    }
  }
  // الضبابية تُطبق في فضاء الطبقة قبل التحجيم
  const layerSigma = best / s / Math.max(0.01, Math.abs(l.sx));
  app.edit('مطابقة الحدة', () => (l.fx.blur = Math.round(layerSigma * 10) / 10));
  return l.fx.blur;
}

// ---------- قرص اتجاه الضوء ----------
function lightDial(app) {
  const size = 150;
  const c = h('canvas', { width: size * 2, height: size * 2, class: 'dial', 'data-testid': 'light-dial', style: { width: size + 'px', height: size + 'px', touchAction: 'none' } });
  const draw = () => {
    const L = docLight(app.doc);
    const g = c.getContext('2d');
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.clearRect(0, 0, size, size);
    const r = size / 2 - 14;
    g.strokeStyle = '#4b5060';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#2b2f3a';
    g.beginPath();
    g.arc(size / 2, size / 2, 18, 0, Math.PI * 2);
    g.fill();
    const a = L.angle * DEG;
    const sx = size / 2 + Math.cos(a) * r;
    const sy = size / 2 + Math.sin(a) * r;
    // سهم من الشمس نحو المركز
    g.strokeStyle = '#ffd36b';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(size / 2 + Math.cos(a) * 22, size / 2 + Math.sin(a) * 22);
    g.stroke();
    g.fillStyle = '#ffd36b';
    g.beginPath();
    g.arc(sx, sy, 12, 0, Math.PI * 2);
    g.fill();
  };
  let dragging = false;
  const set = (e) => {
    const r = c.getBoundingClientRect();
    const x = e.clientX - r.left - r.width / 2;
    const y = e.clientY - r.top - r.height / 2;
    docLight(app.doc).angle = Math.round(Math.atan2(y, x) / DEG);
    draw();
    app.renderer.invalidate();
    app.changed({ save: false, structure: false });
  };
  c.addEventListener('pointerdown', (e) => {
    dragging = true;
    c.setPointerCapture(e.pointerId);
    app.checkpoint('اتجاه الضوء');
    set(e);
  });
  c.addEventListener('pointermove', (e) => dragging && set(e));
  c.addEventListener('pointerup', () => {
    dragging = false;
    app.changed();
  });
  draw();
  return c;
}

// ---------- الواجهة ----------
function harmonyBody(app, l) {
  const fx = l.fx;
  const body = h('div', {});
  // مطابقة الألوان
  body.append(h('h4', { class: 'sub-h' }, icon('palette', 20), ' مطابقة الألوان'));
  body.append(h('div', { class: 'row-btns' },
    iconBtn('palette', 'طابق مع الخلفية', () => matchColor(app, l, fx.colorMatch?.strength ?? 0.8), { testid: 'match-color' }),
    fx.colorMatch ? iconBtn('x', 'إلغاء المطابقة', () => app.edit('إلغاء المطابقة', () => (fx.colorMatch = null)), { testid: 'match-color-off' }) : null
  ));
  if (fx.colorMatch) {
    const cm = fx.colorMatch;
    body.append(
      propSlider(app, cm, 'strength', { label: 'قوة التأثير', min: 0, max: 100, get: () => Math.round(cm.strength * 100), set: (v) => (cm.strength = v / 100), unit: '٪', testid: 'match-strength' }),
      toggle('الإضاءة فقط (بلا تغيير الألوان)', cm.lumOnly, (v) => app.edit('مطابقة الإضاءة فقط', () => (cm.lumOnly = v)))
    );
  }
  // الضوء
  body.append(h('h4', { class: 'sub-h' }, icon('sun', 20), ' اتجاه الضوء'));
  body.append(h('div', { class: 'dial-row' }, lightDial(app), h('p', { class: 'hint' }, 'اسحب الشمس إلى الجهة التي يأتي منها الضوء في لوحتك. الاتجاه واحد لكل العناصر والظلال.')));
  if (fx.light) {
    body.append(
      propSlider(app, fx.light, 'strength', { label: 'قوة الإضاءة والتظليل', min: 0, max: 100, unit: '٪', testid: 'light-strength' }),
      propSlider(app, fx.light, 'wrap', { label: 'انتشار الضوء على الجسم', min: 0, max: 100, unit: '٪' }),
      iconBtn('x', 'إزالة الإضاءة', () => app.edit('إزالة الإضاءة', () => (fx.light = null)))
    );
  } else body.append(iconBtn('sun', 'أضف إضاءة وتظليلًا', () => app.edit('إضاءة العنصر', () => (fx.light = { strength: 45, wrap: 50 })), { testid: 'light-on' }));
  // الظل
  body.append(h('h4', { class: 'sub-h' }, icon('moon', 20), ' الظل'));
  body.append(h('div', { class: 'row-btns' },
    iconBtn('footprints', 'ظل التلامس', () => addShadow(app, l, 'contact'), { testid: 'shadow-contact' }),
    iconBtn('moon', 'ظل مُلقى', () => addShadow(app, l, 'cast'), { testid: 'shadow-cast' })
  ));
  // التفاف الضوء
  body.append(h('h4', { class: 'sub-h' }, icon('sunMedium', 20), ' التفاف الضوء'));
  if (fx.lightWrap) {
    body.append(
      propSlider(app, fx.lightWrap, 'width', { label: 'عرض الالتفاف', min: 1, max: 60, unit: ' بكسل', testid: 'wrap-width' }),
      propSlider(app, fx.lightWrap, 'strength', { label: 'القوة', min: 0, max: 100, unit: '٪', testid: 'wrap-strength' }),
      iconBtn('x', 'إزالة الالتفاف', () => app.edit('إزالة التفاف الضوء', () => (fx.lightWrap = null)))
    );
  } else body.append(iconBtn('sunMedium', 'أضف التفاف الضوء', () => app.edit('التفاف الضوء', () => (fx.lightWrap = { width: 12, strength: 60 })), { testid: 'wrap-on' }));
  // الحدة
  body.append(h('h4', { class: 'sub-h' }, icon('focus', 20), ' الحدة والبعد'));
  body.append(
    propSlider(app, fx, 'blur', { label: 'ضبابية البعد', min: 0, max: 30, step: 0.1, unit: ' بكسل', testid: 'fx-blur' }),
    iconBtn('focus', 'طابق حدة الخلفية', () => {
      const b = busy('جارِ قياس الحدة…');
      try {
        const v = matchSharpness(app, l);
        if (v) toast(`ضبابية مقترحة: ${v} بكسل`, { kind: 'ok' });
      } finally {
        b.done();
      }
    }, { testid: 'match-sharp' })
  );
  // الحبيبات
  body.append(h('h4', { class: 'sub-h' }, icon('scan', 20), ' الحبيبات'));
  body.append(iconBtn('scan', 'حبيبات موحدة للوحة كلها', () => addGrain(app), { testid: 'grain-add' }));
  return body;
}

function shadowBody(app, l) {
  const p = l.params;
  const ps = (k, label, min, max, unit = '', testid) => propSlider(app, p, k, { label, min, max, unit, testid });
  const color = h('input', { type: 'color', value: p.color || '#000000' });
  color.addEventListener('change', () => app.edit('لون الظل', () => (p.color = color.value)));
  const body = h('div', {},
    selectBox([['contact', 'ظل التلامس'], ['cast', 'ظل مُلقى على الأرض']], p.kind, (v) => app.edit('نوع الظل', () => { p.kind = v; p.length ??= 60; p.size ??= 8; }), { label: 'النوع' }));
  if (p.kind === 'contact') body.append(ps('size', 'الحجم', 1, 40, '٪'), ps('blur', 'النعومة', 0, 60, ' بكسل'));
  else body.append(
    ps('length', 'الطول (سالب = نحو الأمام)', -150, 150, '٪', 'shadow-length'),
    ps('skew', 'الميل مع اتجاه الضوء', 0, 200, '٪'),
    ps('blur', 'النعومة عند القدمين', 0, 30, ' بكسل'),
    ps('softness', 'ازدياد النعومة مع البعد', 0, 100, '٪'),
    ps('fade', 'التلاشي مع البعد', 0, 100, '٪')
  );
  body.append(ps('offsetY', 'رفع/خفض خط الأرض', -100, 100, ' بكسل'), h('label', { class: 'field' }, h('span', {}, 'لون الظل'), color),
    h('p', { class: 'hint' }, 'الظل يتبع العنصر واتجاه الضوء تلقائيًا. غيّر الاتجاه من قرص الضوء في خصائص العنصر.'));
  return body;
}

function grainBody(app, l) {
  const p = l.params;
  return h('div', {},
    propSlider(app, p, 'amount', { label: 'الكمية', min: 0, max: 100, unit: '٪', testid: 'grain-amount' }),
    propSlider(app, p, 'size', { label: 'الحجم', min: 0.5, max: 6, step: 0.1 }),
    toggle('حبيبات أحادية اللون', p.mono, (v) => app.edit('الحبيبات', () => (p.mono = v))),
    h('p', { class: 'hint' }, 'ضع هذه الطبقة في الأعلى لتوحيد ملمس الصورة كلها.'));
}

class HarmonyTool extends MoveTool {
  constructor() {
    super();
    this.label = 'الانسجام';
  }
  options() {
    const app = this.app;
    const l = app.selected;
    if (!l || l.type !== 'image') return h('span', { class: 'hint' }, 'اختر عنصرًا (طبقة صورة) لتطبيق أدوات الانسجام عليه.');
    return h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
      iconBtn('palette', 'طابق الألوان', () => matchColor(app, l, 0.8), { testid: 'h-match' }),
      iconBtn('sun', 'إضاءة', () => app.edit('إضاءة العنصر', () => (l.fx.light = l.fx.light ? null : { strength: 45, wrap: 50 }))),
      iconBtn('footprints', 'ظل تلامس', () => addShadow(app, l, 'contact')),
      iconBtn('moon', 'ظل مُلقى', () => addShadow(app, l, 'cast')),
      iconBtn('sunMedium', 'التفاف الضوء', () => app.edit('التفاف الضوء', () => (l.fx.lightWrap = l.fx.lightWrap ? null : { width: 12, strength: 60 }))),
      iconBtn('focus', 'طابق الحدة', () => matchSharpness(app, l)),
      iconBtn('scan', 'حبيبات', () => addGrain(app)),
      iconBtn('sliders', 'كل الإعدادات', () => app.showTab('props'))
    );
  }
  onSelect() {
    this.app.emit('tool-options');
  }
}

export default {
  install({ app, toolDefs }) {
    app.registerTool('harmony', new HarmonyTool());
    toolDefs.push({ name: 'harmony', icon: 'blend', label: 'انسجام', key: 'j' });

    registerStep({
      name: 'colorMatch',
      order: 10,
      key: (l) => (l.fx?.colorMatch ? JSON.stringify([l.fx.colorMatch.strength, l.fx.colorMatch.lumOnly, l.fx.colorMatch.src.mean, l.fx.colorMatch.dst.mean]) : null),
      run(canvas, l) {
        const cm = l.fx.colorMatch;
        const img = getData(canvas);
        const out = colorTransfer(img.data, cm.src, cm.dst, cm.strength, { lumOnly: cm.lumOnly });
        const c = mk(canvas.width, canvas.height);
        ctx2d(c).putImageData(new ImageData(out, canvas.width, canvas.height), 0, 0);
        return c;
      }
    });
    registerStep({
      name: 'light',
      order: 15,
      key: (l) => (l.fx?.light && l.fx.light.strength > 0 ? JSON.stringify([l.fx.light, docLight(app.doc).angle, Math.round(l.rot * 100), Math.sign(l.sx), rasterId(l.mask), l.maskOn]) : null),
      run: (canvas, l) => applyLight(canvas, l, docLight(app.doc))
    });
    registerStep({
      name: 'blur',
      order: 60,
      key: (l) => (l.fx?.blur > 0 ? String(l.fx.blur) : null),
      run(canvas, l, ctx) {
        // نقبل القناع أولًا حتى تنعم الحافة أيضًا
        let c = canvas;
        if (l.mask && l.maskOn && !ctx.maskApplied) {
          c = mk(canvas.width, canvas.height);
          const g = ctx2d(c);
          g.drawImage(canvas, 0, 0);
          g.globalCompositeOperation = 'destination-in';
          g.drawImage(l.mask, 0, 0);
          ctx.maskApplied = true;
        }
        const r = l.fx.blur;
        const pad = Math.ceil(r * 3);
        const o = mk(c.width + pad * 2, c.height + pad * 2);
        const g = ctx2d(o);
        g.filter = `blur(${r}px)`;
        g.drawImage(c, pad, pad);
        ctx.ox -= pad;
        ctx.oy -= pad;
        return o;
      }
    });
    docSpaceEffects.push({ name: 'lightWrap', applies: (l) => l.fx?.lightWrap && l.fx.lightWrap.strength > 0, run: lightWrapEffect });
    shadowRenderer.fn = renderShadow;
    adjusters.grain = grainAdjust;

    registerSection({ id: 'harmony', title: 'الانسجام', order: 30, when: (l) => l.type === 'image', build: (l) => harmonyBody(app, l) });
    registerSection({ id: 'shadow', title: 'الظل', order: 5, when: (l) => l.type === 'shadow', build: (l) => shadowBody(app, l) });
    registerSection({ id: 'grain', title: 'الحبيبات', order: 5, when: (l) => l.type === 'adjust' && l.kind === 'grain', build: (l) => grainBody(app, l) });

    // إعادة رسم لوحة الخصائص بعد تغييرات تضيف أقسامًا
    app.on('restored', () => shadowCache.clear());
    app.on('props', () => {
      const l = app.selected;
      const sig = l && l.type === 'image' ? [!!l.fx.colorMatch, !!l.fx.light, !!l.fx.lightWrap].join() : '';
      if (sig !== this._sig) app.emit('props-refresh');
      this._sig = sig;
    });
  }
};
