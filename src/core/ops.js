// عمليات الطبقات: نسخ، وحذف، ودمج، وتجميع، وترتيب
import { findLayer, createGroup, createImageLayer, allLayers } from './doc.js';
import { deepCloneKeepRasters, uid } from './util.js';
import { mk, ctx2d, opaqueBounds, cropCanvas } from './canvas.js';

function reId(l) {
  l.id = uid(l.type === 'group' ? 'gr' : 'ly');
  if (l.children) l.children.forEach(reId);
  return l;
}

export function duplicateLayer(app, id = app.doc.selectedId) {
  const f = findLayer(app.doc, id);
  if (!f) return null;
  let copy;
  app.edit('نسخ الطبقة', () => {
    copy = reId(deepCloneKeepRasters(f.layer));
    copy.name = f.layer.name + ' (نسخة)';
    if (copy.type === 'image') {
      copy.x += 20;
      copy.y += 20;
    }
    f.list.splice(f.index + 1, 0, copy);
    app.doc.selectedId = copy.id;
  });
  // الظلال المرتبطة لا تُنسخ تلقائيًا
  app.emit('select');
  return copy;
}

export function deleteLayer(app, id = app.doc.selectedId) {
  const f = findLayer(app.doc, id);
  if (!f) return;
  app.edit('حذف الطبقة', () => {
    f.list.splice(f.index, 1);
    // حذف الظلال التابعة
    const orphans = allLayers(app.doc.layers).filter((l) => l.type === 'shadow' && l.ref === id);
    for (const o of orphans) {
      const of = findLayer(app.doc, o.id);
      if (of) of.list.splice(of.index, 1);
    }
    const next = f.list[Math.min(f.index, f.list.length - 1)] || f.parent;
    app.doc.selectedId = next ? next.id : null;
  });
  app.emit('select');
}

export function moveLayer(app, id, dir) {
  const f = findLayer(app.doc, id);
  if (!f) return;
  const j = f.index + dir;
  if (j < 0 || j >= f.list.length) {
    // الخروج من المجموعة
    if (f.parent) {
      const pf = findLayer(app.doc, f.parent.id);
      app.edit('نقل الطبقة', () => {
        f.list.splice(f.index, 1);
        pf.list.splice(dir > 0 ? pf.index + 1 : pf.index, 0, f.layer);
      });
    }
    return;
  }
  app.edit('ترتيب الطبقة', () => {
    const [l] = f.list.splice(f.index, 1);
    f.list.splice(j, 0, l);
  });
}

export function groupLayer(app, id = app.doc.selectedId) {
  const f = findLayer(app.doc, id);
  if (!f) return;
  const g = createGroup();
  app.edit('تجميع', () => {
    f.list.splice(f.index, 1, g);
    g.children.push(f.layer);
    app.doc.selectedId = g.id;
  });
  app.emit('select');
  return g;
}

export function ungroup(app, id = app.doc.selectedId) {
  const f = findLayer(app.doc, id);
  if (!f || f.layer.type !== 'group') return;
  app.edit('فك التجميع', () => {
    f.list.splice(f.index, 1, ...f.layer.children);
    app.doc.selectedId = f.layer.children.at(-1)?.id || null;
  });
  app.emit('select');
}

/** يرسم طبقة (أو مجموعة) وحدها في فضاء المستند بالدقة الكاملة */
export function rasterizeToDoc(app, layer) {
  const tmp = { ...app.doc, layers: [layer], background: null };
  return app.renderer.renderDoc(tmp, { scale: 1, background: false });
}

/** ينشئ طبقة صورة من لوحة بحجم المستند مع قصّ الفراغ */
export function layerFromDocCanvas(app, c, name) {
  const b = opaqueBounds(c) || { x: 0, y: 0, w: 1, h: 1 };
  const crop = cropCanvas(c, b);
  return createImageLayer(crop, { name, x: b.x + b.w / 2, y: b.y + b.h / 2 });
}

export function mergeDown(app, id = app.doc.selectedId) {
  const f = findLayer(app.doc, id);
  if (!f || f.index === 0) return;
  const top = f.layer;
  const below = f.list[f.index - 1];
  if (below.type === 'adjust' || top.type === 'adjust') {
    // دمج طبقة تعديل: نطبقها على ما تحتها مباشرة
  }
  const W = app.doc.width;
  const H = app.doc.height;
  const c = mk(W, H);
  const tmp = { ...app.doc, layers: [below, top], background: null };
  app.renderer.renderDoc(tmp, { scale: 1, background: false, target: c });
  const merged = layerFromDocCanvas(app, c, below.name);
  app.edit('دمج مع الأسفل', () => {
    f.list.splice(f.index - 1, 2, merged);
    app.doc.selectedId = merged.id;
  });
  app.emit('select');
}

/** تحويل أي طبقة إلى صورة مسطحة (تثبيت القناع والمؤثرات) */
export function rasterizeLayer(app, id = app.doc.selectedId) {
  const f = findLayer(app.doc, id);
  if (!f) return;
  const c = rasterizeToDoc(app, f.layer);
  const nl = layerFromDocCanvas(app, c, f.layer.name);
  app.edit('تسطيح الطبقة', () => {
    f.list.splice(f.index, 1, nl);
    app.doc.selectedId = nl.id;
  });
  app.emit('select');
}

export function flattenImage(app) {
  const c = app.renderer.renderDoc(app.doc, { scale: 1, background: true });
  const nl = createImageLayer(c, { name: 'الصورة المسطحة', x: app.doc.width / 2, y: app.doc.height / 2 });
  app.edit('تسطيح الكل', () => {
    app.doc.layers = [nl];
    app.doc.selectedId = nl.id;
  });
  app.emit('select');
}

export function fitLayerToDoc(app, l, mode = 'contain') {
  const k = mode === 'contain'
    ? Math.min(app.doc.width / l.src.width, app.doc.height / l.src.height)
    : Math.max(app.doc.width / l.src.width, app.doc.height / l.src.height);
  l.sx = Math.sign(l.sx || 1) * k;
  l.sy = k;
  l.x = app.doc.width / 2;
  l.y = app.doc.height / 2;
  l.rot = 0;
}

export function newBlankLayer(app) {
  const c = mk(app.doc.width, app.doc.height);
  ctx2d(c);
  return createImageLayer(c, { name: 'طبقة فارغة', doc: app.doc });
}
