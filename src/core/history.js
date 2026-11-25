// تراجع وإعادة بلا حد عددي.
// يعتمد على لقطات خفيفة: الخصائص تُنسخ، واللوحات تُشارك بالمرجع لأنها لا تُعدَّل في مكانها أبدًا
// (كل عملية رسم تنسخ اللوحة أولًا ثم تعدّل النسخة).
import { deepCloneKeepRasters } from './util.js';

export class History {
  constructor({ limitBytes = Infinity } = {}) {
    this.undoStack = [];
    this.redoStack = [];
    this.limitBytes = limitBytes;
    this.listeners = new Set();
  }

  /** يحفظ حالة المستند قبل التغيير */
  checkpoint(doc, label = 'تعديل') {
    this.undoStack.push({ label, state: deepCloneKeepRasters(doc) });
    this.redoStack.length = 0;
    this.emit();
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  /** يعيد الحالة السابقة، ويحفظ الحالية في مكدس الإعادة */
  undo(current) {
    const e = this.undoStack.pop();
    if (!e) return null;
    this.redoStack.push({ label: e.label, state: deepCloneKeepRasters(current) });
    this.emit();
    return e.state;
  }

  redo(current) {
    const e = this.redoStack.pop();
    if (!e) return null;
    this.undoStack.push({ label: e.label, state: deepCloneKeepRasters(current) });
    this.emit();
    return e.state;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emit();
  }

  lastLabel() {
    return this.undoStack.length ? this.undoStack[this.undoStack.length - 1].label : null;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const f of this.listeners) f(this);
  }
}
