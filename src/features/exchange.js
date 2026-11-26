// المرحلة 6 (ب): تصدير PSD واستيراده، والتوليد بالذكاء الاصطناعي الخارجي، والإرسال إلى برنامج الصور المتحركة
import { writePsd, readPsd } from 'ag-psd';
import { zipSync, strToU8 } from 'fflate';
import { h, iconBtn, modal, toast, busy, downloadBlob, selectBox, promptDialog } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { importers, exportFormats } from '../ui/io.js';
import { registerSection } from '../ui/props.js';
import { mk, ctx2d, canvasToBlob, blobToCanvas, opaqueBounds, cropCanvas, getData } from '../core/canvas.js';
import { createDoc, createImageLayer, createGroup, layerMatrix, allLayers } from '../core/doc.js';
import { getSetting, setSetting } from '../core/store.js';

const PSD_BLEND = {
  normal: 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay', 'soft-light': 'soft light', 'hard-light': 'hard light',
  darken: 'darken', lighten: 'lighten', 'color-dodge': 'color dodge', 'color-burn': 'color burn', difference: 'difference', exclusion: 'exclusion',
  hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity'
};
const FROM_PSD = Object.fromEntries(Object.entries(PSD_BLEND).map(([a, b]) => [b, a]));

// ---------- تصدير الطبقات إلى فضاء المستند ----------
/** يرسم طبقة واحدة في فضاء المستند ويقصها إلى حدودها */
function layerDocPixels(app, l, scale, { maskOn } = {}) {
  const doc = app.doc;
  const W = Math.round(doc.width * scale);
  const H = Math.round(doc.height * scale);
  const tmp = { ...doc, background: null, layers: [{ ...l, visible: true, opacity: 1, blend: 'normal', ...(maskOn === false ? { maskOn: false } : {}) }] };
  // الظلال تحتاج مرجعها
  if (l.type === 'shadow') tmp.layers = [...allLayers(doc.layers).filter((x) => x.id === l.ref).map((x) => ({ ...x, visible: false })), { ...l, visible: true, opacity: 1, blend: 'normal' }];
  const c = app.renderer.renderDoc(tmp, { scale, background: false });
  const b = opaqueBounds(c, 0);
  if (!b) return null;
  return { canvas: cropCanvas(c, b), left: b.x, top: b.y, W, H };
}

function maskToPsdCanvas(app, l, scale, box) {
  // قناع الطبقة بعد التحويل إلى فضاء المستند، رمادي معتم كما يتوقعه فوتوشوب
  const c = mk(box.w, box.h);
  const g = ctx2d(c);
  g.fillStyle = '#000';
  g.fillRect(0, 0, box.w, box.h);
  const m = layerMatrix(l);
  g.setTransform(m[0] * scale, m[1] * scale, m[2] * scale, m[3] * scale, m[4] * scale - box.x, m[5] * scale - box.y);
  g.drawImage(l.mask, 0, 0);
  return c;
}

export async function exportPsd(app, { scale = 1 } = {}) {
  const doc = app.doc;
  const S = Math.min(scale, 1);
  const W = Math.round(doc.width * S);
  const H = Math.round(doc.height * S);
  const hasAdjust = allLayers(doc.layers).some((l) => l.type === 'adjust' && l.visible);
  const conv = (list) => {
    const out = [];
    for (const l of list) {
      if (l.type === 'group') {
        out.push({ name: l.name, opened: true, hidden: !l.visible, opacity: l.opacity, blendMode: PSD_BLEND[l.blend] || 'normal', children: conv(l.children) });
        continue;
      }
      if (l.type === 'adjust') continue; // تُدمج في الطبقة النهائية أدناه
      // القناع يُصدَّر قناعًا حقيقيًا قابلًا للتعديل إذا لم يكن هناك تشويه أو ضبابية تغيّر الحافة
      const editableMask = l.type === 'image' && l.mask && l.maskOn && !l.warp && !(l.fx?.blur > 0);
      const px = layerDocPixels(app, l, S, { maskOn: editableMask ? false : undefined });
      if (!px) continue;
      const layer = { name: l.name, canvas: px.canvas, left: px.left, top: px.top, opacity: l.opacity, hidden: !l.visible, blendMode: PSD_BLEND[l.blend] || 'normal' };
      if (editableMask) {
        const box = { x: px.left, y: px.top, w: px.canvas.width, h: px.canvas.height };
        layer.mask = { left: box.x, top: box.y, right: box.x + box.w, bottom: box.y + box.h, defaultColor: 0, canvas: maskToPsdCanvas(app, l, S, box) };
      }
      out.push(layer);
    }
    return out;
  };
  const children = conv(doc.layers);
  if (doc.background) {
    const bg = mk(W, H);
    const g = ctx2d(bg);
    g.fillStyle = doc.background;
    g.fillRect(0, 0, W, H);
    children.unshift({ name: 'الخلفية', canvas: bg, left: 0, top: 0 });
  }
  const composite = app.renderer.renderDoc(doc, { scale: S });
  if (hasAdjust) {
    children.push({ name: 'النتيجة مع طبقات التعديل (مسطحة)', canvas: composite, left: 0, top: 0, hidden: false });
  }
  const psd = { width: W, height: H, children, canvas: composite };
  const buf = writePsd(psd, { generateThumbnail: true, noBackground: !doc.background });
  return new Blob([buf], { type: 'image/vnd.adobe.photoshop' });
}

export async function importPsd(app, file) {
  const buf = await file.arrayBuffer();
  const psd = readPsd(buf, { skipThumbnail: true });
  const doc = createDoc({ width: psd.width, height: psd.height, name: file.name.replace(/\.psd$/i, ''), background: null });
  let skipped = 0;
  const conv = (list) => {
    const out = [];
    for (const c of list || []) {
      if (c.children) {
        const g = createGroup(c.name || 'مجموعة');
        g.visible = !c.hidden;
        g.opacity = c.opacity ?? 1;
        g.blend = FROM_PSD[c.blendMode] || 'normal';
        g.children = conv(c.children);
        out.push(g);
        continue;
      }
      if (!c.canvas || !c.canvas.width) {
        skipped++;
        continue;
      }
      const l = createImageLayer(c.canvas, { name: c.name || 'طبقة', x: (c.left || 0) + c.canvas.width / 2, y: (c.top || 0) + c.canvas.height / 2 });
      l.visible = !c.hidden;
      l.opacity = c.opacity ?? 1;
      l.blend = FROM_PSD[c.blendMode] || 'normal';
      if (c.mask?.canvas && !c.mask.disabled) {
        // قناع فوتوشوب (رمادي) إلى قناع ألفا بحجم الطبقة
        const m = mk(c.canvas.width, c.canvas.height);
        const g = ctx2d(m);
        g.fillStyle = (c.mask.defaultColor ?? 255) > 127 ? '#fff' : 'rgba(0,0,0,0)';
        g.fillRect(0, 0, m.width, m.height);
        const mc = c.mask.canvas;
        const d = getData(mc);
        for (let i = 0; i < d.data.length; i += 4) {
          d.data[i + 3] = d.data[i];
          d.data[i] = d.data[i + 1] = d.data[i + 2] = 255;
        }
        const t = mk(mc.width, mc.height);
        ctx2d(t).putImageData(d, 0, 0);
        g.globalCompositeOperation = 'copy';
        g.drawImage(t, (c.mask.left || 0) - (c.left || 0), (c.mask.top || 0) - (c.top || 0));
        l.mask = m;
      }
      out.push(l);
    }
    return out;
  };
  doc.layers = conv(psd.children);
  // طبقة خلفية بلون واحد تغطي اللوحة (كما نصدّرها) تعود لون خلفية لا طبقة
  const first = doc.layers[0];
  if (first?.type === 'image' && first.src.width === psd.width && first.src.height === psd.height && !first.mask) {
    const d = getData(first.src).data;
    let uniform = d[3] === 255;
    for (let i = 4; uniform && i < d.length; i += 4 * 97) uniform = d[i] === d[0] && d[i + 1] === d[1] && d[i + 2] === d[2] && d[i + 3] === 255;
    if (uniform) {
      doc.background = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
      doc.layers.shift();
    }
  }
  if (!doc.layers.length && psd.canvas) doc.layers = [createImageLayer(psd.canvas, { name: 'الصورة', doc })];
  app.setDoc(doc);
  await app.saveNow();
  toast(`فُتح ملف PSD: ${allLayers(doc.layers).length} طبقة` + (skipped ? ` (تُركت ${skipped} طبقة نص/تعديل لم تُدعم)` : ''), { ms: 5000 });
}

// ---------- حزمة طبقات لبرنامج الصور المتحركة ----------
export async function exportLayersPackage(app, { scale = 1 } = {}) {
  const doc = app.doc;
  const S = Math.min(scale, 1);
  const files = {};
  const layers = [];
  let n = 0;
  const walk = async (list, group) => {
    for (const l of list) {
      if (l.type === 'group') {
        await walk(l.children, (group ? group + '/' : '') + l.name);
        continue;
      }
      if (l.type === 'adjust') continue;
      const px = layerDocPixels(app, l, S);
      if (!px) continue;
      const file = `layers/${String(++n).padStart(3, '0')}.png`;
      files[file] = new Uint8Array(await (await canvasToBlob(px.canvas)).arrayBuffer());
      layers.push({ id: l.id, name: l.name, type: l.type, group: group || null, file, x: px.left, y: px.top, width: px.canvas.width, height: px.canvas.height, opacity: l.opacity, blend: l.blend, visible: l.visible });
    }
  };
  await walk(doc.layers, null);
  const comp = app.renderer.renderDoc(doc, { scale: S });
  files['preview.png'] = new Uint8Array(await (await canvasToBlob(comp)).arrayBuffer());
  const manifest = {
    format: 'lawha-layers',
    version: 1,
    app: 'لوحة',
    name: doc.name,
    width: Math.round(doc.width * S),
    height: Math.round(doc.height * S),
    background: doc.background,
    note: 'الطبقات مرتبة من الأسفل إلى الأعلى. كل طبقة صورة PNG شفافة مقصوصة إلى حدودها، وموضعها (x,y) في إحداثيات اللوحة. طبقات التعديل مدمجة في preview.png فقط.',
    layers
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  return new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });
}

// ---------- التوليد بالذكاء الاصطناعي الخارجي ----------
export const PROVIDERS = [
  ['openai', 'OpenAI (gpt-image-1)'],
  ['stability', 'Stability AI (Inpaint)'],
  ['custom', 'خادم مخصص (JSON)']
];

export async function genSettingsDialog() {
  const cfg = (await getSetting('gen', null)) || { provider: 'openai', key: '', model: 'gpt-image-1', url: '' };
  const key = h('input', { type: 'password', class: 'text', value: cfg.key, placeholder: 'المفتاح السري', 'data-testid': 'gen-key', autocomplete: 'off' });
  const model = h('input', { type: 'text', class: 'text', value: cfg.model || '' });
  const url = h('input', { type: 'url', class: 'text', value: cfg.url || '', placeholder: 'https://…', 'data-testid': 'gen-url' });
  let provider = cfg.provider;
  const urlRow = h('label', { class: 'field' }, h('span', {}, 'عنوان الخادم المخصص'), url);
  const body = h('div', { class: 'form' },
    selectBox(PROVIDERS, provider, (v) => { provider = v; urlRow.style.display = v === 'custom' ? '' : 'none'; }, { label: 'الخدمة', testid: 'gen-provider' }),
    h('label', { class: 'field' }, h('span', {}, 'المفتاح (API key)'), key),
    h('label', { class: 'field' }, h('span', {}, 'النموذج (اختياري)'), model),
    urlRow,
    h('p', { class: 'hint' }, 'المفتاح يُحفظ على جهازك فقط، ولا يُرسل إلا إلى الخدمة التي اخترتها عند ضغط «توليد». تُرسل منطقة الصورة المحددة ووصفك النصي فقط.'));
  urlRow.style.display = provider === 'custom' ? '' : 'none';
  const ok = await modal('إعدادات التوليد', body, [{ label: 'إلغاء', value: false }, { label: 'حفظ', value: true, primary: true, testid: 'gen-save' }]);
  if (!ok) return null;
  const next = { provider, key: key.value.trim(), model: model.value.trim(), url: url.value.trim() };
  await setSetting('gen', next);
  return next;
}

/** مقاسات OpenAI المدعومة الأقرب لنسبة المنطقة */
function openaiSize(w, h) {
  const r = w / h;
  if (r > 1.25) return [1536, 1024];
  if (r < 0.8) return [1024, 1536];
  return [1024, 1024];
}

async function b64ToCanvas(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return (await blobToCanvas(new Blob([u8], { type: 'image/png' }))).canvas;
}

/**
 * يرسل المنطقة مع قناعها ووصفها، ويعيد لوحة بحجم المنطقة
 * region: لوحة المنطقة، mask: لوحة ألفا (معتم = يُعدَّل)
 */
export async function generate(cfg, region, mask, prompt) {
  const W = region.width;
  const H = region.height;
  if (cfg.provider === 'openai') {
    const [sw, sh] = openaiSize(W, H);
    const img = mk(sw, sh);
    ctx2d(img).drawImage(region, 0, 0, sw, sh);
    // قناع OpenAI: الشفاف = المنطقة التي تُعدَّل
    const m = mk(sw, sh);
    const mg = ctx2d(m);
    mg.drawImage(region, 0, 0, sw, sh);
    mg.globalCompositeOperation = 'destination-out';
    mg.drawImage(mask, 0, 0, sw, sh);
    const fd = new FormData();
    fd.append('model', cfg.model || 'gpt-image-1');
    fd.append('prompt', prompt);
    fd.append('size', `${sw}x${sh}`);
    fd.append('image', await canvasToBlob(img), 'image.png');
    fd.append('mask', await canvasToBlob(m), 'mask.png');
    const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.key }, body: fd });
    if (!res.ok) throw new Error(`OpenAI: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    const out = await b64ToCanvas(j.data[0].b64_json);
    const fin = mk(W, H);
    ctx2d(fin).drawImage(out, 0, 0, W, H);
    return fin;
  }
  if (cfg.provider === 'stability') {
    const m = mk(W, H);
    const mg = ctx2d(m);
    mg.fillStyle = '#000';
    mg.fillRect(0, 0, W, H);
    mg.drawImage(mask, 0, 0);
    const fd = new FormData();
    fd.append('prompt', prompt);
    fd.append('output_format', 'png');
    fd.append('image', await canvasToBlob(region), 'image.png');
    fd.append('mask', await canvasToBlob(m), 'mask.png');
    const res = await fetch('https://api.stability.ai/v2beta/stable-image/edit/inpaint', { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.key, Accept: 'image/*' }, body: fd });
    if (!res.ok) throw new Error(`Stability: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const out = (await blobToCanvas(await res.blob())).canvas;
    const fin = mk(W, H);
    ctx2d(fin).drawImage(out, 0, 0, W, H);
    return fin;
  }
  // خادم مخصص: JSON بسيط
  const toB64 = async (c) => {
    const b = await canvasToBlob(c);
    const u8 = new Uint8Array(await b.arrayBuffer());
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {}) },
    body: JSON.stringify({ prompt, width: W, height: H, image: await toB64(region), mask: await toB64(mask), model: cfg.model || undefined })
  });
  if (!res.ok) throw new Error(`الخادم: ${res.status}`);
  const j = await res.json();
  const out = await b64ToCanvas(j.image);
  const fin = mk(W, H);
  ctx2d(fin).drawImage(out, 0, 0, W, H);
  return fin;
}

/** أداة التوليد: ارسم مستطيلًا على اللوحة ثم اكتب الوصف */
class GenerateTool {
  constructor() {
    this.label = 'توليد';
    this.rect = null;
    this.drag = null;
  }
  options() {
    return h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
      h('span', { class: 'hint' }, 'اسحب مستطيلًا حول المنطقة التي تريد توليدها أو تغييرها، ثم اكتب وصفًا. النتيجة طبقة جديدة لا تمس الأصل.'),
      iconBtn('settings', 'إعدادات الخدمة', () => genSettingsDialog(), { testid: 'gen-settings' }));
  }
  down(e) {
    this.drag = { x0: e.x, y0: e.y };
    this.rect = { x: e.x, y: e.y, w: 0, h: 0 };
  }
  move(e) {
    if (!this.drag) return;
    const { x0, y0 } = this.drag;
    this.rect = { x: Math.min(x0, e.x), y: Math.min(y0, e.y), w: Math.abs(e.x - x0), h: Math.abs(e.y - y0) };
  }
  async up() {
    if (!this.drag) return;
    this.drag = null;
    const r = this.rect;
    const doc = this.app.doc;
    const x = Math.max(0, Math.floor(r.x));
    const y = Math.max(0, Math.floor(r.y));
    const w = Math.min(doc.width - x, Math.ceil(r.w));
    const hh = Math.min(doc.height - y, Math.ceil(r.h));
    if (w < 16 || hh < 16) {
      this.rect = null;
      return;
    }
    await runGenerate(this.app, { x, y, w, h: hh });
    this.rect = null;
    this.app.viewport.draw();
  }
  drawOverlay(g, vp) {
    if (!this.rect) return;
    const [x, y] = vp.toScreen(this.rect.x, this.rect.y);
    g.setLineDash([8, 6]);
    g.strokeStyle = '#ffd36b';
    g.lineWidth = 2;
    g.strokeRect(x, y, this.rect.w * vp.zoom, this.rect.h * vp.zoom);
    g.setLineDash([]);
  }
}

export async function runGenerate(app, rect, promptText) {
  let cfg = await getSetting('gen', null);
  if (!cfg?.key && cfg?.provider !== 'custom') {
    cfg = await genSettingsDialog();
    if (!cfg) return null;
  }
  const prompt = promptText ?? (await promptDialog('صف ما تريد توليده في المنطقة', '', { placeholder: 'مثال: غيوم ذهبية عند الغروب' }));
  if (!prompt) return null;
  const doc = app.doc;
  const b = busy('جارِ التوليد… قد يستغرق دقيقة');
  try {
    // ما تحت المنطقة من اللوحة الحالية
    const full = app.renderer.renderDoc(doc, { scale: 1 });
    const region = cropCanvas(full, rect);
    // القناع: المنطقة كلها مع حواف ناعمة
    const mask = mk(rect.w, rect.h);
    const mg = ctx2d(mask);
    mg.fillStyle = '#fff';
    mg.fillRect(0, 0, rect.w, rect.h);
    const out = await generate(cfg, region, mask, prompt);
    const l = createImageLayer(out, { name: 'توليد: ' + prompt.slice(0, 24), x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
    // قناع بحافة ناعمة لدمج النتيجة
    const feather = Math.max(2, Math.round(Math.min(rect.w, rect.h) * 0.06));
    const lm = mk(rect.w, rect.h);
    const lg = ctx2d(lm);
    lg.filter = `blur(${feather / 2}px)`;
    lg.fillStyle = '#fff';
    lg.fillRect(feather, feather, rect.w - 2 * feather, rect.h - 2 * feather);
    l.mask = lm;
    app.addLayer(l, { label: 'توليد بالذكاء الاصطناعي' });
    toast('النتيجة طبقة منفصلة: عدّلها أو اقصص منها ما تريد.', { kind: 'ok' });
    return l;
  } catch (e) {
    console.error(e);
    const msg = /Failed to fetch|NetworkError/.test(e.message) ? 'تعذّر الاتصال بالخدمة (تحقق من الإنترنت أو من سماح الخدمة بالاتصال من المتصفح)' : e.message;
    toast('فشل التوليد: ' + msg, { kind: 'error', ms: 7000 });
    return null;
  } finally {
    b.done();
  }
}

export default {
  install({ app, toolDefs, menuItems }) {
    importers.push({ test: (f) => /\.psd$/i.test(f.name), run: (app2, f) => importPsd(app2, f) });
    exportFormats.push(
      { id: 'psd', label: 'PSD (طبقات لفوتوشوب)', run: async (a, o) => downloadBlob(await exportPsd(a, o), `${a.doc.name || 'لوحة'}.psd`) },
      { id: 'layers', label: 'حزمة طبقات لبرنامج الصور المتحركة (.zip)', run: async (a, o) => downloadBlob(await exportLayersPackage(a, o), `${a.doc.name || 'لوحة'}-طبقات.zip`) }
    );
    app.registerTool('generate', new GenerateTool());
    toolDefs.push({ name: 'generate', icon: 'ai', label: 'توليد', key: 'g' });
    menuItems.push(
      { icon: 'film', label: 'إرسال إلى برنامج الصور المتحركة', testid: 'm-anim', run: async () => {
        const b = busy('جارِ تجهيز الطبقات…');
        try {
          downloadBlob(await exportLayersPackage(app), `${app.doc.name || 'لوحة'}-طبقات.zip`);
          toast('حُفظت حزمة الطبقات. افتحها من برنامج الصور المتحركة ← استيراد.');
        } finally {
          b.done();
        }
      } },
      { icon: 'cloud', label: 'إعدادات التوليد بالذكاء الاصطناعي', run: () => genSettingsDialog(), testid: 'm-gen' }
    );
  }
};
