// الاستيراد والتصدير والمشاريع
import { h, modal, toast, busy, pickFiles, downloadBlob, confirmDialog, selectBox, slider } from './dom.js';
import { icon } from './icons.js';
import { blobToCanvas, canvasToBlob, mk } from '../core/canvas.js';
import { createDoc, createImageLayer } from '../core/doc.js';
import { fitLayerToDoc } from '../core/ops.js';
import { listProjects, loadProject, deleteProject } from '../core/store.js';
import { exportProjectFile, importProjectFile } from '../core/projectfile.js';
import { uid } from '../core/util.js';

export const importers = []; // [{ test(file) => bool, run(app, file) }] تضيفه المراحل اللاحقة (PSD)
export const exportFormats = []; // [{ id, label, run(app, opts) }]

const baseName = (n) => n.replace(/\.[^.]+$/, '');

export async function importFiles(app, files) {
  if (!files?.length) return;
  const b = busy('جارِ الاستيراد…');
  try {
    for (const f of files) {
      const custom = importers.find((i) => i.test(f));
      if (custom) {
        await custom.run(app, f);
        continue;
      }
      if (/\.lawha$/i.test(f.name)) {
        const doc = await importProjectFile(f);
        doc.id = uid('doc');
        app.setDoc(doc);
        toast('فُتح المشروع');
        continue;
      }
      if (!f.type.startsWith('image/') && !/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name)) {
        toast(`الملف «${f.name}» ليس صورة مدعومة`, { kind: 'warn' });
        continue;
      }
      const { canvas, scaled, originalWidth, originalHeight } = await blobToCanvas(f, app.maxSide);
      if (scaled) toast(`صُغّرت «${f.name}» من ${originalWidth}×${originalHeight} لتناسب ذاكرة الجهاز`, { kind: 'warn', ms: 5000 });
      addImageCanvas(app, canvas, baseName(f.name));
    }
  } catch (e) {
    console.error(e);
    toast('تعذّر الاستيراد: ' + e.message, { kind: 'error' });
  } finally {
    b.done();
  }
}

/** يضيف صورة كطبقة. أول صورة في لوحة فارغة تحدد مقاس اللوحة */
export function addImageCanvas(app, canvas, name) {
  const doc = app.doc;
  if (!doc.layers.length && doc.untouched) {
    doc.width = canvas.width;
    doc.height = canvas.height;
    doc.untouched = false;
    app.updatePreviewScale();
    app.renderer.invalidate();
    app.emit('fit');
  }
  const l = createImageLayer(canvas, { name, doc });
  if (canvas.width > doc.width || canvas.height > doc.height) fitLayerToDoc(app, l, 'contain');
  app.addLayer(l, { label: 'استيراد صورة' });
  return l;
}

export function bindDropAndPaste(app, target) {
  target.addEventListener('dragover', (e) => {
    e.preventDefault();
    target.classList.add('drop');
  });
  target.addEventListener('dragleave', () => target.classList.remove('drop'));
  target.addEventListener('drop', (e) => {
    e.preventDefault();
    target.classList.remove('drop');
    if (e.dataTransfer.getData('application/x-lawha-element')) return; // يعالجه سحب العناصر
    importFiles(app, [...e.dataTransfer.files]);
  });
  window.addEventListener('paste', (e) => {
    if (e.target.closest?.('input,textarea')) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) importFiles(app, files);
  });
}

export async function importDialog(app) {
  const files = await pickFiles({ accept: 'image/*,.psd,.lawha', multiple: true });
  await importFiles(app, files);
}

// ---------- مستند جديد ----------
const PRESETS = [
  ['auto', 'حسب أول صورة أستوردها'],
  ['1920x1080', 'أفقي 1920×1080 (شاشة/فيديو)'],
  ['1080x1920', 'عمودي 1080×1920 (قصة/جوال)'],
  ['1080x1080', 'مربع 1080×1080'],
  ['1080x1350', 'منشور 1080×1350'],
  ['3000x2000', 'لوحة كبيرة 3000×2000'],
  ['2480x3508', 'A4 طباعة 2480×3508'],
  ['custom', 'مقاس مخصص']
];

export async function newDocDialog(app) {
  let preset = 'auto';
  const w = h('input', { type: 'number', class: 'text num', value: 1920, min: 16, max: app.maxSide });
  const hh = h('input', { type: 'number', class: 'text num', value: 1080, min: 16, max: app.maxSide });
  const custom = h('div', { class: 'row', style: { display: 'none' } }, h('span', {}, 'العرض'), w, h('span', {}, 'الارتفاع'), hh);
  const name = h('input', { type: 'text', class: 'text', value: 'لوحة جديدة' });
  const body = h(
    'div',
    { class: 'form' },
    h('label', { class: 'field' }, h('span', {}, 'الاسم'), name),
    selectBox(PRESETS, preset, (v) => {
      preset = v;
      custom.style.display = v === 'custom' ? 'flex' : 'none';
    }, { label: 'المقاس', testid: 'new-preset' }),
    custom,
    h('p', { class: 'hint' }, `أقصى مقاس على هذا الجهاز: ${app.maxSide} بكسل للضلع.`)
  );
  const ok = await modal('لوحة جديدة', body, [
    { label: 'إلغاء', value: false },
    { label: 'إنشاء', value: true, primary: true, testid: 'new-ok' }
  ]);
  if (!ok) return;
  let W = 1920;
  let H = 1080;
  if (preset === 'custom') {
    W = +w.value;
    H = +hh.value;
  } else if (preset !== 'auto') [W, H] = preset.split('x').map(Number);
  W = Math.min(app.maxSide, Math.max(16, W | 0));
  H = Math.min(app.maxSide, Math.max(16, H | 0));
  if (app.dirty) await app.saveNow();
  const doc = createDoc({ width: W, height: H, name: name.value || 'لوحة جديدة' });
  doc.untouched = preset === 'auto';
  app.setDoc(doc);
  await app.saveNow();
}

// ---------- المشاريع ----------
export async function projectsDialog(app) {
  if (app.dirty) await app.saveNow();
  const list = await listProjects();
  const grid = h('div', { class: 'proj-grid', 'data-testid': 'projects' });
  let close;
  const render = (items) => {
    grid.replaceChildren();
    if (!items.length) grid.append(h('p', { class: 'hint' }, 'لا توجد مشاريع محفوظة بعد.'));
    for (const p of items) {
      const img = h('img', { alt: '' });
      if (p.thumb) img.src = URL.createObjectURL(p.thumb);
      const card = h(
        'div',
        { class: 'proj' + (p.id === app.doc.id ? ' cur' : '') },
        h('button', { class: 'proj-open', type: 'button', onclick: async () => {
          const b = busy('جارِ فتح المشروع…');
          try {
            const doc = await loadProject(p.id);
            if (doc) app.setDoc(doc);
          } finally {
            b.done();
          }
          close();
        } }, img, h('div', { class: 'pn' }, p.name), h('div', { class: 'pd' }, new Date(p.updated).toLocaleString('ar'))),
        h('button', { class: 'mini danger', type: 'button', 'aria-label': 'حذف', onclick: async () => {
          if (!(await confirmDialog(`حذف المشروع «${p.name}» نهائيًا؟`, { ok: 'حذف', danger: true }))) return;
          await deleteProject(p.id);
          if (p.id === app.doc.id) app.setDoc(createDoc());
          render((await listProjects()));
        } }, icon('trash', 20))
      );
      grid.append(card);
    }
  };
  render(list);
  const body = h('div', {}, grid);
  const p = modal('مشاريعي', body, [
    { label: 'فتح ملف مشروع (.lawha)', value: 'file' },
    { label: 'مشروع جديد', value: 'new', primary: true }
  ], { wide: true, testid: 'projects-dialog' });
  close = body.closeModal;
  const r = await p;
  if (r === 'new') newDocDialog(app);
  if (r === 'file') {
    const files = await pickFiles({ accept: '.lawha,application/zip', multiple: false });
    await importFiles(app, files);
  }
}

// ---------- التصدير ----------
export async function exportImage(app, { format = 'png', scale = 1, quality = 0.92, transparent = true } = {}) {
  const doc = app.doc;
  const S = Math.min(scale, app.maxSide * 1.5 / Math.max(doc.width, doc.height));
  const c = app.renderer.renderDoc(doc, { scale: S, background: format === 'jpeg' || !transparent || !!doc.background });
  let out = c;
  if (format === 'jpeg') {
    out = mk(c.width, c.height);
    const g = out.getContext('2d');
    g.fillStyle = doc.background || '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(c, 0, 0);
  }
  const type = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }[format];
  const blob = await canvasToBlob(out, type, format === 'png' ? undefined : quality);
  return { blob, width: c.width, height: c.height };
}

export async function exportDialog(app) {
  let format = 'png';
  let scale = 100;
  let quality = 92;
  const doc = app.doc;
  const size = h('p', { class: 'hint', 'data-testid': 'export-size' });
  const upd = () => (size.textContent = `المقاس الناتج: ${Math.round(doc.width * scale / 100)} × ${Math.round(doc.height * scale / 100)} بكسل`);
  upd();
  const qs = slider({ label: 'الجودة', min: 40, max: 100, value: quality, unit: '٪', onInput: (v) => (quality = v) });
  qs.style.display = 'none';
  const fmts = [['png', 'PNG (شفاف، بلا فقد)'], ['jpeg', 'JPG (حجم أصغر)'], ['webp', 'WebP (شفاف وحجم صغير)'], ...exportFormats.map((f) => [f.id, f.label])];
  const body = h(
    'div',
    { class: 'form' },
    selectBox(fmts, format, (v) => {
      format = v;
      qs.style.display = v === 'jpeg' || v === 'webp' ? '' : 'none';
    }, { label: 'الصيغة', testid: 'export-format' }),
    slider({ label: 'الدقة', min: 10, max: 400, step: 5, value: scale, unit: '٪', testid: 'export-scale', onInput: (v) => { scale = v; upd(); } }),
    size,
    qs
  );
  const ok = await modal('تصدير', body, [
    { label: 'إلغاء', value: false },
    { label: 'تصدير', value: true, primary: true, testid: 'export-ok' }
  ]);
  if (!ok) return;
  const b = busy('جارِ التصدير…');
  try {
    const custom = exportFormats.find((f) => f.id === format);
    if (custom) {
      await custom.run(app, { scale: scale / 100 });
    } else {
      const { blob, width, height } = await exportImage(app, { format, scale: scale / 100, quality: quality / 100 });
      const ext = format === 'jpeg' ? 'jpg' : format;
      await saveOrShare(blob, `${doc.name || 'لوحة'}.${ext}`);
      toast(`صُدّرت الصورة ${width}×${height}`);
    }
  } catch (e) {
    console.error(e);
    toast('تعذّر التصدير: ' + e.message, { kind: 'error' });
  } finally {
    b.done();
  }
}

/** حفظ ملف: تنزيل مباشر (يعمل على Chrome في أندرويد وويندوز) */
export async function saveOrShare(blob, filename) {
  downloadBlob(blob, filename);
}

export async function saveProjectFile(app) {
  const b = busy('جارِ تجهيز ملف المشروع…');
  try {
    const blob = await exportProjectFile(app.doc);
    await saveOrShare(blob, `${app.doc.name || 'لوحة'}.lawha`);
  } finally {
    b.done();
  }
}
