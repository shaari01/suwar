import '@fontsource/tajawal/arabic-400.css';
import '@fontsource/tajawal/arabic-500.css';
import '@fontsource/tajawal/arabic-700.css';
import '@fontsource/tajawal/latin-400.css';
import '@fontsource/tajawal/latin-700.css';
import './styles.css';
import { App } from './app.js';
import { Viewport } from './ui/viewport.js';
import { LayersPanel } from './ui/layers.js';
import { PropsPanel } from './ui/props.js';
import { h, iconBtn, toast, modal } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { MoveTool, HandTool } from './tools/move.js';
import { importDialog, exportDialog, projectsDialog, bindDropAndPaste, saveProjectFile, newDocDialog } from './ui/io.js';
import { duplicateLayer, deleteLayer, flattenImage, rasterizeLayer } from './core/ops.js';
import { createDoc } from './core/doc.js';
import { getSetting, loadProject, requestPersist } from './core/store.js';
import { features } from './features.js';

export const toolDefs = [
  { name: 'move', icon: 'move', label: 'نقل', key: 'v' },
  { name: 'hand', icon: 'hand', label: 'تحريك العرض', key: 'h' }
];
export const sideTabs = [];
export const menuItems = [];

async function boot() {
  const app = new App();
  window.__app = app; // للاختبارات الآلية
  app.registerTool('move', new MoveTool());
  app.registerTool('hand', new HandTool());

  // ---------- الهيكل ----------
  const projName = h('button', { class: 'proj-name', type: 'button', 'data-testid': 'proj-name', onclick: () => projectsDialog(app) });
  const saveState = h('span', { class: 'save-state', 'data-testid': 'save-state' }, '');
  const undoB = iconBtn('undo', 'تراجع', () => app.undo(), { testid: 'undo', showLabel: false });
  const redoB = iconBtn('redo', 'إعادة', () => app.redo(), { testid: 'redo', showLabel: false });
  const menuB = iconBtn('menu', 'القائمة', () => openMenu(app), { testid: 'menu', showLabel: false });
  const top = h(
    'header',
    { class: 'topbar' },
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon.svg', alt: '', width: 34, height: 34 }), projName, saveState),
    h('div', { class: 'tb-actions' },
      undoB,
      redoB,
      iconBtn('import', 'استيراد', () => importDialog(app), { testid: 'import' }),
      iconBtn('export', 'تصدير', () => exportDialog(app), { testid: 'export' }),
      menuB
    )
  );

  const rail = h('nav', { class: 'toolrail', 'aria-label': 'الأدوات', 'data-testid': 'toolrail' });
  const stage = h('main', { class: 'stage' });
  const optBar = h('div', { class: 'toolopts', 'data-testid': 'toolopts' });
  const viewHost = h('div', { class: 'viewhost' });
  const zoomLbl = h('button', { class: 'zoom-lbl', type: 'button', title: 'ملاءمة الشاشة', onclick: () => app.viewport.fit() }, '100٪');
  const zoomBar = h('div', { class: 'zoombar' },
    iconBtn('zoomOut', 'تصغير', () => app.viewport.setZoom(app.viewport.zoom / 1.25), { showLabel: false }),
    zoomLbl,
    iconBtn('zoomIn', 'تكبير', () => app.viewport.setZoom(app.viewport.zoom * 1.25), { showLabel: false }),
    iconBtn('fit', 'ملاءمة', () => app.viewport.fit(), { showLabel: false })
  );
  // شريط المعاينة: يظهر بعد أي تعديل تأثيري، ✓ يعتمد و✗ يلغي (مثل VivaVideo)
  const reviewLbl = h('span', { class: 'rv-lbl' });
  const reviewBar = h('div', { class: 'reviewbar', 'data-testid': 'reviewbar', hidden: true },
    h('button', { type: 'button', class: 'rv-btn rv-cancel', 'aria-label': 'إلغاء', title: 'إلغاء التعديل', 'data-testid': 'review-cancel' }, icon('x', 22)),
    reviewLbl,
    h('button', { type: 'button', class: 'rv-btn rv-ok', 'aria-label': 'اعتماد', title: 'اعتماد التعديل', 'data-testid': 'review-ok' }, icon('check', 22)));
  // يستجيب عند رفع الإصبع مباشرة (أسرع من click، ولا يضيع بعد سحب منزلق)
  for (const b of reviewBar.querySelectorAll('.rv-btn')) {
    const act = b.classList.contains('rv-ok') ? () => app.acceptReview() : () => app.cancelReview();
    let downOn = false;
    b.addEventListener('pointerdown', () => (downOn = true));
    b.addEventListener('pointerup', () => { if (downOn) { downOn = false; act(); } });
    b.addEventListener('pointerleave', () => (downOn = false));
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
  }
  app.on('review', () => {
    reviewBar.hidden = !app.review;
    if (app.review) reviewLbl.textContent = 'معاينة: ' + app.review.label;
  });
  stage.append(optBar, viewHost, reviewBar, zoomBar);

  const side = h('aside', { class: 'side', 'data-testid': 'side' });
  const tabsBar = h('div', { class: 'tabs', role: 'tablist' });
  const panes = h('div', { class: 'panes' });
  side.append(tabsBar, panes);

  const shell = h('div', { class: 'shell' }, top, h('div', { class: 'main' }, rail, stage, side));
  document.getElementById('app').replaceChildren(shell);

  // الشريط السفلي في الجوال: فتح اللوحات
  const sheetBtn = h('button', { class: 'sheet-toggle', type: 'button', 'data-testid': 'sheet-toggle', onclick: () => document.body.classList.toggle('sheet-open') }, icon('layers', 26), h('span', {}, 'اللوحات'));
  rail.append(sheetBtn);

  app.viewport = new Viewport(app, viewHost);
  bindDropAndPaste(app, stage);

  // ---------- التبويبات ----------
  const layersPane = h('div', { class: 'pane', 'data-pane': 'layers' });
  const propsPane = h('div', { class: 'pane', 'data-pane': 'props' });
  app.layersPanel = new LayersPanel(app, layersPane);
  new PropsPanel(app, propsPane);
  sideTabs.unshift({ id: 'layers', label: 'الطبقات', icon: 'layers', el: layersPane }, { id: 'props', label: 'الخصائص', icon: 'sliders', el: propsPane });

  // ---------- المراحل الإضافية ----------
  for (const f of features) await f.install?.({ app, toolDefs, sideTabs, menuItems, stage });

  let activeTab = 'layers';
  const showTab = (id) => {
    activeTab = id;
    for (const b of tabsBar.children) b.classList.toggle('on', b.dataset.tab === id);
    for (const t of sideTabs) t.el.style.display = t.id === id ? '' : 'none';
  };
  for (const t of sideTabs) {
    tabsBar.append(h('button', { class: 'tab', type: 'button', role: 'tab', 'data-tab': t.id, 'data-testid': 'tab-' + t.id, onclick: () => showTab(t.id) }, icon(t.icon, 22), h('span', {}, t.label)));
    panes.append(t.el);
  }
  showTab('layers');
  app.showTab = (id) => {
    showTab(id);
    document.body.classList.add('sheet-open');
  };

  // ---------- الأدوات ----------
  const toolBtns = {};
  for (const t of toolDefs) {
    const b = iconBtn(t.icon, t.label, () => app.setTool(t.name), { cls: 'tool', testid: 'tool-' + t.name, title: t.label + (t.key ? ` (${t.key.toUpperCase()})` : '') });
    toolBtns[t.name] = b;
    rail.insertBefore(b, sheetBtn);
  }
  const syncTool = () => {
    for (const [n, b] of Object.entries(toolBtns)) b.classList.toggle('on', n === app.toolName);
    optBar.replaceChildren();
    const t = app.tool;
    const opts = t?.options?.();
    if (opts) optBar.append(opts);
    else optBar.append(h('span', { class: 'hint' }, t?.label || ''));
  };
  app.on('tool', syncTool);
  app.on('select', () => app.tool?.onSelect?.() );
  app.on('tool-options', syncTool);

  // ---------- الحالة ----------
  const syncHist = () => {
    undoB.disabled = !app.history.canUndo();
    redoB.disabled = !app.history.canRedo();
    undoB.title = app.history.canUndo() ? 'تراجع: ' + app.history.lastLabel() : 'تراجع';
  };
  app.on('history', syncHist);
  app.on('doc', () => (projName.textContent = app.doc.name));
  app.on('saving', (s) => (saveState.textContent = s ? 'جارِ الحفظ…' : 'محفوظ ✓'));
  app.on('zoom', (z) => (zoomLbl.textContent = Math.round(z * 100) + '٪'));
  app.on('error', (e) => toast(e.message || String(e), { kind: 'error' }));
  syncHist();

  // ---------- لوحة المفاتيح ----------
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input,textarea,select,[contenteditable]')) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); app.undo(); }
    else if ((mod && k === 'y') || (mod && e.shiftKey && k === 'z')) { e.preventDefault(); app.redo(); }
    else if (mod && k === 'j') { e.preventDefault(); duplicateLayer(app); }
    else if (mod && k === 'e') { e.preventDefault(); exportDialog(app); }
    else if (mod && k === 'o') { e.preventDefault(); importDialog(app); }
    else if (mod && k === 's') { e.preventDefault(); app.saveNow().then(() => toast('حُفظ المشروع')); }
    else if ((k === 'delete' || k === 'backspace') && app.selected) { e.preventDefault(); deleteLayer(app); }
    else if (k === '0' && mod) { e.preventDefault(); app.viewport.fit(); }
    else if (!mod && !e.altKey) {
      const t = toolDefs.find((t) => t.key === k);
      if (t) app.setTool(t.name);
      else app.tool?.key?.(e);
    }
  });

  // ---------- فتح آخر مشروع ----------
  try {
    const last = await getSetting('lastProject');
    const doc = last ? await loadProject(last) : null;
    if (doc) app.setDoc(doc);
    else {
      const d = createDoc();
      d.untouched = true;
      app.setDoc(d);
    }
  } catch (e) {
    console.error(e);
    const d = createDoc();
    d.untouched = true;
    app.setDoc(d);
  }
  app.setTool('move');
  requestPersist();
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && app.dirty) app.saveNow();
  });

  // ملفات مفتوحة عبر «فتح بواسطة» (File Handling API) في ويندوز
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      const files = await Promise.all((params.files || []).map((fh) => fh.getFile()));
      const { importFiles } = await import('./ui/io.js');
      importFiles(app, files);
    });
  }
  document.body.classList.add('ready');
}

function openMenu(app) {
  const items = [
    { icon: 'open', label: 'مشاريعي', run: () => projectsDialog(app), testid: 'm-projects' },
    { icon: 'newFile', label: 'لوحة جديدة', run: () => newDocDialog(app), testid: 'm-new' },
    { icon: 'save', label: 'حفظ ملف المشروع (.lawha)', run: () => saveProjectFile(app), testid: 'm-savefile' },
    { icon: 'layers2', label: 'تسطيح الطبقة المحددة', run: () => rasterizeLayer(app) },
    { icon: 'image', label: 'تسطيح اللوحة كلها', run: () => flattenImage(app) },
    ...menuItems,
    { icon: 'info', label: 'حول البرنامج', run: () => aboutDialog() }
  ];
  const list = h('div', { class: 'menu-list' });
  const body = h('div', {}, list);
  const p = modal('القائمة', body, []);
  for (const it of items) {
    list.append(h('button', { class: 'menu-item', type: 'button', 'data-testid': it.testid, onclick: () => { body.closeModal(null); it.run(); } }, icon(it.icon, 24), h('span', {}, it.label)));
  }
  return p;
}

function aboutDialog() {
  modal('حول «لوحة»', h('div', { class: 'about' },
    h('p', {}, 'برنامج شخصي لقصّ العناصر من الصور وتركيبها في لوحة واحدة منسجمة.'),
    h('p', {}, 'يعمل بلا إنترنت بعد التحميل الأول، وكل ملفاتك محفوظة على جهازك فقط.'),
    h('p', { class: 'hint' }, 'الإصدار ' + __APP_VERSION__)
  ));
}

boot();
