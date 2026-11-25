// نموذج المستند والطبقات
import { uid } from './util.js';

export const BLEND_MODES = [
  ['normal', 'عادي'],
  ['multiply', 'ضرب (Multiply)'],
  ['screen', 'تفتيح الشاشة (Screen)'],
  ['overlay', 'تراكب (Overlay)'],
  ['soft-light', 'ضوء ناعم (Soft Light)'],
  ['hard-light', 'ضوء قوي (Hard Light)'],
  ['darken', 'تغميق'],
  ['lighten', 'تفتيح'],
  ['color-dodge', 'مراوغة اللون'],
  ['color-burn', 'حرق اللون'],
  ['difference', 'فرق'],
  ['exclusion', 'استبعاد'],
  ['hue', 'تدرّج اللون'],
  ['saturation', 'التشبع'],
  ['color', 'اللون'],
  ['luminosity', 'الإضاءة']
];

export const blendToComposite = (b) => (b === 'normal' ? 'source-over' : b);

export function defaultRefine() {
  return { radius: 0, feather: 0, contrast: 0, shift: 0, decontam: 0 };
}

export function defaultFx() {
  return {
    colorMatch: null, // { strength, stats: {src, dst} }
    light: null, // { angle, strength, softness }
    lightWrap: null, // { width, strength }
    blur: 0, // ضبابية لمطابقة البعد
    sharpen: 0
  };
}

export function createDoc({ width = 1920, height = 1080, name = 'لوحة جديدة', background = '#ffffff' } = {}) {
  return {
    id: uid('doc'),
    name,
    width,
    height,
    background, // null = شفاف
    layers: [], // من الأسفل إلى الأعلى
    selectedId: null,
    created: Date.now(),
    updated: Date.now()
  };
}

export function createImageLayer(canvas, { name = 'طبقة', x, y, doc } = {}) {
  return {
    id: uid('ly'),
    type: 'image',
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal',
    x: x ?? (doc ? doc.width / 2 : canvas.width / 2),
    y: y ?? (doc ? doc.height / 2 : canvas.height / 2),
    sx: 1,
    sy: 1,
    rot: 0,
    src: canvas, // الأصل بدقته الكاملة (طبقة ذكية) ولا يُعدَّل أبدًا
    retouch: null, // طبقة الترميم فوق الأصل
    mask: null, // قناع ألفا بحجم الأصل
    maskOn: true,
    refine: defaultRefine(),
    fx: defaultFx(),
    warp: null, // { kind: 'perspective'|'puppet', ... }
    elementId: null
  };
}

export function createGroup(name = 'مجموعة') {
  return {
    id: uid('gr'),
    type: 'group',
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal',
    open: true,
    children: []
  };
}

export function createAdjustLayer(kind, params, name) {
  return {
    id: uid('adj'),
    type: 'adjust',
    name: name || kind,
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal',
    kind,
    params,
    mask: null // قناع بحجم المستند
  };
}

export function createShadowLayer(refId, params, name = 'ظل') {
  return {
    id: uid('sh'),
    type: 'shadow',
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'multiply',
    ref: refId,
    params
  };
}

/** يبحث عن طبقة في الشجرة */
export function findLayer(doc, id, list = doc.layers, parent = null) {
  for (let i = 0; i < list.length; i++) {
    const l = list[i];
    if (l.id === id) return { layer: l, list, index: i, parent };
    if (l.type === 'group') {
      const r = findLayer(doc, id, l.children, l);
      if (r) return r;
    }
  }
  return null;
}

export function getLayer(doc, id) {
  const r = findLayer(doc, id);
  return r ? r.layer : null;
}

/** كل الطبقات بترتيب من الأعلى للأسفل للعرض في لوحة الطبقات */
export function flattenForUi(list, depth = 0, out = []) {
  for (let i = list.length - 1; i >= 0; i--) {
    const l = list[i];
    out.push({ layer: l, depth });
    if (l.type === 'group' && l.open) flattenForUi(l.children, depth + 1, out);
  }
  return out;
}

export function allLayers(list, out = []) {
  for (const l of list) {
    out.push(l);
    if (l.type === 'group') allLayers(l.children, out);
  }
  return out;
}

/** مصفوفة تحويل الطبقة: من إحداثيات الأصل إلى إحداثيات المستند */
export function layerMatrix(l) {
  const w = l.src.width;
  const h = l.src.height;
  const c = Math.cos(l.rot);
  const s = Math.sin(l.rot);
  // M = T(x,y) R S T(-w/2,-h/2)
  const a = c * l.sx;
  const b = s * l.sx;
  const cc = -s * l.sy;
  const d = c * l.sy;
  const e = l.x + a * (-w / 2) + cc * (-h / 2);
  const f = l.y + b * (-w / 2) + d * (-h / 2);
  return [a, b, cc, d, e, f];
}

export function applyMatrix(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function invertMatrix(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return [1, 0, 0, 1, 0, 0];
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
}

/** زوايا الطبقة في إحداثيات المستند */
export function layerCorners(l) {
  const m = layerMatrix(l);
  const w = l.src.width;
  const h = l.src.height;
  return [applyMatrix(m, 0, 0), applyMatrix(m, w, 0), applyMatrix(m, w, h), applyMatrix(m, 0, h)];
}

export function layerBounds(l) {
  const pts = layerCorners(l);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

export const LAYER_TYPE_LABEL = {
  image: 'صورة',
  group: 'مجموعة',
  adjust: 'تعديل',
  shadow: 'ظل'
};
