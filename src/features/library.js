// المرحلة 3: مكتبة العناصر الدائمة (مثل PicsArt): كل عنصر قصصته يُحفظ ويُسحب إلى أي لوحة
import { h, iconBtn, toast, modal, promptDialog, confirmDialog, selectBox, busy, pickFiles, downloadBlob } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { registerSection } from '../ui/props.js';
import { saveElement, listElements, loadElement, deleteElement, updateElementMeta } from '../core/store.js';
import { mk, ctx2d, canvasToMask, cropCanvas, thumbnail, canvasToBlob, blobToCanvas } from '../core/canvas.js';
import { createImageLayer } from '../core/doc.js';
import { deepCloneKeepRasters } from '../core/util.js';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

export const CATEGORIES = [
  ['person', 'أشخاص'],
  ['plant', 'أشجار ونباتات'],
  ['sky', 'سماء وغيوم'],
  ['animal', 'حيوانات'],
  ['building', 'مبانٍ'],
  ['object', 'أشياء'],
  ['texture', 'خامات وإضاءات'],
  ['other', 'أخرى']
];
const catLabel = Object.fromEntries(CATEGORIES);

/** يقص الطبقة إلى حدود القناع ويجهز العنصر للحفظ */
export function elementFromLayer(app, l) {
  const W = l.src.width;
  const H = l.src.height;
  let box = { x: 0, y: 0, w: W, h: H };
  if (l.mask && l.maskOn) {
    const a = canvasToMask(l.mask);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (a[y * W + x] > 6) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x1 < 0) return null;
    // هامش يسمح بتوسيع الحافة لاحقًا
    const pad = Math.round(Math.max(W, H) * 0.02) + 4;
    x0 = Math.max(0, x0 - pad);
    y0 = Math.max(0, y0 - pad);
    x1 = Math.min(W - 1, x1 + pad);
    y1 = Math.min(H - 1, y1 + pad);
    box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  let src = cropCanvas(l.src, box);
  if (l.retouch) {
    const t = mk(box.w, box.h);
    const g = ctx2d(t);
    g.drawImage(src, 0, 0);
    g.drawImage(l.retouch, -box.x, -box.y);
    src = t;
  }
  const mask = l.mask && l.maskOn ? cropCanvas(l.mask, box) : null;
  const preview = app.renderer.processLayer({ ...l, id: '__preview', src, mask, retouch: null, warp: null });
  return { src, mask, refine: deepCloneKeepRasters(l.refine), thumbCanvas: thumbnail(preview.canvas, 200) };
}

export async function saveLayerAsElement(app, l, { name, category } = {}) {
  const el = elementFromLayer(app, l);
  if (!el) {
    toast('القناع فارغ، لا يوجد عنصر لحفظه', { kind: 'warn' });
    return null;
  }
  const rec = await saveElement({ ...el, name: name || l.name, category: category || 'other', tags: [] });
  // نحفظ إعدادات التنقيح مع العنصر
  await updateElementMeta(rec.id, { refine: el.refine });
  app.emit('elements');
  return rec;
}

export async function addElementToDoc(app, id, at) {
  const e = await loadElement(id);
  if (!e) return null;
  const doc = app.doc;
  const l = createImageLayer(e.src, { name: e.name, doc });
  l.mask = e.mask;
  if (e.refine) l.refine = { ...l.refine, ...e.refine };
  l.elementId = id;
  // يناسب 60٪ من اللوحة إن كان أكبر
  const k = Math.min(1, (doc.width * 0.6) / e.src.width, (doc.height * 0.6) / e.src.height);
  l.sx = l.sy = k;
  if (at) {
    l.x = at.x;
    l.y = at.y;
  }
  app.addLayer(l, { label: 'إضافة عنصر' });
  await updateElementMeta(id, { used: (e.used || 0) + 1 });
  return l;
}

async function saveDialog(app, l) {
  let category = 'other';
  const name = h('input', { type: 'text', class: 'text', value: l.name, 'data-testid': 'el-name' });
  const chips = h('div', { class: 'chips', 'data-testid': 'el-cats' });
  const renderChips = () => {
    chips.replaceChildren(...CATEGORIES.map(([v, t]) => h('button', { type: 'button', class: 'chip' + (v === category ? ' on' : ''), 'data-v': v, onclick: () => { category = v; renderChips(); } }, t)));
  };
  renderChips();
  const body = h('div', { class: 'form' }, h('label', { class: 'field' }, h('span', {}, 'اسم العنصر'), name), h('div', { class: 'field' }, h('span', {}, 'التصنيف'), chips),
    h('p', { class: 'hint' }, 'يُحفظ العنصر بقناعه القابل للتعديل وبدقته الكاملة، ويبقى متاحًا في كل اللوحات.'));
  const ok = await modal('حفظ في مكتبة العناصر', body, [{ label: 'إلغاء', value: false }, { label: 'حفظ', value: true, primary: true, testid: 'el-save-ok' }]);
  if (!ok) return;
  const b = busy('جارِ حفظ العنصر…');
  try {
    const rec = await saveLayerAsElement(app, l, { name: name.value || l.name, category });
    if (rec) toast(`حُفظ «${rec.name}» في العناصر`, { kind: 'ok' });
  } finally {
    b.done();
  }
}

// ---------- لوحة العناصر ----------
class LibraryPanel {
  constructor(app, host) {
    this.app = app;
    this.cat = 'all';
    this.q = '';
    this.urls = [];
    const search = h('input', { type: 'search', class: 'text', placeholder: 'ابحث في العناصر…', 'data-testid': 'el-search', style: { width: '100%' } });
    search.addEventListener('input', () => {
      this.q = search.value.trim();
      this.render();
    });
    this.chips = h('div', { class: 'chips lib-cats' });
    this.grid = h('div', { class: 'lib-grid', 'data-testid': 'el-grid' });
    this.count = h('div', { class: 'hint' });
    this.el = h('div', { class: 'lib-panel' },
      h('div', { class: 'lib-head' }, search, this.chips),
      this.grid,
      h('div', { class: 'panel-foot' },
        iconBtn('plus', 'حفظ المحددة', () => {
          const l = app.selected;
          if (!l || l.type !== 'image') return toast('اختر طبقة صورة مقصوصة أولًا', { kind: 'warn' });
          saveDialog(app, l);
        }, { testid: 'el-save' }),
        iconBtn('export', 'نسخة احتياطية', () => exportLibrary(), { testid: 'el-export' }),
        iconBtn('upload', 'استيراد مكتبة', () => importLibrary(app), { testid: 'el-import' })
      ),
      this.count
    );
    host.append(this.el);
    app.on('elements', () => this.render());
    this.render();
  }

  async render() {
    const items = await listElements();
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls = [];
    const cats = [['all', 'الكل'], ...CATEGORIES.filter(([v]) => items.some((i) => i.category === v))];
    this.chips.replaceChildren(...cats.map(([v, t]) => h('button', { type: 'button', class: 'chip' + (v === this.cat ? ' on' : ''), onclick: () => { this.cat = v; this.render(); } }, t)));
    const q = this.q;
    const shown = items.filter((i) => (this.cat === 'all' || i.category === this.cat) && (!q || i.name.includes(q) || (catLabel[i.category] || '').includes(q)));
    this.grid.replaceChildren();
    if (!items.length) {
      this.grid.append(h('div', { class: 'empty' }, 'المكتبة فارغة.', h('br'), 'اقصص عنصرًا بأداة «قص» ثم اضغط «حفظ المحددة» ليبقى متاحًا في كل لوحاتك.'));
    }
    for (const it of shown) {
      const url = it.thumb ? URL.createObjectURL(it.thumb) : '';
      if (url) this.urls.push(url);
      const card = h('div', { class: 'lib-card', 'data-testid': 'el-card', draggable: 'true', title: it.name },
        h('button', { type: 'button', class: 'lib-add', 'aria-label': 'أضف ' + it.name, onclick: () => addElementToDoc(this.app, it.id).then(() => toast(`أُضيف «${it.name}»`)) },
          h('img', { src: url, alt: '' }),
          h('span', { class: 'lib-name' }, it.name)),
        h('button', { type: 'button', class: 'mini lib-more', 'aria-label': 'خيارات', 'data-testid': 'el-more', onclick: () => this.more(it) }, icon('more', 20))
      );
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-lawha-element', it.id);
        e.dataTransfer.effectAllowed = 'copy';
      });
      this.grid.append(card);
    }
    this.count.textContent = items.length ? `${items.length} عنصرًا محفوظًا` : '';
  }

  async more(it) {
    const app = this.app;
    let cat = it.category;
    const body = h('div', { class: 'form' },
      selectBox(CATEGORIES, cat, (v) => (cat = v), { label: 'التصنيف' }));
    const r = await modal(it.name, body, [
      { label: 'حذف', value: 'del', danger: true, testid: 'el-del' },
      { label: 'إعادة تسمية', value: 'ren' },
      { label: 'حفظ', value: 'save', primary: true }
    ]);
    if (r === 'del') {
      if (await confirmDialog(`حذف «${it.name}» من المكتبة نهائيًا؟ (اللوحات التي استخدمته لا تتأثر)`, { ok: 'حذف', danger: true })) {
        await deleteElement(it.id);
        app.emit('elements');
      }
    } else if (r === 'ren') {
      const n = await promptDialog('اسم العنصر', it.name);
      if (n) await updateElementMeta(it.id, { name: n });
      app.emit('elements');
    } else if (r === 'save') {
      await updateElementMeta(it.id, { category: cat });
      app.emit('elements');
    }
  }
}

// ---------- النسخ الاحتياطي ----------
async function exportLibrary() {
  const items = await listElements();
  if (!items.length) return toast('المكتبة فارغة', { kind: 'warn' });
  const b = busy('جارِ تجهيز النسخة الاحتياطية…');
  try {
    const files = {};
    const man = [];
    for (const it of items) {
      const e = await loadElement(it.id);
      const src = `el/${it.id}-src.png`;
      files[src] = new Uint8Array(await (await canvasToBlob(e.src)).arrayBuffer());
      let mask = null;
      if (e.mask) {
        mask = `el/${it.id}-mask.png`;
        files[mask] = new Uint8Array(await (await canvasToBlob(e.mask)).arrayBuffer());
      }
      man.push({ id: it.id, name: e.name, category: e.category, tags: e.tags, created: e.created, refine: e.refine, src, mask });
    }
    files['library.json'] = strToU8(JSON.stringify({ format: 'lawha-library', version: 1, elements: man }));
    downloadBlob(new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }), 'مكتبة-العناصر.lawha-lib');
  } finally {
    b.done();
  }
}

async function importLibrary(app) {
  const [f] = await pickFiles({ accept: '.lawha-lib,application/zip', multiple: false });
  if (!f) return;
  const b = busy('جارِ استيراد المكتبة…');
  try {
    const files = unzipSync(new Uint8Array(await f.arrayBuffer()));
    const man = JSON.parse(strFromU8(files['library.json']));
    if (man.format !== 'lawha-library') throw new Error('ليس ملف مكتبة');
    const existing = new Set((await listElements()).map((e) => e.id));
    let n = 0;
    for (const e of man.elements) {
      if (existing.has(e.id)) continue;
      const src = (await blobToCanvas(new Blob([files[e.src]]))).canvas;
      const mask = e.mask ? (await blobToCanvas(new Blob([files[e.mask]]))).canvas : null;
      const l = { src, mask, maskOn: true, refine: e.refine || {}, retouch: null, fx: {}, warp: null, x: 0, y: 0, sx: 1, sy: 1, rot: 0 };
      const preview = app.renderer.processLayer({ ...l, id: '__preview' });
      await saveElement({ id: e.id, name: e.name, category: e.category, tags: e.tags, created: e.created, src, mask, thumbCanvas: thumbnail(preview.canvas, 200) });
      if (e.refine) await updateElementMeta(e.id, { refine: e.refine });
      n++;
    }
    toast(`استُورد ${n} عنصرًا`, { kind: 'ok' });
    app.emit('elements');
  } catch (e) {
    toast('تعذّر الاستيراد: ' + e.message, { kind: 'error' });
  } finally {
    b.done();
  }
}

export default {
  install({ app, sideTabs, stage }) {
    const pane = h('div', { class: 'pane', 'data-pane': 'library' });
    new LibraryPanel(app, pane);
    sideTabs.push({ id: 'library', label: 'العناصر', icon: 'library', el: pane });
    registerSection({
      id: 'library',
      title: 'مكتبة العناصر',
      order: 25,
      when: (l) => l.type === 'image',
      build: (l) => h('div', {},
        iconBtn('library', 'حفظ في العناصر', () => saveDialog(app, l), { testid: 'el-save-layer' }),
        h('p', { class: 'hint' }, l.elementId ? 'هذه الطبقة مأخوذة من مكتبة العناصر.' : 'احفظ العنصر المقصوص ليبقى متاحًا في كل لوحاتك.'))
    });
    // سحب عنصر من اللوحة إلى مساحة العمل
    stage.addEventListener('drop', (e) => {
      const id = e.dataTransfer.getData('application/x-lawha-element');
      if (!id) return;
      e.preventDefault();
      const r = app.viewport.canvas.getBoundingClientRect();
      const p = app.viewport.toDoc(e.clientX - r.left, e.clientY - r.top);
      addElementToDoc(app, id, p);
    });
  }
};
