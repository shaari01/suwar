// «موادي»: خطوط ومرشحات (LUT) وملصقات وصور يضيفها المستخدم ويحذفها بنفسه، وطبقة نص تستعمل الخطوط.
// كل شيء يُحفظ على الجهاز (IndexedDB) ويعمل بلا إنترنت.
import { getSetting, setSetting, saveElement } from '../core/store.js';
import { registerSection, propSlider } from '../ui/props.js';
import { h, iconBtn, modal, toast, selectBox, pickFiles, promptDialog, confirmDialog, toggle, busy } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { mk, ctx2d, blobToCanvas, thumbnail } from '../core/canvas.js';
import { createImageLayer } from '../core/doc.js';
import { parseCube } from '../img/adjust.js';
import { uid } from '../core/util.js';

// ---------- الخطوط ----------
export const BUILTIN_FONTS = [
  ['Tajawal', 'تجوّل (الافتراضي)'],
  ['Arial', 'Arial'],
  ['Times New Roman', 'Times New Roman'],
  ['Georgia', 'Georgia'],
  ['Courier New', 'Courier New']
];
const loadedFaces = new Map(); // family -> FontFace

async function registerFont(f) {
  if (loadedFaces.has(f.family)) return;
  try {
    const face = new FontFace(f.family, f.data);
    await face.load();
    document.fonts.add(face);
    loadedFaces.set(f.family, face);
  } catch (e) {
    console.warn('تعذّر تحميل الخط', f.name, e);
  }
}

export async function listUserFonts() {
  return (await getSetting('userFonts', [])) || [];
}

export async function addFonts(files) {
  const list = await listUserFonts();
  let added = 0;
  for (const file of files) {
    if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) continue;
    const name = file.name.replace(/\.(ttf|otf|woff2?)$/i, '');
    const family = 'u-' + name.replace(/[^\w؀-ۿ-]+/g, '-');
    const data = await file.arrayBuffer();
    const f = { id: uid('font'), name, family, data };
    try {
      await new FontFace(family, data).load();
    } catch {
      toast(`«${file.name}» ليس ملف خط صالحًا`, { kind: 'error' });
      continue;
    }
    const i = list.findIndex((x) => x.family === family);
    if (i >= 0) list[i] = f;
    else list.push(f);
    await registerFont(f);
    added++;
  }
  await setSetting('userFonts', list);
  return added;
}

export async function deleteFont(id) {
  const list = await listUserFonts();
  const f = list.find((x) => x.id === id);
  await setSetting('userFonts', list.filter((x) => x.id !== id));
  if (f && loadedFaces.has(f.family)) {
    document.fonts.delete(loadedFaces.get(f.family));
    loadedFaces.delete(f.family);
  }
}

export async function fontOptions() {
  return [...BUILTIN_FONTS, ...(await listUserFonts()).map((f) => [f.family, f.name])];
}

// ---------- المرشحات (LUT) ----------
export async function listUserLuts() {
  return (await getSetting('userLuts', [])) || [];
}

export async function saveLut(name, lut) {
  const list = await listUserLuts();
  const i = list.findIndex((x) => x.name === name);
  const rec = { id: i >= 0 ? list[i].id : uid('lut'), name, lut };
  if (i >= 0) list[i] = rec;
  else list.push(rec);
  await setSetting('userLuts', list);
  return rec;
}

export async function addLuts(files) {
  let added = 0;
  for (const f of files) {
    try {
      await saveLut(f.name.replace(/\.cube$/i, ''), parseCube(await f.text()));
      added++;
    } catch (e) {
      toast(`«${f.name}»: ${e.message}`, { kind: 'error' });
    }
  }
  return added;
}

export async function deleteLut(id) {
  await setSetting('userLuts', (await listUserLuts()).filter((x) => x.id !== id));
}

// ---------- الملصقات والصور ----------
export async function addStickers(app, files) {
  let added = 0;
  for (const f of files) {
    if (!/^image\//.test(f.type) && !/\.(png|jpe?g|webp|gif|svg)$/i.test(f.name)) continue;
    try {
      const { canvas } = await blobToCanvas(f, 2048);
      await saveElement({ src: canvas, mask: null, name: f.name.replace(/\.\w+$/, ''), category: 'sticker', tags: [], thumbCanvas: thumbnail(canvas, 200) });
      added++;
    } catch {
      toast(`تعذّر فتح «${f.name}»`, { kind: 'error' });
    }
  }
  app.emit('elements');
  return added;
}

// ---------- نافذة «موادي» ----------
export async function assetsDialog(app) {
  const body = h('div', { class: 'assets', 'data-testid': 'assets' });
  const rowOf = (title, sub, onDel, sample) => h('div', { class: 'asset-row', 'data-testid': 'asset-row' },
    h('div', { class: 'asset-info' }, sample || h('b', {}, title), h('span', { class: 'hint' }, sub)),
    h('button', { type: 'button', class: 'mini', 'aria-label': 'حذف ' + title, 'data-testid': 'asset-del', onclick: onDel }, icon('trash', 18)));
  const render = async () => {
    const fonts = await listUserFonts();
    const luts = await listUserLuts();
    body.replaceChildren(
      h('h3', { class: 'sub-h' }, icon('type', 18), 'خطوطي'),
      fonts.length ? null : h('p', { class: 'hint' }, 'لا خطوط مضافة. أضف ملفات ‎.ttf أو ‎.otf أو ‎.woff، فتظهر في قائمة الخطوط لطبقات النص.'),
      ...fonts.map((f) => rowOf(f.name, 'خط', async () => {
        if (!(await confirmDialog(`حذف الخط «${f.name}»؟ النصوص التي تستعمله تبقى كما رُسمت.`, { ok: 'حذف', danger: true }))) return;
        await deleteFont(f.id);
        render();
      }, h('span', { style: { fontFamily: `"${f.family}"`, fontSize: '20px' } }, f.name + ' · أبجد هوز'))),
      iconBtn('plus', 'إضافة خط', async () => {
        const files = await pickFiles({ accept: '.ttf,.otf,.woff,.woff2', multiple: true });
        if (!files.length) return;
        const n = await addFonts(files);
        if (n) toast(`أُضيف ${n} خط`, { kind: 'ok' });
        render();
      }, { testid: 'asset-add-font', cls: 'asset-add' }),

      h('h3', { class: 'sub-h' }, icon('palette', 18), 'مرشحاتي (LUT)'),
      luts.length ? null : h('p', { class: 'hint' }, 'لا مرشحات مضافة. أضف ملفات ‎.cube، فتظهر بلمسة واحدة في طبقة تعديل «LUT».'),
      ...luts.map((l) => rowOf(l.name, `مرشح ${l.lut.size}³`, async () => {
        if (!(await confirmDialog(`حذف المرشح «${l.name}»؟`, { ok: 'حذف', danger: true }))) return;
        await deleteLut(l.id);
        render();
      })),
      iconBtn('plus', 'إضافة مرشح', async () => {
        const files = await pickFiles({ accept: '.cube', multiple: true });
        if (!files.length) return;
        const n = await addLuts(files);
        if (n) toast(`أُضيف ${n} مرشح`, { kind: 'ok' });
        render();
      }, { testid: 'asset-add-lut', cls: 'asset-add' }),

      h('h3', { class: 'sub-h' }, icon('sticker', 18), 'ملصقاتي وصوري'),
      h('p', { class: 'hint' }, 'صور PNG وJPG وWebP وSVG وGIF (تُحفظ صورة ثابتة من أول إطار). تظهر في تبويب «العناصر» تحت «ملصقات وصور»، وتُحذف من زر ⋮ على كل عنصر.'),
      iconBtn('plus', 'إضافة ملصقات وصور', async () => {
        const files = await pickFiles({ accept: 'image/*,.svg,.gif', multiple: true });
        if (!files.length) return;
        const b = busy('جارِ الإضافة…');
        try {
          const n = await addStickers(app, files);
          if (n) toast(`أُضيف ${n} إلى «العناصر»`, { kind: 'ok' });
        } finally {
          b.done();
        }
      }, { testid: 'asset-add-sticker', cls: 'asset-add' })
    );
  };
  await render();
  await modal('موادي: خطوط ومرشحات وملصقات', body, [{ label: 'تم', value: null, primary: true, testid: 'assets-done' }]);
  app.emit('props-refresh');
}

// ---------- طبقة النص ----------
const AR = /[؀-ۿ]/;
export function defaultText(value) {
  return { value, font: 'Tajawal', size: 96, color: '#ffffff', bold: true, align: 'center', lineHeight: 1.35, stroke: 0, strokeColor: '#000000', shadow: true };
}

/** يرسم النص في لوحة شفافة مقصوصة على حدوده (بهامش للحد والظل) */
export function renderText(t) {
  const lines = String(t.value || ' ').split('\n');
  const font = `${t.bold ? 700 : 400} ${t.size}px "${t.font}", Tajawal, sans-serif`;
  const probe = ctx2d(mk(1, 1));
  probe.font = font;
  const widths = lines.map((l) => probe.measureText(l).width);
  const lh = t.size * t.lineHeight;
  const pad = Math.ceil(t.size * 0.25 + t.stroke * 2 + (t.shadow ? t.size * 0.12 : 0));
  const W = Math.max(8, Math.ceil(Math.max(...widths) + pad * 2));
  const H = Math.max(8, Math.ceil(lh * lines.length + pad * 2));
  const c = mk(W, H);
  const g = ctx2d(c);
  g.font = font;
  g.textBaseline = 'middle';
  g.direction = AR.test(t.value) ? 'rtl' : 'ltr';
  g.textAlign = t.align === 'center' ? 'center' : t.align === 'right' ? 'right' : 'left';
  const x = t.align === 'center' ? W / 2 : t.align === 'right' ? W - pad : pad;
  lines.forEach((line, i) => {
    const y = pad + lh * i + lh / 2;
    if (t.shadow) {
      g.save();
      g.shadowColor = 'rgba(0,0,0,.55)';
      g.shadowBlur = t.size * 0.12;
      g.shadowOffsetY = t.size * 0.04;
      g.fillStyle = t.color;
      g.fillText(line, x, y);
      g.restore();
    }
    if (t.stroke > 0) {
      g.lineJoin = 'round';
      g.lineWidth = t.stroke * 2;
      g.strokeStyle = t.strokeColor;
      g.strokeText(line, x, y);
    }
    g.fillStyle = t.color;
    g.fillText(line, x, y);
  });
  return c;
}

async function ensureFont(t) {
  try {
    await document.fonts.load(`${t.bold ? 700 : 400} ${t.size}px "${t.font}"`, t.value);
  } catch {}
}

export async function addTextLayer(app, at, value) {
  const v = value ?? (await promptDialog('اكتب النص', '', { placeholder: 'نص جديد' }));
  if (!v) return null;
  const doc = app.doc;
  const t = defaultText(v);
  t.size = Math.max(24, Math.round(Math.min(doc.width, doc.height) / 10));
  await ensureFont(t);
  const l = createImageLayer(renderText(t), { name: 'نص: ' + v.slice(0, 20), doc });
  l.text = t;
  if (at) {
    l.x = at.x;
    l.y = at.y;
  }
  app.addLayer(l, { label: 'نص جديد' });
  app.showTab?.('props');
  return l;
}

function rerender(l) {
  l.src = renderText(l.text);
  // القناع والترميم مرسومان على الشكل القديم؛ مع تغيّر المقاس لا يصلحان
  if (l.mask && (l.mask.width !== l.src.width || l.mask.height !== l.src.height)) l.mask = null;
  if (l.retouch && (l.retouch.width !== l.src.width || l.retouch.height !== l.src.height)) l.retouch = null;
}

async function textEditor(app, l) {
  const t = l.text;
  const area = h('textarea', { class: 'text', rows: 2, 'data-testid': 'text-value', style: { width: '100%', resize: 'vertical' } });
  area.value = t.value;
  let began = false;
  area.addEventListener('focus', () => (began = false));
  area.addEventListener('input', () => {
    if (!began) {
      app.checkpoint('تعديل النص');
      began = true;
    }
    t.value = area.value;
    l.name = 'نص: ' + area.value.slice(0, 20);
    rerender(l);
    app.changed({ save: false, structure: true });
  });
  area.addEventListener('change', () => app.changed());
  const set = (label, k, v) => app.edit(label, () => {
    t[k] = v;
    rerender(l);
  });
  const fonts = await fontOptions();
  if (!fonts.some(([f]) => f === t.font)) fonts.push([t.font, t.font + ' (غير موجود)']);
  const fontSel = selectBox(fonts, t.font, async (v) => {
    await ensureFont({ ...t, font: v });
    set('الخط', 'font', v);
  }, { label: 'الخط', testid: 'text-font' });
  const color = (k, label, testid) => {
    const inp = h('input', { type: 'color', value: t[k], 'data-testid': testid, 'aria-label': label });
    inp.addEventListener('change', () => set(label, k, inp.value));
    return h('label', { class: 'field' }, h('span', {}, label), inp);
  };
  const seg = h('div', { class: 'segmented', 'data-testid': 'text-align' }, [['right', 'يمين'], ['center', 'وسط'], ['left', 'يسار']].map(([v, txt]) =>
    h('button', { type: 'button', class: t.align === v ? 'on' : '', 'data-v': v, onclick: () => { set('محاذاة النص', 'align', v); app.emit('props-refresh'); } }, txt)));
  const slide = (k, label, min, max, testid) => propSlider(app, t, k, { label, min, max, testid, set: (v) => { t[k] = v; rerender(l); }, structure: true });
  return h('div', { class: 'form' },
    area,
    h('div', { class: 'row', style: { gap: '6px', alignItems: 'flex-end' } }, h('div', { style: { flex: 1 } }, fontSel),
      iconBtn('font', 'خطوطي', () => assetsDialog(app), { testid: 'text-myfonts' })),
    slide('size', 'الحجم', 8, 600, 'text-size'),
    h('div', { class: 'row', style: { gap: '8px' } }, color('color', 'اللون', 'text-color'), color('strokeColor', 'لون الحد', 'text-stroke-color')),
    slide('stroke', 'سماكة الحد', 0, 30, 'text-stroke'),
    seg,
    toggle('عريض', t.bold, (v) => set('عريض', 'bold', v), 'text-bold'),
    toggle('ظل خفيف', t.shadow, (v) => set('ظل النص', 'shadow', v), 'text-shadow'));
}

class TextTool {
  constructor() {
    this.label = 'نص';
  }
  options() {
    return h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
      h('span', { class: 'hint' }, 'المس مكان النص على الصورة. غيّر خطه ولونه وحجمه من «الخصائص».'),
      iconBtn('font', 'خطوطي', () => assetsDialog(this.app), { testid: 'text-assets' }));
  }
  async down(e) {
    // ننتقل لأداة النقل أولًا حتى تبقى إضافة النص وتعديلاته في معاينة واحدة (✓ أو ✗)
    this.app.setTool('move');
    await addTextLayer(this.app, { x: e.x, y: e.y });
  }
  move() {}
  up() {}
}

export default {
  async install({ app, toolDefs, menuItems }) {
    // تحميل خطوط المستخدم المحفوظة
    for (const f of await listUserFonts()) registerFont(f);
    app.registerTool('text', new TextTool());
    toolDefs.push({ name: 'text', icon: 'type', label: 'نص', key: 't' });
    menuItems.push({ icon: 'package', label: 'موادي: خطوط ومرشحات وملصقات', run: () => assetsDialog(app), testid: 'm-assets' });
    registerSection({
      id: 'text',
      title: 'النص',
      order: 1,
      when: (l) => l.type === 'image' && l.text,
      build: (l) => {
        const host = h('div', {});
        textEditor(app, l).then((el) => host.append(el));
        return host;
      }
    });
  }
};
