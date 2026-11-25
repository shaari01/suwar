// أدوات عامة صغيرة

let counter = 0;
export function uid(prefix = 'id') {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function debounce(fn, ms) {
  let t = null;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return d;
}

/** هل القيمة لوحة رسم (canvas) أو صورة نقطية؟ */
export function isRaster(v) {
  if (!v || typeof v !== 'object') return false;
  if (typeof HTMLCanvasElement !== 'undefined' && v instanceof HTMLCanvasElement) return true;
  if (typeof OffscreenCanvas !== 'undefined' && v instanceof OffscreenCanvas) return true;
  if (typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap) return true;
  return !!v.__raster; // لاختبارات node
}

/** نسخ عميق للكائنات العادية مع إبقاء مراجع اللوحات كما هي (اللوحات لا تُعدَّل في مكانها أبدًا) */
export function deepCloneKeepRasters(v) {
  if (v === null || typeof v !== 'object') return v;
  if (isRaster(v)) return v;
  if (v instanceof Float32Array || v instanceof Uint8Array || v instanceof Uint8ClampedArray) return v;
  if (Array.isArray(v)) return v.map(deepCloneKeepRasters);
  const o = {};
  for (const k of Object.keys(v)) o[k] = deepCloneKeepRasters(v[k]);
  return o;
}

/** هوية ثابتة لكل لوحة رسم لاستخدامها في مفاتيح التخزين المؤقت */
const rasterIds = new WeakMap();
let rasterCounter = 0;
export function rasterId(r) {
  if (!r) return 0;
  let id = rasterIds.get(r);
  if (!id) {
    id = ++rasterCounter;
    rasterIds.set(r, id);
  }
  return id;
}

export function formatBytes(n) {
  if (n < 1024) return n + ' بايت';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' ك.ب';
  return (n / 1024 / 1024).toFixed(1) + ' م.ب';
}

export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
