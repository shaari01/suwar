// متحكّم التطبيق: يحمل المستند والتاريخ والعارض والأداة الحالية
import { History } from './core/history.js';
import { Renderer } from './core/render.js';
import { createDoc, findLayer, getLayer, allLayers } from './core/doc.js';
import { deviceMaxSide, thumbnail } from './core/canvas.js';
import { saveProject, setSetting } from './core/store.js';
import { debounce } from './core/util.js';

class Emitter {
  constructor() {
    this.h = {};
  }
  on(e, f) {
    (this.h[e] ||= new Set()).add(f);
    return () => this.h[e].delete(f);
  }
  emit(e, ...a) {
    if (this.h[e]) for (const f of [...this.h[e]]) f(...a);
  }
}

export class App extends Emitter {
  constructor() {
    super();
    this.doc = createDoc();
    this.history = new History();
    this.renderer = new Renderer();
    this.maxSide = deviceMaxSide();
    this.tools = {};
    this.toolName = 'move';
    this.comp = null; // آخر صورة مركبة للمعاينة
    this.previewScale = 1;
    this.saving = false;
    this.lastSaved = 0;
    this.dirty = false;
    this._renderQueued = false;
    this.autosave = debounce(() => this.saveNow(), 1500);
    this.history.on(() => this.emit('history'));
  }

  // ---------- المستند ----------
  setDoc(doc, { resetHistory = true } = {}) {
    this.doc = doc;
    this.renderer.invalidate();
    if (resetHistory) this.history.clear();
    this.updatePreviewScale();
    this.emit('doc');
    this.emit('select');
    this.changed({ save: false });
    this.emit('fit');
  }

  updatePreviewScale() {
    const maxPrev = Math.min(this.maxSide, (window.innerWidth || 1500) > 1100 ? 3000 : 2048);
    this.previewScale = Math.min(1, maxPrev / Math.max(this.doc.width, this.doc.height));
  }

  /** نقطة حفظ للتراجع قبل أي تغيير */
  checkpoint(label) {
    this.history.checkpoint(this.doc, label);
  }

  /** تغيير مع نقطة تراجع: app.edit('اسم', () => {...}) */
  edit(label, fn) {
    this.checkpoint(label);
    const r = fn(this.doc);
    this.changed();
    return r;
  }

  changed({ save = true, structure = true } = {}) {
    this.doc.updated = Date.now();
    this.requestRender();
    if (structure) this.emit('layers');
    this.emit('props');
    if (save) {
      this.dirty = true;
      this.autosave();
    }
  }

  undo() {
    const s = this.history.undo(this.doc);
    if (s) this.restore(s);
  }

  redo() {
    const s = this.history.redo(this.doc);
    if (s) this.restore(s);
  }

  restore(state) {
    this.doc = state;
    if (this.doc.selectedId && !getLayer(this.doc, this.doc.selectedId)) this.doc.selectedId = null;
    this.emit('select');
    this.changed();
    this.emit('restored');
  }

  // ---------- التحديد ----------
  get selected() {
    return this.doc.selectedId ? getLayer(this.doc, this.doc.selectedId) : null;
  }

  select(id) {
    this.doc.selectedId = id;
    this.emit('select');
    this.emit('layers');
    this.emit('props');
    this.requestRender();
  }

  // ---------- إضافة الطبقات ----------
  /** يضيف طبقة فوق المحددة (أو في الأعلى) */
  addLayer(layer, { above = this.doc.selectedId, label = 'إضافة طبقة' } = {}) {
    this.edit(label, (doc) => {
      const f = above ? findLayer(doc, above) : null;
      if (f) {
        if (f.layer.type === 'group' && f.layer.open) f.layer.children.push(layer);
        else f.list.splice(f.index + 1, 0, layer);
      } else doc.layers.push(layer);
      doc.selectedId = layer.id;
    });
    this.emit('select');
    return layer;
  }

  insertBelow(layer, refId, label = 'إضافة طبقة') {
    this.edit(label, () => {
      const f = findLayer(this.doc, refId);
      if (f) f.list.splice(f.index, 0, layer);
      else this.doc.layers.unshift(layer);
    });
    return layer;
  }

  // ---------- الأدوات ----------
  registerTool(name, tool) {
    this.tools[name] = tool;
    tool.app = this;
  }

  setTool(name) {
    if (!this.tools[name]) return;
    const prev = this.tools[this.toolName];
    if (prev?.deactivate) prev.deactivate();
    this.toolName = name;
    const t = this.tools[name];
    if (t.activate) t.activate();
    this.emit('tool', name);
    this.requestRender();
  }

  get tool() {
    return this.tools[this.toolName];
  }

  // ---------- الرسم ----------
  requestRender() {
    if (this._renderQueued) return;
    this._renderQueued = true;
    requestAnimationFrame(() => {
      this._renderQueued = false;
      try {
        this.comp = this.renderer.renderDoc(this.doc, { scale: this.previewScale, target: this.comp });
      } catch (e) {
        console.error(e);
        this.emit('error', e);
      }
      this.emit('rendered');
    });
  }

  /** يرسم فورًا (للاختبارات والتصدير) */
  renderNow() {
    this.comp = this.renderer.renderDoc(this.doc, { scale: this.previewScale, target: this.comp });
    this.emit('rendered');
    return this.comp;
  }

  // ---------- الحفظ التلقائي ----------
  async saveNow() {
    if (this.saving) {
      this._saveAgain = true;
      return;
    }
    this.saving = true;
    this.emit('saving', true);
    try {
      const comp = this.comp || this.renderNow();
      await saveProject(this.doc, thumbnail(comp, 320));
      await setSetting('lastProject', this.doc.id);
      this.lastSaved = Date.now();
      this.dirty = false;
    } catch (e) {
      console.error('فشل الحفظ', e);
      this.emit('error', new Error('تعذّر الحفظ التلقائي: ' + e.message));
    } finally {
      this.saving = false;
      this.emit('saving', false);
      if (this._saveAgain) {
        this._saveAgain = false;
        this.saveNow();
      }
    }
  }

  imageLayers() {
    return allLayers(this.doc.layers).filter((l) => l.type === 'image');
  }
}
