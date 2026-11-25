// ضبابية سريعة بزمن ثابت مهما كبر نصف القطر (مجموع متحرك)

/** ضبابية صندوقية لقناة واحدة Float32 */
export function boxBlur(src, w, h, r, out) {
  r = Math.max(0, Math.round(r));
  const dst = out || new Float32Array(w * h);
  if (r === 0) {
    dst.set(src);
    return dst;
  }
  const tmp = new Float32Array(w * h);
  // أفقي
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / (2 * r + 1);
      const xa = Math.min(w - 1, x + r + 1);
      const xs = Math.max(0, x - r);
      acc += src[row + xa] - src[row + xs];
    }
  }
  // عمودي
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc / (2 * r + 1);
      const ya = Math.min(h - 1, y + r + 1);
      const ys = Math.max(0, y - r);
      acc += tmp[ya * w + x] - tmp[ys * w + x];
    }
  }
  return dst;
}

/** تقريب غاوسي بثلاث تمريرات صندوقية */
export function gaussBlur(src, w, h, sigma) {
  if (sigma <= 0.3) return Float32Array.from(src);
  const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2));
  let a = boxBlur(src, w, h, r);
  a = boxBlur(a, w, h, r);
  return boxBlur(a, w, h, r);
}

/** ضبابية لصورة RGBA كاملة (Uint8ClampedArray) */
export function blurRGBA(data, w, h, sigma) {
  const n = w * h;
  const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  // نضرب في الألفا لتفادي الهالات الداكنة
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = data[j + 3] / 255;
    ch[0][i] = data[j] * a;
    ch[1][i] = data[j + 1] * a;
    ch[2][i] = data[j + 2] * a;
    ch[3][i] = a;
  }
  const b = ch.map((c) => gaussBlur(c, w, h, sigma));
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = b[3][i];
    if (a > 1e-4) {
      out[j] = b[0][i] / a;
      out[j + 1] = b[1][i] / a;
      out[j + 2] = b[2][i] / a;
    }
    out[j + 3] = a * 255;
  }
  return out;
}

export function luma(data, n) {
  const L = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) L[i] = (0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]) / 255;
  return L;
}
