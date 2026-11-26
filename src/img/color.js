// تحويلات الألوان ومطابقتها (طريقة Reinhard في فضاء Lab)

const srgbToLin = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  srgbToLin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const linToSrgb = (c) => {
  c = c <= 0 ? 0 : c >= 1 ? 1 : c;
  return (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255;
};
const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
const finv = (t) => (t > 0.206893 ? t * t * t : (t - 16 / 116) / 7.787);

export function rgb2lab(r, g, b, out = [0, 0, 0]) {
  const R = srgbToLin[r];
  const G = srgbToLin[g];
  const B = srgbToLin[b];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  out[0] = 116 * fy - 16;
  out[1] = 500 * (fx - fy);
  out[2] = 200 * (fy - fz);
  return out;
}

export function lab2rgb(L, a, b, out = [0, 0, 0]) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const X = finv(fx) * 0.95047;
  const Y = finv(fy);
  const Z = finv(fz) * 1.08883;
  const R = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  const G = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  const B = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  out[0] = linToSrgb(R);
  out[1] = linToSrgb(G);
  out[2] = linToSrgb(B);
  return out;
}

/** متوسط وانحراف Lab للبكسلات المرئية (ألفا > 50٪) */
export function labStats(rgba, alpha) {
  const s = [0, 0, 0];
  const s2 = [0, 0, 0];
  let n = 0;
  const lab = [0, 0, 0];
  for (let i = 0, j = 0; j < rgba.length; i++, j += 4) {
    const a = alpha ? alpha[i] : rgba[j + 3] / 255;
    if (a < 0.5) continue;
    rgb2lab(rgba[j], rgba[j + 1], rgba[j + 2], lab);
    for (let k = 0; k < 3; k++) {
      s[k] += lab[k];
      s2[k] += lab[k] * lab[k];
    }
    n++;
  }
  if (!n) return null;
  const mean = s.map((v) => v / n);
  const std = s2.map((v, k) => Math.sqrt(Math.max(1e-6, v / n - mean[k] * mean[k])));
  return { mean, std, n };
}

/**
 * نقل الألوان: يحرك توزيع ألوان العنصر نحو توزيع الخلفية.
 * strength 0..1، lumOnly: الإضاءة فقط
 */
export function colorTransfer(rgba, src, dst, strength = 1, { lumOnly = false } = {}) {
  const out = new Uint8ClampedArray(rgba.length);
  const lab = [0, 0, 0];
  const rgb = [0, 0, 0];
  // نحد من التمدد المبالغ فيه حين يكون انحراف المصدر صغيرًا جدًا
  const ratio = src.std.map((s, k) => Math.min(2.5, Math.max(0.4, dst.std[k] / Math.max(1e-3, s))));
  for (let j = 0; j < rgba.length; j += 4) {
    out[j + 3] = rgba[j + 3];
    if (rgba[j + 3] === 0) continue;
    rgb2lab(rgba[j], rgba[j + 1], rgba[j + 2], lab);
    for (let k = 0; k < 3; k++) {
      if (lumOnly && k > 0) continue;
      const t = (lab[k] - src.mean[k]) * ratio[k] + dst.mean[k];
      lab[k] = lab[k] + (t - lab[k]) * strength;
    }
    lab2rgb(lab[0], lab[1], lab[2], rgb);
    out[j] = rgb[0];
    out[j + 1] = rgb[1];
    out[j + 2] = rgb[2];
  }
  return out;
}

/** تقدير الحدة: تباين لابلاس على الإضاءة للبكسلات المرئية */
export function sharpness(rgba, w, h) {
  let s = 0;
  let s2 = 0;
  let n = 0;
  const L = (i) => 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (rgba[i + 3] < 250 || rgba[i - 4 + 3] < 250 || rgba[i + 4 + 3] < 250 || rgba[i - w * 4 + 3] < 250 || rgba[i + w * 4 + 3] < 250) continue;
      const v = 4 * L(i) - L(i - 4) - L(i + 4) - L(i - w * 4) - L(i + w * 4);
      s += v;
      s2 += v * v;
      n++;
    }
  }
  if (n < 50) return null;
  const m = s / n;
  return s2 / n - m * m;
}
