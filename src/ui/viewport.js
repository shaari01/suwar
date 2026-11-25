// مساحة العمل: عرض المستند، والتكبير بإصبعين، والسحب، وتمرير اللمس إلى الأداة الحالية
import { mk } from '../core/canvas.js';

export class Viewport {
  constructor(app, host) {
    this.app = app;
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'view';
    this.canvas.setAttribute('data-testid', 'viewport');
    this.canvas.setAttribute('touch-action', 'none');
    host.append(this.canvas);
    this.g = this.canvas.getContext('2d');
    this.zoom = 1;
    this.tx = 0;
    this.ty = 0;
    this.pointers = new Map();
    this.pinch = null;
    this.panning = null;
    this.toolActive = false;
    this.spaceDown = false;
    this.checker = null;
    this.hover = null;

    new ResizeObserver(() => this.resize()).observe(host);
    this.bind();
    app.on('rendered', () => this.draw());
    app.on('fit', () => this.fit());
    app.on('select', () => this.draw());
    app.on('tool', () => this.draw());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.host.getBoundingClientRect();
    this.dpr = dpr;
    this.cw = r.width;
    this.ch = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    if (!this._fitted && r.width > 10) {
      this._fitted = true;
      this.fit();
    }
    this.draw();
  }

  fit() {
    const d = this.app.doc;
    if (!this.cw) return;
    const pad = 24;
    this.zoom = Math.min((this.cw - pad * 2) / d.width, (this.ch - pad * 2) / d.height);
    this.tx = (this.cw - d.width * this.zoom) / 2;
    this.ty = (this.ch - d.height * this.zoom) / 2;
    this.app.emit('zoom', this.zoom);
    this.draw();
  }

  setZoom(z, cx = this.cw / 2, cy = this.ch / 2) {
    z = Math.max(0.02, Math.min(32, z));
    const dx = (cx - this.tx) / this.zoom;
    const dy = (cy - this.ty) / this.zoom;
    this.zoom = z;
    this.tx = cx - dx * z;
    this.ty = cy - dy * z;
    this.app.emit('zoom', this.zoom);
    this.draw();
  }

  toDoc(sx, sy) {
    return { x: (sx - this.tx) / this.zoom, y: (sy - this.ty) / this.zoom };
  }

  toScreen(x, y) {
    return [x * this.zoom + this.tx, y * this.zoom + this.ty];
  }

  localPoint(e) {
    const r = this.canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e, true));
    c.addEventListener('pointerleave', () => {
      this.hover = null;
      this.draw();
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const { sx, sy } = this.localPoint(e);
      if (e.ctrlKey || e.metaKey || !e.shiftKey) {
        const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
        this.setZoom(this.zoom * f, sx, sy);
      } else {
        this.tx -= e.deltaX || e.deltaY;
        this.draw();
      }
    }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.target.closest?.('input,textarea,select')) {
        this.spaceDown = true;
        c.style.cursor = 'grab';
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spaceDown = false;
        c.style.cursor = '';
      }
    });
  }

  makeEvt(e) {
    const { sx, sy } = this.localPoint(e);
    const p = this.toDoc(sx, sy);
    return { x: p.x, y: p.y, sx, sy, pressure: e.pressure || 0.5, pointerType: e.pointerType, button: e.button, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, raw: e };
  }

  onDown(e) {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.localPoint(e));
    if (this.pointers.size === 2) {
      // بدء التكبير بإصبعين: نلغي ضربة الأداة إن بدأت
      if (this.toolActive) {
        this.app.tool?.cancel ? this.app.tool.cancel() : this.app.tool?.up?.(this.makeEvt(e));
        this.toolActive = false;
      }
      this.panning = null;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.sx - b.sx, a.sy - b.sy), cx: (a.sx + b.sx) / 2, cy: (a.sy + b.sy) / 2, zoom: this.zoom, tx: this.tx, ty: this.ty };
      return;
    }
    if (this.pointers.size > 2) return;
    const useHand = this.app.toolName === 'hand' || this.spaceDown || e.button === 1 || e.button === 2;
    if (useHand) {
      const { sx, sy } = this.localPoint(e);
      this.panning = { sx, sy, tx: this.tx, ty: this.ty };
      return;
    }
    const t = this.app.tool;
    if (t?.down) {
      this.toolActive = true;
      t.down(this.makeEvt(e));
      this.draw();
    }
  }

  onMove(e) {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, this.localPoint(e));
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.sx - b.sx, a.sy - b.sy);
      const cx = (a.sx + b.sx) / 2;
      const cy = (a.sy + b.sy) / 2;
      const p = this.pinch;
      const z = Math.max(0.02, Math.min(32, p.zoom * (d / p.d)));
      // نقطة المستند تحت المركز الأصلي تبقى تحت المركز الجديد
      const docX = (p.cx - p.tx) / p.zoom;
      const docY = (p.cy - p.ty) / p.zoom;
      this.zoom = z;
      this.tx = cx - docX * z;
      this.ty = cy - docY * z;
      this.app.emit('zoom', this.zoom);
      this.draw();
      return;
    }
    if (this.panning) {
      const { sx, sy } = this.localPoint(e);
      this.tx = this.panning.tx + (sx - this.panning.sx);
      this.ty = this.panning.ty + (sy - this.panning.sy);
      this.draw();
      return;
    }
    const ev = this.makeEvt(e);
    this.hover = ev;
    if (this.toolActive) {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (evs.length > 1 && this.app.tool.wantsCoalesced) for (const ce of evs) this.app.tool.move(this.makeEvt(ce));
      else this.app.tool.move?.(ev);
    } else this.app.tool?.hover?.(ev);
    this.draw();
  }

  onUp(e, cancelled) {
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      return;
    }
    if (this.panning) {
      this.panning = null;
      return;
    }
    if (this.toolActive) {
      this.toolActive = false;
      if (cancelled && this.app.tool.cancel) this.app.tool.cancel();
      else this.app.tool.up?.(this.makeEvt(e));
      this.draw();
    }
  }

  getChecker() {
    if (this.checker) return this.checker;
    const c = mk(16, 16);
    const g = c.getContext('2d');
    g.fillStyle = '#cfcfd4';
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#f4f4f6';
    g.fillRect(0, 0, 8, 8);
    g.fillRect(8, 8, 8, 8);
    this.checker = this.g.createPattern(c, 'repeat');
    return this.checker;
  }

  draw() {
    if (this._drawQueued) return;
    this._drawQueued = true;
    requestAnimationFrame(() => {
      this._drawQueued = false;
      this.drawNow();
    });
  }

  drawNow() {
    const g = this.g;
    const d = this.app.doc;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.cw, this.ch);
    const x = this.tx;
    const y = this.ty;
    const w = d.width * this.zoom;
    const h = d.height * this.zoom;
    g.save();
    g.shadowColor = 'rgba(0,0,0,.45)';
    g.shadowBlur = 18;
    g.fillStyle = this.app.testBg || this.getChecker();
    g.fillRect(x, y, w, h);
    g.restore();
    if (this.app.comp) {
      g.imageSmoothingEnabled = this.zoom < 2;
      g.imageSmoothingQuality = 'high';
      g.drawImage(this.app.comp, x, y, w, h);
    }
    const t = this.app.tool;
    if (t?.drawOverlay) {
      g.save();
      t.drawOverlay(g, this);
      g.restore();
    }
  }
}
