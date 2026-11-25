// واجهة القص بالذكاء الاصطناعي: تشغيل النموذج وتكبير النتيجة ولصقها بحواف الصورة
import { mk, getData } from '../core/canvas.js';
import { guidedFilter, clamp01 } from '../img/mask.js';
import { luma, gaussBlur } from '../img/blur.js';
import { rasterId } from '../core/util.js';

const SIZE = 320;
let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./segment.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.res(e.data);
    else p.rej(new Error(e.data.error));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.rej(new Error(e.message || 'خطأ في عامل الذكاء الاصطناعي'));
    pending.clear();
  };
  return worker;
}

function call(msg, transfer) {
  const id = ++seq;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    getWorker().postMessage({ ...msg, id, base: new URL(import.meta.env.BASE_URL, location.href).href }, transfer || []);
  });
}

export function warmup() {
  return call({ type: 'warmup' }).catch(() => {});
}

const salCache = new WeakMap(); // canvas -> { sal, w, h }

/** خريطة البروز بحجم الصورة الأصلية (0..1) */
export async function saliency(canvas) {
  const hit = salCache.get(canvas);
  if (hit) return hit;
  const small = mk(SIZE, SIZE);
  const g = small.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(canvas, 0, 0, SIZE, SIZE);
  const data = g.getImageData(0, 0, SIZE, SIZE).data;
  const r = await call({ type: 'run', data, size: SIZE });
  // تكبير بالاستيفاء عبر لوحة رمادية
  const sc = mk(SIZE, SIZE);
  const img = new ImageData(SIZE, SIZE);
  for (let i = 0, j = 0; i < r.sal.length; i++, j += 4) {
    const v = Math.round(r.sal[i] * 255);
    img.data[j] = img.data[j + 1] = img.data[j + 2] = v;
    img.data[j + 3] = 255;
  }
  sc.getContext('2d').putImageData(img, 0, 0);
  const W = canvas.width;
  const H = canvas.height;
  const big = mk(W, H);
  const bg = big.getContext('2d', { willReadFrequently: true });
  bg.imageSmoothingQuality = 'high';
  bg.drawImage(sc, 0, 0, W, H);
  const bd = bg.getImageData(0, 0, W, H).data;
  const sal = new Float32Array(W * H);
  for (let i = 0, j = 0; i < sal.length; i++, j += 4) sal[i] = bd[j] / 255;
  const out = { sal, w: W, h: H };
  salCache.set(canvas, out);
  return out;
}

/**
 * «اختر العنصر الرئيسي»: قناع العنصر بحجم الصورة، بحواف ملتصقة بالتفاصيل
 */
export async function selectSubject(canvas) {
  const { sal, w, h } = await saliency(canvas);
  const rgba = getData(canvas).data;
  const I = luma(rgba, w * h);
  // تنعيم بسيط للنتيجة المكبرة ثم المرشح الموجه لالتقاط الحواف الدقيقة
  const base = gaussBlur(sal, w, h, Math.max(0.5, Math.max(w, h) / 900));
  const r = Math.max(2, Math.round(Math.max(w, h) / 160));
  const g = guidedFilter(I, base, w, h, r, 1e-3);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) {
    // تقوية التباين: إزالة الضباب الخفيف في الخلفية
    out[i] = clamp01((g[i] - 0.12) / 0.76);
  }
  return out;
}

export { SIZE as MODEL_SIZE, rasterId };
