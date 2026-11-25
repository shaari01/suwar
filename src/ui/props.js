// لوحة الخصائص. كل مرحلة تضيف أقسامها عبر registerSection
import { h, slider, selectBox, iconBtn, toggle } from './dom.js';
import { BLEND_MODES } from '../core/doc.js';
import { fitLayerToDoc } from '../core/ops.js';

export const sections = []; // [{ id, title, order, when(layer, app), build(layer, app) => Element }]

export function registerSection(s) {
  sections.push(s);
  sections.sort((a, b) => (a.order || 0) - (b.order || 0));
}

/** منزلق مرتبط بخاصية مع دعم التراجع */
export function propSlider(app, obj, key, opts) {
  return slider({
    ...opts,
    value: opts.get ? opts.get() : obj[key],
    onStart: () => app.checkpoint(opts.label),
    onInput: (v) => {
      if (opts.set) opts.set(v);
      else obj[key] = v;
      app.changed({ save: false, structure: false });
    },
    onChange: () => app.changed({ structure: !!opts.structure })
  });
}

export function section(title, body, { open = true, id } = {}) {
  const d = h('details', { class: 'psec', open, 'data-sec': id }, h('summary', {}, title), h('div', { class: 'psec-body' }, body));
  return d;
}

export class PropsPanel {
  constructor(app, host) {
    this.app = app;
    this.el = h('div', { class: 'props-panel', 'data-testid': 'props-panel' });
    host.append(this.el);
    this.openState = {};
    app.on('select', () => this.render());
    app.on('restored', () => this.render());
    app.on('doc', () => this.render());
    app.on('props-refresh', () => this.render());
    this.render();
  }

  render() {
    const app = this.app;
    const l = app.selected;
    // نحفظ حالة فتح الأقسام
    this.el.querySelectorAll('details[data-sec]').forEach((d) => (this.openState[d.dataset.sec] = d.open));
    this.el.replaceChildren();
    if (!l) {
      this.el.append(docSection(app));
      return;
    }
    this.el.append(basicSection(app, l));
    for (const s of sections) {
      if (s.when && !s.when(l, app)) continue;
      const body = s.build(l, app);
      if (!body) continue;
      const open = this.openState[s.id] ?? s.open ?? true;
      this.el.append(section(s.title, body, { open, id: s.id }));
    }
  }
}

function basicSection(app, l) {
  const name = h('input', { class: 'text', type: 'text', value: l.name, 'aria-label': 'اسم الطبقة' });
  name.addEventListener('change', () => app.edit('إعادة تسمية', () => (l.name = name.value || l.name)));
  const body = h(
    'div',
    {},
    h('label', { class: 'field' }, h('span', {}, 'الاسم'), name),
    propSlider(app, l, 'opacity', { label: 'الشفافية', min: 0, max: 100, step: 1, get: () => Math.round(l.opacity * 100), set: (v) => (l.opacity = v / 100), unit: '٪', testid: 'opacity', structure: true }),
    selectBox(BLEND_MODES, l.blend, (v) => app.edit('نمط الدمج', () => (l.blend = v)), { label: 'نمط الدمج', testid: 'blend' })
  );
  if (l.type === 'image') {
    body.append(
      propSlider(app, l, 'sx', { label: 'الحجم', min: 1, max: 400, step: 1, get: () => Math.round(Math.abs(l.sx) * 100), set: (v) => { const sgn = Math.sign(l.sx) || 1; const k = v / 100 / Math.abs(l.sx); l.sx = sgn * v / 100; l.sy *= k; }, unit: '٪', testid: 'scale' }),
      propSlider(app, l, 'rot', { label: 'الدوران', min: -180, max: 180, step: 1, get: () => Math.round((l.rot * 180) / Math.PI), set: (v) => (l.rot = (v * Math.PI) / 180), unit: '°', testid: 'rotate' }),
      h('div', { class: 'row-btns' },
        iconBtn('flip', 'قلب أفقي', () => app.edit('قلب', () => (l.sx = -l.sx)), { testid: 'flip' }),
        iconBtn('fit', 'ملاءمة', () => app.edit('ملاءمة', () => fitLayerToDoc(app, l, 'contain')), { testid: 'fit-layer' }),
        iconBtn('crop', 'تغطية', () => app.edit('تغطية', () => fitLayerToDoc(app, l, 'cover'))),
        iconBtn('reset', 'الحجم الأصلي', () => app.edit('إعادة الحجم', () => { l.sx = Math.sign(l.sx) || 1; l.sy = 1; l.rot = 0; }))
      ),
      h('div', { class: 'hint' }, `الأصل محفوظ بدقته الكاملة: ${l.src.width}×${l.src.height} بكسل (طبقة ذكية).`)
    );
  }
  return section('الطبقة', body, { id: 'basic' });
}

function docSection(app) {
  const d = app.doc;
  const color = h('input', { type: 'color', value: d.background || '#ffffff', 'aria-label': 'لون الخلفية' });
  color.addEventListener('change', () => app.edit('لون الخلفية', () => (d.background = color.value)));
  const body = h(
    'div',
    {},
    h('p', { class: 'hint' }, `مقاس اللوحة: ${d.width} × ${d.height} بكسل`),
    h('label', { class: 'field' }, h('span', {}, 'لون الخلفية'), color),
    toggle('خلفية شفافة', !d.background, (v) => app.edit('الخلفية', () => (d.background = v ? null : color.value))),
    h('p', { class: 'hint' }, 'اختر طبقة من لوحة الطبقات لعرض خصائصها.')
  );
  return section('اللوحة', body, { id: 'doc' });
}
