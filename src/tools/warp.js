// أداة التشويه: المنظور والتشويه الحر (4 زوايا)، وPuppet Warp (دبابيس لثني العنصر)
import { h, iconBtn, toast } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { layerMatrix, invertMatrix, applyMatrix } from '../core/doc.js';
import { mk, ctx2d } from '../core/canvas.js';
import { homography, applyH, mlsRigid, buildGrid, drawMesh, gridBounds } from '../img/warp.js';

const HANDLE = 24;

export function warpGrid(l, rect) {
  const w = l.warp;
  const W = l.src.width;
  const H = l.src.height;
  const r = rect || { x: 0, y: 0, w: W, h: H };
  const grid = (nx, ny, map) => {
    const g = buildGrid(r.w, r.h, nx, ny, (u, v) => map(u + r.x, v + r.y));
    g.src = g.src.map(([u, v]) => [u + r.x, v + r.y]);
    return g;
  };
  if (w.kind === 'perspective') {
    const Hm = homography([[0, 0], [W, 0], [W, H], [0, H]], w.pts);
    if (!Hm) return null;
    return grid(14, 14, (u, v) => applyH(Hm, u, v));
  }
  if (w.kind === 'puppet' && w.pins.length) {
    const P = w.pins.map((p) => [p.u, p.v]);
    const Q = w.pins.map((p) => [p.x, p.y]);
    const n = Math.max(8, Math.min(32, Math.round(Math.max(r.w, r.h) / 40)));
    return grid(n, n, (u, v) => mlsRigid([u, v], P, Q));
  }
  return null;
}

/** خطوة العرض: ترسم الطبقة مشوّهة */
export function warpStep() {
  return {
    name: 'warp',
    order: 70,
    key: (l) => (l.warp && (l.warp.kind === 'perspective' || l.warp.pins?.length) ? JSON.stringify(l.warp) : null),
    run(canvas, l, ctx) {
      let c = canvas;
      if (l.mask && l.maskOn && !ctx.maskApplied) {
        c = mk(canvas.width, canvas.height);
        const g = ctx2d(c);
        g.drawImage(canvas, 0, 0);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(l.mask, 0, 0);
        ctx.maskApplied = true;
      }
      const grid = warpGrid(l, { x: ctx.ox, y: ctx.oy, w: c.width, h: c.height });
      if (!grid) return c;
      const b = gridBounds(grid);
      // حد أعلى للحجم حتى لا ينهار المتصفح عند منظور متطرف
      const maxSide = 8000;
      if (b.w > maxSide || b.h > maxSide) return c;
      const out = mk(b.w, b.h);
      drawMesh(ctx2d(out), c, grid, [ctx.ox, ctx.oy], [b.x, b.y]);
      ctx.ox = b.x;
      ctx.oy = b.y;
      return out;
    }
  };
}

export class WarpTool {
  constructor() {
    this.label = 'التشويه';
    this.mode = 'perspective';
    this.drag = null;
    this.selPin = -1;
  }

  get layer() {
    const l = this.app.selected;
    return l && l.type === 'image' ? l : null;
  }

  onSelect() {
    this.selPin = -1;
    this.app.emit('tool-options');
  }

  options() {
    const app = this.app;
    const l = this.layer;
    if (!l) return h('span', { class: 'hint' }, 'اختر طبقة صورة لتشويهها.');
    const seg = h('div', { class: 'segmented', 'data-testid': 'warp-mode' },
      [['perspective', 'منظور وتشويه حر', 'boxSelect'], ['puppet', 'دبابيس (Puppet)', 'pin']].map(([v, t, ic]) =>
        h('button', { type: 'button', class: v === this.mode ? 'on' : '', 'data-v': v, onclick: () => this.setMode(v) }, icon(ic, 22), t)));
    return h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
      seg,
      h('span', { class: 'hint' }, this.mode === 'perspective' ? 'اسحب الزوايا الأربع' : 'المس العنصر لوضع دبوس، ثم اسحب الدبوس لثنيه. ضع دبوسين أو أكثر.'),
      this.mode === 'puppet' ? iconBtn('trash', 'حذف الدبوس', () => this.deletePin(), { testid: 'pin-del' }) : null,
      iconBtn('reset', 'إلغاء التشويه', () => app.edit('إلغاء التشويه', () => (l.warp = null)), { testid: 'warp-reset' })
    );
  }

  setMode(v) {
    const l = this.layer;
    if (l?.warp && l.warp.kind !== v) {
      toast('يُلغى التشويه الحالي عند تغيير النوع (يمكنك التراجع)', { kind: 'warn' });
      this.app.edit('تغيير نوع التشويه', () => (l.warp = null));
    }
    this.mode = v;
    this.app.emit('tool-options');
    this.app.viewport.draw();
  }

  deletePin() {
    const l = this.layer;
    if (!l?.warp?.pins || this.selPin < 0) return;
    this.app.edit('حذف دبوس', () => l.warp.pins.splice(this.selPin, 1));
    this.selPin = -1;
  }

  ensure(l) {
    if (l.warp && l.warp.kind === this.mode) return;
    const W = l.src.width;
    const H = l.src.height;
    l.warp = this.mode === 'perspective' ? { kind: 'perspective', pts: [[0, 0], [W, 0], [W, H], [0, H]] } : { kind: 'puppet', pins: [] };
  }

  handlesScreen(l, vp) {
    const m = layerMatrix(l);
    const toS = (u, v) => vp.toScreen(...applyMatrix(m, u, v));
    if (this.mode === 'perspective') {
      const W = l.src.width;
      const H = l.src.height;
      const pts = l.warp?.kind === 'perspective' ? l.warp.pts : [[0, 0], [W, 0], [W, H], [0, H]];
      return pts.map(([u, v]) => toS(u, v));
    }
    return (l.warp?.kind === 'puppet' ? l.warp.pins : []).map((p) => toS(p.x, p.y));
  }

  toLocal(e, l) {
    const [u, v] = applyMatrix(invertMatrix(layerMatrix(l)), e.x, e.y);
    return [u, v];
  }

  down(e) {
    const l = this.layer;
    if (!l) return toast('اختر طبقة صورة أولًا', { kind: 'warn' });
    if (l.locked) return toast('الطبقة مقفلة', { kind: 'warn' });
    const hs = this.handlesScreen(l, this.app.viewport);
    const hit = hs.findIndex(([x, y]) => Math.hypot(e.sx - x, e.sy - y) < HANDLE);
    if (hit >= 0) {
      this.app.checkpoint(this.mode === 'perspective' ? 'منظور' : 'تحريك دبوس');
      this.ensure(l);
      this.drag = { l, i: hit };
      this.selPin = this.mode === 'puppet' ? hit : -1;
      return;
    }
    if (this.mode === 'puppet') {
      const [x, y] = this.toLocal(e, l);
      this.app.checkpoint('إضافة دبوس');
      this.ensure(l);
      const pins = l.warp.pins;
      // موضع الراحة: عكس التشويه الحالي تقريبًا
      let rest = [x, y];
      if (pins.length) rest = mlsRigid([x, y], pins.map((p) => [p.x, p.y]), pins.map((p) => [p.u, p.v]));
      pins.push({ u: rest[0], v: rest[1], x, y });
      this.selPin = pins.length - 1;
      this.drag = { l, i: this.selPin, added: true };
      this.app.changed();
    }
  }

  move(e) {
    const d = this.drag;
    if (!d) return;
    const [u, v] = this.toLocal(e, d.l);
    if (this.mode === 'perspective') d.l.warp.pts[d.i] = [u, v];
    else {
      d.l.warp.pins[d.i].x = u;
      d.l.warp.pins[d.i].y = v;
    }
    d.moved = true;
    this.app.changed({ save: false, structure: false });
  }

  up() {
    if (!this.drag) return;
    this.drag = null;
    this.app.changed();
  }

  cancel() {
    if (this.drag) {
      this.drag = null;
      this.app.undo();
    }
  }

  drawOverlay(g, vp) {
    const l = this.layer;
    if (!l || !l.visible) return;
    const hs = this.handlesScreen(l, vp);
    g.lineWidth = 1.5;
    g.strokeStyle = '#4cc2ff';
    if (this.mode === 'perspective') {
      g.beginPath();
      hs.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.stroke();
      for (const [x, y] of hs) {
        g.beginPath();
        g.rect(x - 9, y - 9, 18, 18);
        g.fillStyle = '#fff';
        g.fill();
        g.stroke();
      }
    } else {
      // شبكة خفيفة
      if (l.warp?.kind === 'puppet' && l.warp.pins.length) {
        const grid = warpGrid(l);
        if (grid) {
          const m = layerMatrix(l);
          g.strokeStyle = 'rgba(76,194,255,.35)';
          g.lineWidth = 1;
          const n = grid.nx + 1;
          g.beginPath();
          grid.dst.forEach(([u, v], i) => {
            const [x, y] = vp.toScreen(...applyMatrix(m, u, v));
            if (i % n) g.lineTo(x, y);
            else g.moveTo(x, y);
          });
          g.stroke();
        }
      }
      hs.forEach(([x, y], i) => {
        g.beginPath();
        g.arc(x, y, 11, 0, Math.PI * 2);
        g.fillStyle = i === this.selPin ? '#ff5d6c' : '#ffd36b';
        g.fill();
        g.strokeStyle = '#000';
        g.lineWidth = 2;
        g.stroke();
      });
    }
  }
}
