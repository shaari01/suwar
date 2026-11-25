// أداة النقل والتحجيم والتدوير
import { layerCorners, layerMatrix, invertMatrix, applyMatrix, allLayers } from '../core/doc.js';

const HANDLE = 22; // نصف قطر مقبض اللمس بالبكسل على الشاشة

export class MoveTool {
  constructor() {
    this.drag = null;
    this.label = 'نقل وتحجيم';
  }

  /** أعلى طبقة صورة تحت النقطة (مع مراعاة الشفافية) */
  hitTest(x, y) {
    const app = this.app;
    const layers = allLayers(app.doc.layers).filter((l) => l.type === 'image' && l.visible);
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      const inv = invertMatrix(layerMatrix(l));
      const [u, v] = applyMatrix(inv, x, y);
      if (u < 0 || v < 0 || u >= l.src.width || v >= l.src.height) continue;
      try {
        const p = app.renderer.processLayer(l);
        const px = Math.floor(u - p.ox);
        const py = Math.floor(v - p.oy);
        if (px < 0 || py < 0 || px >= p.canvas.width || py >= p.canvas.height) continue;
        const a = p.canvas.getContext('2d').getImageData(px, py, 1, 1).data[3];
        if (a > 10) return l;
      } catch {
        return l;
      }
    }
    return null;
  }

  handles(l, vp) {
    const pts = layerCorners(l).map(([x, y]) => vp.toScreen(x, y));
    const top = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
    const ang = l.rot - Math.PI / 2;
    const rot = [top[0] + Math.cos(ang) * 44, top[1] + Math.sin(ang) * 44];
    return { corners: pts, rot, top };
  }

  down(e) {
    const app = this.app;
    const vp = app.viewport;
    const sel = app.selected;
    if (sel && sel.type === 'image' && !sel.locked) {
      const hd = this.handles(sel, vp);
      if (Math.hypot(e.sx - hd.rot[0], e.sy - hd.rot[1]) < HANDLE) {
        app.checkpoint('تدوير');
        this.drag = { kind: 'rot', l: sel, start: Math.atan2(e.y - sel.y, e.x - sel.x), rot0: sel.rot };
        return;
      }
      for (let i = 0; i < 4; i++) {
        const c = hd.corners[i];
        if (Math.hypot(e.sx - c[0], e.sy - c[1]) < HANDLE) {
          app.checkpoint('تحجيم');
          this.drag = { kind: 'scale', l: sel, d0: Math.hypot(e.x - sel.x, e.y - sel.y), sx0: sel.sx, sy0: sel.sy };
          return;
        }
      }
    }
    // داخل الطبقة المحددة؟ نسحبها حتى لو تحتها طبقة أخرى
    let target = null;
    if (sel && sel.type === 'image') {
      const inv = invertMatrix(layerMatrix(sel));
      const [u, v] = applyMatrix(inv, e.x, e.y);
      if (u >= 0 && v >= 0 && u < sel.src.width && v < sel.src.height) target = sel;
    }
    if (!target) target = this.hitTest(e.x, e.y);
    if (target && target.id !== app.doc.selectedId) app.select(target.id);
    if (!target) {
      this.drag = null;
      return;
    }
    if (target.locked) return;
    app.checkpoint('نقل');
    this.drag = { kind: 'move', l: target, x0: e.x, y0: e.y, lx: target.x, ly: target.y, moved: false };
  }

  move(e) {
    const d = this.drag;
    if (!d) return;
    const l = d.l;
    if (d.kind === 'move') {
      l.x = d.lx + (e.x - d.x0);
      l.y = d.ly + (e.y - d.y0);
      d.moved = true;
    } else if (d.kind === 'scale') {
      const k = Math.max(0.01, Math.hypot(e.x - l.x, e.y - l.y) / Math.max(1, d.d0));
      l.sx = d.sx0 * k;
      l.sy = d.sy0 * k;
    } else if (d.kind === 'rot') {
      let r = d.rot0 + Math.atan2(e.y - l.y, e.x - l.x) - d.start;
      if (e.shift) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
      l.rot = r;
    }
    this.app.changed({ save: false, structure: false });
  }

  up() {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    if (d.kind === 'move' && !d.moved) {
      // نقرة بلا سحب: لا داعي لنقطة تراجع
      this.app.history.undoStack.pop();
      this.app.history.emit();
      return;
    }
    this.app.changed();
  }

  cancel() {
    if (this.drag) {
      this.drag = null;
      this.app.undo();
    }
  }

  drawOverlay(g, vp) {
    const l = this.app.selected;
    if (!l || l.type !== 'image' || !l.visible) return;
    const hd = this.handles(l, vp);
    g.lineWidth = 1.5;
    g.strokeStyle = '#4cc2ff';
    g.beginPath();
    hd.corners.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.stroke();
    if (l.locked) return;
    g.beginPath();
    g.moveTo(hd.top[0], hd.top[1]);
    g.lineTo(hd.rot[0], hd.rot[1]);
    g.stroke();
    const dot = (x, y, r) => {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = '#fff';
      g.fill();
      g.stroke();
    };
    for (const [x, y] of hd.corners) dot(x, y, 9);
    dot(hd.rot[0], hd.rot[1], 10);
  }
}

export class HandTool {
  constructor() {
    this.label = 'تحريك العرض';
  }
}
