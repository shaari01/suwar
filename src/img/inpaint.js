// الملء حسب المحتوى (Content-Aware Fill): PatchMatch متعدد المقاييس مع تصويت الرقع
// المدخلات: صورة RGBA وقناع ثقب (1 = املأ هنا). المخرجات: صورة جديدة بالثقب مملوءًا.

/** ملء أولي بالانتشار (دفع-سحب) */
export function diffuseFill(rgb, hole, w, h) {
  // rgb: Float32Array(w*h*3)
  const levels = [];
  let cur = { rgb: Float32Array.from(rgb), wt: new Float32Array(w * h).map((_, i) => (hole[i] ? 0 : 1)), w, h };
  levels.push(cur);
  while (cur.w > 2 || cur.h > 2) {
    const nw = Math.max(1, cur.w >> 1);
    const nh = Math.max(1, cur.h >> 1);
    const nrgb = new Float32Array(nw * nh * 3);
    const nwt = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      let s0 = 0, s1 = 0, s2 = 0, sw = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const xx = Math.min(cur.w - 1, x * 2 + dx);
        const yy = Math.min(cur.h - 1, y * 2 + dy);
        const i = yy * cur.w + xx;
        const wv = cur.wt[i];
        s0 += cur.rgb[i * 3] * wv;
        s1 += cur.rgb[i * 3 + 1] * wv;
        s2 += cur.rgb[i * 3 + 2] * wv;
        sw += wv;
      }
      const j = y * nw + x;
      if (sw > 0) {
        nrgb[j * 3] = s0 / sw;
        nrgb[j * 3 + 1] = s1 / sw;
        nrgb[j * 3 + 2] = s2 / sw;
      }
      nwt[j] = Math.min(1, sw);
    }
    cur = { rgb: nrgb, wt: nwt, w: nw, h: nh };
    levels.push(cur);
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const a = levels[l];
    const b = levels[l + 1];
    for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
      const i = y * a.w + x;
      const t = a.wt[i];
      if (t >= 1) continue;
      const j = Math.min(b.h - 1, y >> 1) * b.w + Math.min(b.w - 1, x >> 1);
      for (let k = 0; k < 3; k++) a.rgb[i * 3 + k] = a.rgb[i * 3 + k] * t + b.rgb[j * 3 + k] * (1 - t);
      a.wt[i] = 1;
    }
  }
  return levels[0].rgb;
}

function downsample(rgb, hole, w, h) {
  const nw = Math.max(1, w >> 1);
  const nh = Math.max(1, h >> 1);
  const nrgb = new Float32Array(nw * nh * 3);
  const nhole = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    let s0 = 0, s1 = 0, s2 = 0, n = 0, anyHole = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const xx = Math.min(w - 1, x * 2 + dx);
      const yy = Math.min(h - 1, y * 2 + dy);
      const i = yy * w + xx;
      if (hole[i]) anyHole = 1;
      else {
        s0 += rgb[i * 3];
        s1 += rgb[i * 3 + 1];
        s2 += rgb[i * 3 + 2];
        n++;
      }
    }
    const j = y * nw + x;
    nhole[j] = anyHole;
    if (n) {
      nrgb[j * 3] = s0 / n;
      nrgb[j * 3 + 1] = s1 / n;
      nrgb[j * 3 + 2] = s2 / n;
    }
  }
  return { rgb: nrgb, hole: nhole, w: nw, h: nh };
}

function rand(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * تكرارات PatchMatch + التصويت على مستوى واحد
 * img: Float32 rgb (تُعدَّل قيم الثقب فقط)، hole: Uint8، R: نصف قطر الرقعة
 */
function solveLevel(img, hole, w, h, R, iters, rnd, nnfInit) {
  const n = w * h;
  // مراكز المصدر الصالحة: الرقعة كلها خارج الثقب وداخل الصورة
  const holeInt = new Int32Array((w + 1) * (h + 1)); // مجموع تكاملي للثقب
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += hole[y * w + x];
      holeInt[(y + 1) * (w + 1) + x + 1] = holeInt[y * (w + 1) + x + 1] + row;
    }
  }
  const holeSum = (x0, y0, x1, y1) => holeInt[y1 * (w + 1) + x1] - holeInt[y0 * (w + 1) + x1] - holeInt[y1 * (w + 1) + x0] + holeInt[y0 * (w + 1) + x0];
  const valid = [];
  const isValid = new Uint8Array(n);
  for (let y = R; y < h - R; y++) for (let x = R; x < w - R; x++) {
    if (holeSum(x - R, y - R, x + R + 1, y + R + 1) === 0) {
      isValid[y * w + x] = 1;
      valid.push(y * w + x);
    }
  }
  if (!valid.length) return null;
  // مراكز الهدف: كل بكسل ضمن R من الثقب
  const targets = [];
  const isTarget = new Int32Array(n).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - R), y0 = Math.max(0, y - R), x1 = Math.min(w, x + R + 1), y1 = Math.min(h, y + R + 1);
    if (holeSum(x0, y0, x1, y1) > 0) {
      isTarget[y * w + x] = targets.length;
      targets.push(y * w + x);
    }
  }
  const T = targets.length;
  const nnf = new Int32Array(T);
  const cost = new Float32Array(T);
  const dist = (p, q, best) => {
    const px = p % w, py = (p / w) | 0, qx = q % w, qy = (q / w) | 0;
    let d = 0;
    for (let dy = -R; dy <= R; dy++) {
      const yy = py + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -R; dx <= R; dx++) {
        const xx = px + dx;
        if (xx < 0 || xx >= w) continue;
        const i = (yy * w + xx) * 3;
        const j = ((qy + dy) * w + qx + dx) * 3;
        const a = img[i] - img[j], b = img[i + 1] - img[j + 1], c = img[i + 2] - img[j + 2];
        d += a * a + b * b + c * c;
        if (d > best) return d;
      }
    }
    return d;
  };
  for (let t = 0; t < T; t++) {
    let q = nnfInit ? nnfInit(targets[t]) : -1;
    if (q < 0 || !isValid[q]) q = valid[(rnd() * valid.length) | 0];
    nnf[t] = q;
    cost[t] = dist(targets[t], q, Infinity);
  }
  const acc = new Float32Array(n * 3);
  const wsum = new Float32Array(n);
  for (let it = 0; it < iters; it++) {
    const fwd = it % 2 === 0;
    for (let k = 0; k < T; k++) {
      const t = fwd ? k : T - 1 - k;
      const p = targets[t];
      const px = p % w, py = (p / w) | 0;
      const step = fwd ? -1 : 1;
      // انتشار من الجيران
      for (const [nx, ny] of [[px + step, py], [px, py + step]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nt = isTarget[ny * w + nx];
        if (nt < 0) continue;
        const q = nnf[nt] - step * (nx !== px ? 1 : w);
        if (q < 0 || q >= n || !isValid[q]) continue;
        const d = dist(p, q, cost[t]);
        if (d < cost[t]) {
          cost[t] = d;
          nnf[t] = q;
        }
      }
      // بحث عشوائي بنصف قطر متناقص
      let rad = Math.max(w, h);
      const q0 = nnf[t];
      const qx0 = q0 % w, qy0 = (q0 / w) | 0;
      while (rad >= 1) {
        const qx = Math.round(qx0 + (rnd() * 2 - 1) * rad);
        const qy = Math.round(qy0 + (rnd() * 2 - 1) * rad);
        if (qx >= 0 && qy >= 0 && qx < w && qy < h) {
          const q = qy * w + qx;
          if (isValid[q]) {
            const d = dist(p, q, cost[t]);
            if (d < cost[t]) {
              cost[t] = d;
              nnf[t] = q;
            }
          }
        }
        rad >>= 1;
      }
    }
    // التصويت
    acc.fill(0);
    wsum.fill(0);
    const patchN = (2 * R + 1) * (2 * R + 1);
    for (let t = 0; t < T; t++) {
      const p = targets[t];
      const q = nnf[t];
      const px = p % w, py = (p / w) | 0, qx = q % w, qy = (q / w) | 0;
      const wt = Math.exp(-cost[t] / (patchN * 2 * 30 * 30)) + 1e-6;
      for (let dy = -R; dy <= R; dy++) {
        const yy = py + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xx = px + dx;
          if (xx < 0 || xx >= w) continue;
          const i = yy * w + xx;
          if (!hole[i]) continue;
          const j = ((qy + dy) * w + qx + dx) * 3;
          acc[i * 3] += img[j] * wt;
          acc[i * 3 + 1] += img[j + 1] * wt;
          acc[i * 3 + 2] += img[j + 2] * wt;
          wsum[i] += wt;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (!hole[i] || wsum[i] === 0) continue;
      img[i * 3] = acc[i * 3] / wsum[i];
      img[i * 3 + 1] = acc[i * 3 + 1] / wsum[i];
      img[i * 3 + 2] = acc[i * 3 + 2] / wsum[i];
    }
  }
  return { nnf, targets };
}

/**
 * الملء حسب المحتوى
 * rgba: Uint8ClampedArray، hole: Uint8Array (1 = ثقب)
 */
export function inpaint(rgba, hole, w, h, { patch = 3, seed = 1 } = {}) {
  const n = w * h;
  let any = false;
  for (let i = 0; i < n; i++) if (hole[i]) { any = true; break; }
  const out = new Uint8ClampedArray(rgba);
  if (!any) return out;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = rgba[i * 4];
    rgb[i * 3 + 1] = rgba[i * 4 + 1];
    rgb[i * 3 + 2] = rgba[i * 4 + 2];
  }
  // الهرم
  const pyr = [{ rgb, hole, w, h }];
  while (true) {
    const top = pyr[pyr.length - 1];
    if (Math.min(top.w, top.h) < 4 * (2 * patch + 1)) break;
    let holePx = 0;
    for (let i = 0; i < top.hole.length; i++) holePx += top.hole[i];
    if (holePx < 64) break;
    pyr.push(downsample(top.rgb, top.hole, top.w, top.h));
  }
  const rnd = rand(seed * 7919);
  // أخشن مستوى: انتشار
  const L = pyr.length - 1;
  let cur = pyr[L];
  let img = diffuseFill(cur.rgb, cur.hole, cur.w, cur.h);
  let prev = null;
  for (let l = L; l >= 0; l--) {
    cur = pyr[l];
    if (l < L) {
      // تكبير النتيجة السابقة إلى هذا المستوى (داخل الثقب فقط)
      const p = pyr[l + 1];
      img = Float32Array.from(cur.rgb);
      for (let y = 0; y < cur.h; y++) for (let x = 0; x < cur.w; x++) {
        const i = y * cur.w + x;
        if (!cur.hole[i]) continue;
        const j = Math.min(p.h - 1, y >> 1) * p.w + Math.min(p.w - 1, x >> 1);
        img[i * 3] = prevImg[j * 3];
        img[i * 3 + 1] = prevImg[j * 3 + 1];
        img[i * 3 + 2] = prevImg[j * 3 + 2];
      }
    }
    const iters = l === 0 ? 3 : l === L ? 6 : 4;
    const pw = cur.w;
    const prevRes = prev;
    const init = prevRes
      ? (pt) => {
          const x = pt % pw, y = (pt / pw) | 0;
          const pp = pyr[l + 1];
          const t = prevRes.map.get(Math.min(pp.h - 1, y >> 1) * pp.w + Math.min(pp.w - 1, x >> 1));
          if (t === undefined) return -1;
          const q = prevRes.nnf[t];
          const qx = (q % pp.w) * 2 + (x & 1), qy = ((q / pp.w) | 0) * 2 + (y & 1);
          return qx < cur.w && qy < cur.h ? qy * cur.w + qx : -1;
        }
      : null;
    const r = solveLevel(img, cur.hole, cur.w, cur.h, patch, iters, rnd, init);
    if (r) {
      const map = new Map();
      r.targets.forEach((p, t) => map.set(p, t));
      prev = { nnf: r.nnf, map };
    } else prev = null;
    var prevImg = img;
  }
  for (let i = 0; i < n; i++) {
    if (!hole[i]) continue;
    out[i * 4] = img[i * 3];
    out[i * 4 + 1] = img[i * 3 + 1];
    out[i * 4 + 2] = img[i * 3 + 2];
    out[i * 4 + 3] = Math.max(out[i * 4 + 3], 255);
  }
  return out;
}

/**
 * يعمل داخل مستطيل حول الثقب فقط (أسرع بكثير للصور الكبيرة)
 */
export function inpaintRegion(rgba, hole, w, h, opts = {}) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (hole[y * w + x]) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return { data: new Uint8ClampedArray(rgba), box: null };
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const m = Math.max(24, Math.round(Math.max(bw, bh) * (opts.context ?? 1.5)));
  const X0 = Math.max(0, x0 - m), Y0 = Math.max(0, y0 - m);
  const X1 = Math.min(w, x1 + 1 + m), Y1 = Math.min(h, y1 + 1 + m);
  const W = X1 - X0, H = Y1 - Y0;
  const sub = new Uint8ClampedArray(W * H * 4);
  const subHole = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    sub.set(rgba.subarray(((Y0 + y) * w + X0) * 4, ((Y0 + y) * w + X1) * 4), y * W * 4);
    subHole.set(hole.subarray((Y0 + y) * w + X0, (Y0 + y) * w + X1), y * W);
  }
  // البكسلات الشفافة لا تصلح مصدرًا: نعاملها كثقب في المصدر فقط
  const filled = inpaint(sub, subHole, W, H, opts);
  const out = new Uint8ClampedArray(rgba);
  for (let y = 0; y < H; y++) out.set(filled.subarray(y * W * 4, (y + 1) * W * 4), ((Y0 + y) * w + X0) * 4);
  return { data: out, box: { x: X0, y: Y0, w: W, h: H } };
}
