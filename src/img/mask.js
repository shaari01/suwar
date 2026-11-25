// خوارزميات القناع: تنقيح الحواف، وتنظيف لون الحافة، والتحديد بالنقر، وفرشاة الشعر
import { boxBlur, gaussBlur, luma } from './blur.js';

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function u8ToF32(a) {
  const f = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) f[i] = a[i] / 255;
  return f;
}

export function f32ToU8(f) {
  const a = new Uint8Array(f.length);
  for (let i = 0; i < f.length; i++) a[i] = Math.round(clamp01(f[i]) * 255);
  return a;
}

/** المرشح الموجَّه (He وآخرون): يلصق حواف القناع بحواف الصورة */
export function guidedFilter(I, p, w, h, r, eps = 1e-3) {
  const n = w * h;
  const Ip = new Float32Array(n);
  const II = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    Ip[i] = I[i] * p[i];
    II[i] = I[i] * I[i];
  }
  const mI = boxBlur(I, w, h, r);
  const mp = boxBlur(p, w, h, r);
  const mIp = boxBlur(Ip, w, h, r);
  const mII = boxBlur(II, w, h, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = mII[i] - mI[i] * mI[i];
    const c = mIp[i] - mI[i] * mp[i];
    a[i] = c / (v + eps);
    b[i] = mp[i] - a[i] * mI[i];
  }
  const ma = boxBlur(a, w, h, r);
  const mb = boxBlur(b, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = clamp01(ma[i] * I[i] + mb[i]);
  return q;
}

/**
 * تنقيح الحافة غير الإتلافي.
 * radius: نصف قطر الحافة الذكي (بكسل) — يلتقط التفاصيل الدقيقة قرب الحافة
 * feather: نعومة (بكسل)
 * contrast: 0..100 حدّة الانتقال
 * shift: -100..100 إزاحة الحافة للداخل (سالب) أو للخارج (موجب) بالبكسل/5
 */
export function refineAlpha(alpha, rgba, w, h, { radius = 0, feather = 0, contrast = 0, shift = 0 } = {}) {
  let a = alpha;
  const n = w * h;
  if (radius > 0) {
    const I = luma(rgba, n);
    const r = Math.max(1, Math.round(radius));
    const g = guidedFilter(I, a, w, h, r, 1e-4 * (1 + r / 4));
    // نطبق النتيجة في شريط الحافة فقط حتى لا تتأثر المناطق الواضحة
    const band = edgeBand(a, w, h, r);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = a[i] + (g[i] - a[i]) * band[i];
    a = out;
  }
  if (shift !== 0) {
    const s = Math.abs(shift) / 5;
    const b = boxBlur(a, w, h, Math.max(1, Math.round(s)));
    const out = new Float32Array(n);
    if (shift > 0) for (let i = 0; i < n; i++) out[i] = Math.max(a[i], clamp01(b[i] * 2));
    else for (let i = 0; i < n; i++) out[i] = Math.min(a[i], clamp01(b[i] * 2 - 1));
    a = out;
  }
  if (feather > 0) a = gaussBlur(a, w, h, feather);
  if (contrast > 0) {
    const k = 1 + (contrast / 100) * 12;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = clamp01((a[i] - 0.5) * k + 0.5);
    a = out;
  }
  return a;
}

/** شريط الحافة: 1 قرب حدود القناع و0 في المناطق الصريحة */
export function edgeBand(a, w, h, r) {
  const b = boxBlur(a, w, h, r);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) {
    const v = b[i];
    out[i] = clamp01(Math.min(v, 1 - v) * 4);
  }
  return out;
}

/**
 * تنظيف لون الحافة (Decontaminate): يزيل هالة لون الخلفية القديمة.
 * نقدّر لون الخلفية B ولون العنصر F قرب كل بكسل، ثم نحل I = aF + (1-a)B لاستخراج F.
 */
export function decontaminate(rgba, alpha, w, h, amount = 1, radius = 0) {
  const n = w * h;
  const R = radius || Math.max(4, Math.round(Math.max(w, h) / 60));
  const ch = (k) => {
    const c = new Float32Array(n);
    for (let i = 0, j = k; i < n; i++, j += 4) c[i] = rgba[j];
    return c;
  };
  const C = [ch(0), ch(1), ch(2)];
  const wb = new Float32Array(n);
  const wf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    wb[i] = (1 - a) * (1 - a);
    wf[i] = a > 0.9 ? 1 : 0;
  }
  const B = weightedFill(C, wb, w, h, R);
  const F = weightedFill(C, wf, w, h, R);
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = alpha[i];
    if (a <= 0.004 || a >= 0.996) continue;
    for (let k = 0; k < 3; k++) {
      const I = C[k][i];
      // الحل الرياضي مستقر حين تكون الألفا كبيرة، ولون العنصر المجاور أنسب حين تكون صغيرة
      const solved = (I - (1 - a) * B[k][i]) / Math.max(a, 0.05);
      const t = clamp01((a - 0.15) / 0.6);
      let est = solved * t + F[k][i] * (1 - t);
      est = est < 0 ? 0 : est > 255 ? 255 : est;
      out[j + k] = I + (est - I) * amount;
    }
  }
  return out;
}

/**
 * متوسط موزون محلي يتسع تدريجيًا: إن لم توجد عينات قريبة نبحث أبعد (R، 2R، 4R…)
 * يعيد لكل قناة مصفوفة بالقيمة المقدرة لكل بكسل
 */
export function weightedFill(C, wt, w, h, R) {
  const n = w * h;
  const res = C.map(() => new Float32Array(n));
  const done = new Uint8Array(n);
  let left = n;
  for (let r = R; left > 0; r *= 2) {
    const last = r >= Math.max(w, h);
    const W = boxBlur(wt, w, h, r);
    const sums = C.map((c) => {
      const p = new Float32Array(n);
      for (let i = 0; i < n; i++) p[i] = c[i] * wt[i];
      return boxBlur(p, w, h, r);
    });
    for (let i = 0; i < n; i++) {
      if (done[i]) continue;
      if (W[i] > 0.02 || (last && W[i] > 1e-6)) {
        for (let k = 0; k < C.length; k++) res[k][i] = sums[k][i] / W[i];
        done[i] = 1;
        left--;
      } else if (last) {
        for (let k = 0; k < C.length; k++) res[k][i] = C[k][i];
        done[i] = 1;
        left--;
      }
    }
    if (last) break;
  }
  return res;
}

/** المكوّن المتصل من خريطة البروز عند نقطة النقر */
export function componentAt(sal, w, h, x, y, thr = 0.5) {
  x = Math.round(x);
  y = Math.round(y);
  const out = new Float32Array(w * h);
  if (x < 0 || y < 0 || x >= w || y >= h || sal[y * w + x] < thr) return null;
  const seen = new Uint8Array(w * h);
  const stack = [y * w + x];
  seen[y * w + x] = 1;
  while (stack.length) {
    const i = stack.pop();
    out[i] = 1;
    const px = i % w;
    const py = (i / w) | 0;
    const nb = [px > 0 ? i - 1 : -1, px < w - 1 ? i + 1 : -1, py > 0 ? i - w : -1, py < h - 1 ? i + w : -1];
    for (const j of nb) {
      if (j < 0 || seen[j]) continue;
      seen[j] = 1;
      if (sal[j] >= thr) stack.push(j);
    }
  }
  // نعيد القيم الناعمة للبروز داخل المكون وحوله (توسيع بكسلين)
  const grown = boxBlur(out, w, h, 2);
  for (let i = 0; i < out.length; i++) out[i] = grown[i] > 0.01 ? Math.max(out[i] * sal[i], Math.min(sal[i], grown[i] * 2)) : 0;
  return out;
}

/** العصا السحرية: تحديد منطقة متقاربة اللون من نقطة */
export function regionGrow(rgba, w, h, x, y, tol = 32) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  const out = new Float32Array(w * h);
  const s = (y * w + x) * 4;
  const r0 = rgba[s];
  const g0 = rgba[s + 1];
  const b0 = rgba[s + 2];
  const t2 = tol * tol * 3;
  const seen = new Uint8Array(w * h);
  const stack = [y * w + x];
  seen[y * w + x] = 1;
  while (stack.length) {
    const i = stack.pop();
    out[i] = 1;
    const px = i % w;
    const py = (i / w) | 0;
    const nb = [px > 0 ? i - 1 : -1, px < w - 1 ? i + 1 : -1, py > 0 ? i - w : -1, py < h - 1 ? i + w : -1];
    for (const j of nb) {
      if (j < 0 || seen[j]) continue;
      seen[j] = 1;
      const k = j * 4;
      const dr = rgba[k] - r0;
      const dg = rgba[k + 1] - g0;
      const db = rgba[k + 2] - b0;
      if (dr * dr + dg * dg + db * db <= t2) stack.push(j);
    }
  }
  return gaussBlur(out, w, h, 0.8);
}

/**
 * فرشاة الشعر: داخل المنطقة region (0..1) نقدّر الألفا من الألوان:
 * لون العنصر المجاور F ولون الخلفية المجاور B، ثم a = إسقاط (I-B) على (F-B)
 */
export function matteRegion(rgba, alpha, region, w, h, r) {
  const n = w * h;
  const R = Math.max(3, Math.round(r));
  const fgW = new Float32Array(n);
  const bgW = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // المناطق المؤكدة خارج شريط التنقيح أو ذات قيم صريحة
    const certain = region[i] < 0.5;
    fgW[i] = alpha[i] > 0.95 && (certain || alpha[i] > 0.99) ? 1 : 0;
    bgW[i] = alpha[i] < 0.05 && (certain || alpha[i] < 0.01) ? 1 : 0;
  }
  // نستخدم المناطق المؤكدة خارج الفرشاة فقط إن وُجدت
  const Wf = boxBlur(fgW, w, h, R);
  const Wb = boxBlur(bgW, w, h, R);
  const F = [];
  const B = [];
  for (let k = 0; k < 3; k++) {
    const pf = new Float32Array(n);
    const pb = new Float32Array(n);
    for (let i = 0, j = k; i < n; i++, j += 4) {
      pf[i] = rgba[j] * fgW[i];
      pb[i] = rgba[j] * bgW[i];
    }
    F.push(boxBlur(pf, w, h, R));
    B.push(boxBlur(pb, w, h, R));
  }
  const out = Float32Array.from(alpha);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const t = region[i];
    if (t <= 0.001) continue;
    if (Wf[i] < 1e-3 || Wb[i] < 1e-3) continue;
    let num = 0;
    let den = 0;
    for (let k = 0; k < 3; k++) {
      const f = F[k][i] / Wf[i];
      const b = B[k][i] / Wb[i];
      const d = f - b;
      num += (rgba[j + k] - b) * d;
      den += d * d;
    }
    if (den < 300) continue; // لونا العنصر والخلفية متقاربان جدًا: لا يمكن الفصل بالألوان
    const est = clamp01(num / den);
    // تعزيز بسيط لتنظيف الضجيج
    const sharp = clamp01((est - 0.08) / 0.84);
    out[i] = alpha[i] + (sharp - alpha[i]) * t;
  }
  return out;
}

/** دمج قناعين: add = الأكبر، sub = طرح، replace = استبدال */
export function combineMasks(base, m, mode) {
  const out = new Float32Array(m.length);
  if (mode === 'add') for (let i = 0; i < m.length; i++) out[i] = Math.max(base ? base[i] : 0, m[i]);
  else if (mode === 'sub') for (let i = 0; i < m.length; i++) out[i] = Math.min(base ? base[i] : 1, 1 - m[i]);
  else out.set(m);
  return out;
}
