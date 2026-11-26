// التعديلات اللونية: أساسية، وCurves، وLevels، وتوازن اللون، والتدرج/التشبع، وLUT ثلاثي الأبعاد
import { rgb2lab } from './color.js';

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// ---------- Curves ----------
/** منحنى مكعب رتيب (Fritsch–Carlson) عبر النقاط [[x,y]...] بقيم 0..255 → جدول 256 */
export function curveLUT(points) {
  const pts = [...points].map(([x, y]) => [clamp255(x), clamp255(y)]).sort((a, b) => a[0] - b[0]);
  const lut = new Uint8ClampedArray(256);
  if (pts.length < 2) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  const n = pts.length;
  const dx = [];
  const m = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(Math.max(1e-6, pts[i + 1][0] - pts[i][0]));
    m.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const t = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  for (let x = 0; x < 256; x++) {
    if (x <= pts[0][0]) {
      lut[x] = pts[0][1];
      continue;
    }
    if (x >= pts[n - 1][0]) {
      lut[x] = pts[n - 1][1];
      continue;
    }
    let i = 0;
    while (x > pts[i + 1][0]) i++;
    const h = dx[i];
    const s = (x - pts[i][0]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    const y = (2 * s3 - 3 * s2 + 1) * pts[i][1] + (s3 - 2 * s2 + s) * h * t[i] + (-2 * s3 + 3 * s2) * pts[i + 1][1] + (s3 - s2) * h * t[i + 1];
    lut[x] = clamp255(Math.round(y));
  }
  return lut;
}

export const IDENTITY_CURVE = [[0, 0], [255, 255]];

export function applyCurves(rgba, p) {
  const all = curveLUT(p.rgb || IDENTITY_CURVE);
  const L = ['r', 'g', 'b'].map((k) => {
    const c = curveLUT(p[k] || IDENTITY_CURVE);
    const out = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) out[i] = c[all[i]];
    return out;
  });
  for (let j = 0; j < rgba.length; j += 4) {
    rgba[j] = L[0][rgba[j]];
    rgba[j + 1] = L[1][rgba[j + 1]];
    rgba[j + 2] = L[2][rgba[j + 2]];
  }
  return rgba;
}

// ---------- Levels ----------
export function levelsLUT({ inBlack = 0, inWhite = 255, gamma = 1, outBlack = 0, outWhite = 255 } = {}) {
  const lut = new Uint8ClampedArray(256);
  const range = Math.max(1, inWhite - inBlack);
  for (let i = 0; i < 256; i++) {
    let v = (i - inBlack) / range;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    v = Math.pow(v, 1 / Math.max(0.01, gamma));
    lut[i] = Math.round(outBlack + v * (outWhite - outBlack));
  }
  return lut;
}

export function applyLevels(rgba, p) {
  const all = levelsLUT(p.rgb || {});
  const L = ['r', 'g', 'b'].map((k) => {
    const c = levelsLUT(p[k] || {});
    const out = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) out[i] = c[all[i]];
    return out;
  });
  for (let j = 0; j < rgba.length; j += 4) {
    rgba[j] = L[0][rgba[j]];
    rgba[j + 1] = L[1][rgba[j + 1]];
    rgba[j + 2] = L[2][rgba[j + 2]];
  }
  return rgba;
}

// ---------- التعديلات الأساسية ----------
/**
 * p: { exposure(-100..100), brightness, contrast, highlights, shadows, temperature, tint, saturation, vibrance } كلها -100..100
 */
export function applyBasic(rgba, p) {
  const ex = Math.pow(2, (p.exposure || 0) / 50);
  const br = (p.brightness || 0) * 1.2;
  const ct = 1 + (p.contrast || 0) / 100;
  const hi = (p.highlights || 0) / 100;
  const sh = (p.shadows || 0) / 100;
  const temp = (p.temperature || 0) / 100;
  const tint = (p.tint || 0) / 100;
  const sat = 1 + (p.saturation || 0) / 100;
  const vib = (p.vibrance || 0) / 100;
  // جدول للإضاءة: تعريض ثم سطوع ثم تباين ثم ظلال/إضاءات
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    let v = (i / 255) * ex + br / 255;
    v = (v - 0.5) * ct + 0.5;
    // الظلال ترفع المناطق الداكنة، والإضاءات تخفض المناطق الفاتحة
    const ws = Math.pow(1 - Math.min(1, Math.max(0, v)), 2);
    const wh = Math.pow(Math.min(1, Math.max(0, v)), 2);
    v += sh * ws * 0.5 + hi * wh * 0.5;
    lut[i] = v * 255;
  }
  const rMul = 1 + temp * 0.18 + tint * 0.06;
  const gMul = 1 - tint * 0.12;
  const bMul = 1 - temp * 0.18 + tint * 0.06;
  for (let j = 0; j < rgba.length; j += 4) {
    let r = lut[rgba[j]] * rMul;
    let g = lut[rgba[j + 1]] * gMul;
    let b = lut[rgba[j + 2]] * bMul;
    if (sat !== 1 || vib) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const curSat = mx > 0 ? (mx - mn) / mx : 0;
      const k = sat * (1 + vib * (1 - curSat));
      r = l + (r - l) * k;
      g = l + (g - l) * k;
      b = l + (b - l) * k;
    }
    rgba[j] = clamp255(r);
    rgba[j + 1] = clamp255(g);
    rgba[j + 2] = clamp255(b);
  }
  return rgba;
}

// ---------- توازن اللون ----------
/** p: { shadows:[cr,mg,yb], midtones:[..], highlights:[..] } قيم -100..100 */
export function applyColorBalance(rgba, p) {
  const zones = ['shadows', 'midtones', 'highlights'];
  for (let j = 0; j < rgba.length; j += 4) {
    const l = (0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) / 255;
    const w = [Math.max(0, 1 - l * 2.5), Math.max(0, 1 - Math.abs(l - 0.5) * 2.5), Math.max(0, (l - 0.6) * 2.5)];
    let dr = 0, dg = 0, db = 0;
    for (let z = 0; z < 3; z++) {
      const v = p[zones[z]];
      if (!v) continue;
      dr += v[0] * w[z];
      dg += v[1] * w[z];
      db += v[2] * w[z];
    }
    rgba[j] = clamp255(rgba[j] + dr * 0.6);
    rgba[j + 1] = clamp255(rgba[j + 1] + dg * 0.6);
    rgba[j + 2] = clamp255(rgba[j + 2] + db * 0.6);
  }
  return rgba;
}

// ---------- التدرج والتشبع ----------
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hsl2rgb(h, s, l) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}

export function applyHSL(rgba, p) {
  const dh = (p.hue || 0) / 360;
  const ds = (p.saturation || 0) / 100;
  const dl = (p.lightness || 0) / 100;
  for (let j = 0; j < rgba.length; j += 4) {
    let [h, s, l] = rgb2hsl(rgba[j], rgba[j + 1], rgba[j + 2]);
    h = (h + dh + 1) % 1;
    s = ds >= 0 ? s + (1 - s) * ds : s * (1 + ds);
    l = dl >= 0 ? l + (1 - l) * dl : l * (1 + dl);
    const c = hsl2rgb(h, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l)));
    rgba[j] = c[0];
    rgba[j + 1] = c[1];
    rgba[j + 2] = c[2];
  }
  return rgba;
}

// ---------- LUT ----------
/** قراءة ملف .cube */
export function parseCube(text) {
  let size = 0;
  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];
  const vals = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const k = parts[0].toUpperCase();
    if (k === 'TITLE') continue;
    if (k === 'LUT_3D_SIZE') size = parseInt(parts[1], 10);
    else if (k === 'LUT_1D_SIZE') throw new Error('ملفات LUT أحادية البعد غير مدعومة بعد');
    else if (k === 'DOMAIN_MIN') domainMin = parts.slice(1, 4).map(Number);
    else if (k === 'DOMAIN_MAX') domainMax = parts.slice(1, 4).map(Number);
    else if (/^[-+0-9.eE]/.test(parts[0]) && parts.length >= 3) vals.push(+parts[0], +parts[1], +parts[2]);
  }
  if (!size || vals.length < size * size * size * 3) throw new Error('ملف LUT غير صالح');
  return { size, data: Float32Array.from(vals.slice(0, size * size * size * 3)), domainMin, domainMax };
}

/** تطبيق LUT ثلاثي الأبعاد باستيفاء ثلاثي الخطية. في .cube يتغير الأحمر أسرع */
export function applyLUT3D(rgba, lut, intensity = 1) {
  const N = lut.size;
  const d = lut.data;
  const idx = (r, g, b) => (r + g * N + b * N * N) * 3;
  const out = [0, 0, 0];
  for (let j = 0; j < rgba.length; j += 4) {
    const fr = ((rgba[j] / 255 - lut.domainMin[0]) / (lut.domainMax[0] - lut.domainMin[0])) * (N - 1);
    const fg = ((rgba[j + 1] / 255 - lut.domainMin[1]) / (lut.domainMax[1] - lut.domainMin[1])) * (N - 1);
    const fb = ((rgba[j + 2] / 255 - lut.domainMin[2]) / (lut.domainMax[2] - lut.domainMin[2])) * (N - 1);
    const r0 = Math.max(0, Math.min(N - 1, Math.floor(fr)));
    const g0 = Math.max(0, Math.min(N - 1, Math.floor(fg)));
    const b0 = Math.max(0, Math.min(N - 1, Math.floor(fb)));
    const r1 = Math.min(N - 1, r0 + 1), g1 = Math.min(N - 1, g0 + 1), b1 = Math.min(N - 1, b0 + 1);
    const tr = fr - r0, tg = fg - g0, tb = fb - b0;
    for (let k = 0; k < 3; k++) {
      const c00 = d[idx(r0, g0, b0) + k] * (1 - tr) + d[idx(r1, g0, b0) + k] * tr;
      const c10 = d[idx(r0, g1, b0) + k] * (1 - tr) + d[idx(r1, g1, b0) + k] * tr;
      const c01 = d[idx(r0, g0, b1) + k] * (1 - tr) + d[idx(r1, g0, b1) + k] * tr;
      const c11 = d[idx(r0, g1, b1) + k] * (1 - tr) + d[idx(r1, g1, b1) + k] * tr;
      const c0 = c00 * (1 - tg) + c10 * tg;
      const c1 = c01 * (1 - tg) + c11 * tg;
      out[k] = (c0 * (1 - tb) + c1 * tb) * 255;
    }
    rgba[j] = clamp255(rgba[j] + (out[0] - rgba[j]) * intensity);
    rgba[j + 1] = clamp255(rgba[j + 1] + (out[1] - rgba[j + 1]) * intensity);
    rgba[j + 2] = clamp255(rgba[j + 2] + (out[2] - rgba[j + 2]) * intensity);
  }
  return rgba;
}

/** مدرج تكراري للإضاءة والقنوات */
export function histogram(rgba) {
  const H = { l: new Uint32Array(256), r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256) };
  for (let j = 0; j < rgba.length; j += 4) {
    if (rgba[j + 3] < 8) continue;
    H.r[rgba[j]]++;
    H.g[rgba[j + 1]]++;
    H.b[rgba[j + 2]]++;
    H.l[Math.round(0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2])]++;
  }
  return H;
}

export { rgb2lab };
