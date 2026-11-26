// التشويه: المنظور (Homography) وPuppet Warp (المربعات الصغرى المتحركة، الصلبة)

/** مصفوفة المنظور من 4 نقاط إلى 4 نقاط */
export function homography(src, dst) {
  // نحل نظام 8×8
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  if (!h) return null;
  return [...h, 1];
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/**
 * MLS الصلب (Schaefer وآخرون 2006): يحرّك نقطة v حسب الدبابيس p (الأصل) → q (الجديد)
 */
export function mlsRigid(v, P, Q, alpha = 1.5) {
  const n = P.length;
  if (!n) return v;
  if (n === 1) return [v[0] + Q[0][0] - P[0][0], v[1] + Q[0][1] - P[0][1]];
  const w = new Array(n);
  let sw = 0;
  for (let i = 0; i < n; i++) {
    const dx = P[i][0] - v[0];
    const dy = P[i][1] - v[1];
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-8) return [Q[i][0], Q[i][1]];
    w[i] = 1 / Math.pow(d2, alpha);
    sw += w[i];
  }
  let px = 0, py = 0, qx = 0, qy = 0;
  for (let i = 0; i < n; i++) {
    px += w[i] * P[i][0];
    py += w[i] * P[i][1];
    qx += w[i] * Q[i][0];
    qy += w[i] * Q[i][1];
  }
  px /= sw; py /= sw; qx /= sw; qy /= sw;
  const vx = v[0] - px;
  const vy = v[1] - py;
  // fr = Σ q̂ᵢ Aᵢ
  let frx = 0, fry = 0;
  for (let i = 0; i < n; i++) {
    const phx = P[i][0] - px, phy = P[i][1] - py;
    const qhx = Q[i][0] - qx, qhy = Q[i][1] - qy;
    // Aᵢ = wᵢ [p̂ ; −p̂⊥] [v−p* ; −(v−p*)⊥]ᵀ ، حيث (x,y)⊥ = (−y, x)
    const a11 = phx * vx + phy * vy;
    const a12 = phx * vy - phy * vx;
    const a21 = phy * vx - phx * vy;
    const a22 = phy * vy + phx * vx;
    frx += w[i] * (qhx * a11 + qhy * a21);
    fry += w[i] * (qhx * a12 + qhy * a22);
  }
  const len = Math.hypot(frx, fry) || 1;
  const vl = Math.hypot(vx, vy);
  return [(frx / len) * vl + qx, (fry / len) * vl + qy];
}

/** شبكة نقاط المصدر والوجهة لطبقة بعرض W وارتفاع H */
export function buildGrid(W, H, nx, ny, map) {
  const src = [];
  const dst = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const u = (i / nx) * W;
    const v = (j / ny) * H;
    src.push([u, v]);
    dst.push(map(u, v));
  }
  return { src, dst, nx, ny };
}

function affineFromTri(s0, s1, s2, d0, d1, d2) {
  // يحل [a c e; b d f] بحيث d = M s
  const den = s0[0] * (s1[1] - s2[1]) + s1[0] * (s2[1] - s0[1]) + s2[0] * (s0[1] - s1[1]);
  if (Math.abs(den) < 1e-9) return null;
  const a = (d0[0] * (s1[1] - s2[1]) + d1[0] * (s2[1] - s0[1]) + d2[0] * (s0[1] - s1[1])) / den;
  const c = (d0[0] * (s2[0] - s1[0]) + d1[0] * (s0[0] - s2[0]) + d2[0] * (s1[0] - s0[0])) / den;
  const e = (d0[0] * (s1[0] * s2[1] - s2[0] * s1[1]) + d1[0] * (s2[0] * s0[1] - s0[0] * s2[1]) + d2[0] * (s0[0] * s1[1] - s1[0] * s0[1])) / den;
  const b = (d0[1] * (s1[1] - s2[1]) + d1[1] * (s2[1] - s0[1]) + d2[1] * (s0[1] - s1[1])) / den;
  const d = (d0[1] * (s2[0] - s1[0]) + d1[1] * (s0[0] - s2[0]) + d2[1] * (s1[0] - s0[0])) / den;
  const f = (d0[1] * (s1[0] * s2[1] - s2[0] * s1[1]) + d1[1] * (s2[0] * s0[1] - s0[0] * s2[1]) + d2[1] * (s0[0] * s1[1] - s1[0] * s0[1])) / den;
  return [a, b, c, d, e, f];
}

/**
 * يرسم الصورة مشوّهة عبر الشبكة بمثلثات (تسريع الرسوميات في المتصفح)
 * g: سياق الهدف، img: المصدر، off: إزاحة إحداثيات المصدر داخل الصورة، to: إزاحة الهدف
 */
export function drawMesh(g, img, grid, off = [0, 0], to = [0, 0]) {
  const { src, dst, nx } = grid;
  const idx = (i, j) => j * (nx + 1) + i;
  const tri = (a, b, c) => {
    const s0 = src[a], s1 = src[b], s2 = src[c];
    const d0 = [dst[a][0] - to[0], dst[a][1] - to[1]];
    const d1 = [dst[b][0] - to[0], dst[b][1] - to[1]];
    const d2 = [dst[c][0] - to[0], dst[c][1] - to[1]];
    const m = affineFromTri([s0[0] - off[0], s0[1] - off[1]], [s1[0] - off[0], s1[1] - off[1]], [s2[0] - off[0], s2[1] - off[1]], d0, d1, d2);
    if (!m) return;
    // توسيع المثلث قليلًا لإخفاء الشقوق بين المثلثات
    const cx = (d0[0] + d1[0] + d2[0]) / 3;
    const cy = (d0[1] + d1[1] + d2[1]) / 3;
    const grow = (p) => {
      const dx = p[0] - cx, dy = p[1] - cy;
      const l = Math.hypot(dx, dy) || 1;
      return [p[0] + (dx / l) * 1.3, p[1] + (dy / l) * 1.3];
    };
    const e0 = grow(d0), e1 = grow(d1), e2 = grow(d2);
    g.save();
    g.beginPath();
    g.moveTo(e0[0], e0[1]);
    g.lineTo(e1[0], e1[1]);
    g.lineTo(e2[0], e2[1]);
    g.closePath();
    g.clip();
    g.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    g.drawImage(img, 0, 0);
    g.restore();
  };
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < nx; i++) {
    tri(idx(i, j), idx(i + 1, j), idx(i + 1, j + 1));
    tri(idx(i, j), idx(i + 1, j + 1), idx(i, j + 1));
  }
}

export function gridBounds(grid) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of grid.dst) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: Math.floor(x0) - 1, y: Math.floor(y0) - 1, w: Math.ceil(x1 - x0) + 3, h: Math.ceil(y1 - y0) + 3 };
}
