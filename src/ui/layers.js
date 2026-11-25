// لوحة الطبقات: صور مصغرة وأقنعة ظاهرة بجانب كل طبقة
import { h, iconBtn, promptDialog, confirmDialog } from './dom.js';
import { icon } from './icons.js';
import { flattenForUi, LAYER_TYPE_LABEL } from '../core/doc.js';
import { mk, ctx2d } from '../core/canvas.js';
import { duplicateLayer, deleteLayer, moveLayer, groupLayer, ungroup, mergeDown, newBlankLayer } from '../core/ops.js';
import { rasterId } from '../core/util.js';

const thumbCache = new Map();

function thumbOf(canvas, key, size = 44, checker = true) {
  const k = key + ':' + size;
  if (thumbCache.has(k)) return thumbCache.get(k);
  const t = mk(size, size);
  const g = ctx2d(t);
  if (checker) {
    for (let y = 0; y < size; y += 6) for (let x = 0; x < size; x += 6) {
      g.fillStyle = ((x + y) / 6) % 2 ? '#ddd' : '#fff';
      g.fillRect(x, y, 6, 6);
    }
  } else {
    g.fillStyle = '#000';
    g.fillRect(0, 0, size, size);
  }
  const s = Math.min(size / canvas.width, size / canvas.height);
  const w = canvas.width * s;
  const hh = canvas.height * s;
  g.drawImage(canvas, (size - w) / 2, (size - hh) / 2, w, hh);
  if (thumbCache.size > 400) thumbCache.clear();
  thumbCache.set(k, t);
  return t;
}

function cloneThumb(c) {
  const t = mk(c.width, c.height);
  ctx2d(t).drawImage(c, 0, 0);
  t.className = 'thumb';
  return t;
}

export class LayersPanel {
  constructor(app, host) {
    this.app = app;
    this.el = h('div', { class: 'layers-panel', 'data-testid': 'layers-panel' });
    this.list = h('div', { class: 'layer-list', role: 'list' });
    this.foot = h(
      'div',
      { class: 'panel-foot' },
      iconBtn('plus', 'فارغة', () => app.addLayer(newBlankLayer(app), { label: 'طبقة فارغة' }), { testid: 'layer-new' }),
      iconBtn('copy', 'نسخ', () => duplicateLayer(app), { testid: 'layer-dup' }),
      iconBtn('group', 'تجميع', () => this.groupToggle(), { testid: 'layer-group' }),
      iconBtn('merge', 'دمج', () => mergeDown(app), { testid: 'layer-merge' }),
      iconBtn('trash', 'حذف', async () => {
        if (!app.selected) return;
        if (await confirmDialog(`حذف «${app.selected.name}»؟ يمكنك التراجع لاحقًا.`, { ok: 'حذف', danger: true })) deleteLayer(app);
      }, { testid: 'layer-del' })
    );
    this.el.append(this.list, this.foot);
    host.append(this.el);
    app.on('layers', () => this.queue());
    app.on('select', () => this.queue());
    app.on('rendered', () => this.queue(true));
  }

  groupToggle() {
    const l = this.app.selected;
    if (!l) return;
    if (l.type === 'group') ungroup(this.app);
    else groupLayer(this.app);
  }

  queue(thumbsOnly) {
    if (this._q) return;
    this._q = true;
    requestAnimationFrame(() => {
      this._q = false;
      this.render();
    });
  }

  layerThumb(l) {
    const app = this.app;
    if (l.type === 'image') {
      const p = app.renderer.processLayer(l);
      return cloneThumb(thumbOf(p.canvas, 'p' + app.renderer.layerKey(l) + rasterId(p.canvas)));
    }
    const box = h('div', { class: 'thumb ticon' });
    box.append(icon(l.type === 'group' ? 'open' : l.type === 'shadow' ? 'moon' : 'sliders', 24));
    return box;
  }

  maskThumb(l) {
    if (!l.mask) return null;
    const t = cloneThumb(thumbOf(l.mask, 'm' + rasterId(l.mask), 44, false));
    t.classList.add('mask-thumb');
    if (!l.maskOn) t.classList.add('off');
    t.title = 'القناع (اضغط للتفعيل/التعطيل)';
    t.addEventListener('click', (e) => {
      e.stopPropagation();
      this.app.edit(l.maskOn ? 'تعطيل القناع' : 'تفعيل القناع', () => (l.maskOn = !l.maskOn));
    });
    return t;
  }

  render() {
    const app = this.app;
    const rows = flattenForUi(app.doc.layers);
    this.list.replaceChildren();
    if (!rows.length) {
      this.list.append(h('div', { class: 'empty' }, 'لا توجد طبقات بعد. استورد صورة من زر «استيراد».'));
    }
    for (const { layer: l, depth } of rows) {
      const selected = l.id === app.doc.selectedId;
      const row = h(
        'div',
        {
          class: 'layer-row' + (selected ? ' sel' : '') + (l.visible ? '' : ' hidden'),
          role: 'listitem',
          'data-testid': 'layer-row',
          'data-id': l.id,
          style: { paddingInlineStart: 8 + depth * 18 + 'px' },
          onclick: () => app.select(l.id),
          ondblclick: async () => {
            const n = await promptDialog('اسم الطبقة', l.name);
            if (n) app.edit('إعادة تسمية', () => (l.name = n));
          }
        },
        h('button', {
          class: 'mini', type: 'button', title: l.visible ? 'إخفاء' : 'إظهار', 'aria-label': l.visible ? 'إخفاء' : 'إظهار', 'data-testid': 'layer-eye',
          onclick: (e) => {
            e.stopPropagation();
            app.edit(l.visible ? 'إخفاء' : 'إظهار', () => (l.visible = !l.visible));
          }
        }, icon(l.visible ? 'eye' : 'eyeOff', 22)),
        l.type === 'group'
          ? h('button', { class: 'mini', type: 'button', 'aria-label': 'فتح/طي', onclick: (e) => { e.stopPropagation(); l.open = !l.open; app.emit('layers'); } }, icon(l.open ? 'down' : 'left', 20))
          : null,
        this.layerThumb(l),
        this.maskThumb(l),
        h('div', { class: 'lname' }, h('div', { class: 'n' }, l.name), h('div', { class: 'sub' }, LAYER_TYPE_LABEL[l.type] + (l.opacity < 1 ? ` · ${Math.round(l.opacity * 100)}٪` : '') + (l.blend !== 'normal' ? ' · ' + l.blend : ''))),
        h('button', {
          class: 'mini' + (l.locked ? ' on' : ''), type: 'button', title: l.locked ? 'فك القفل' : 'قفل', 'aria-label': 'قفل', 'data-testid': 'layer-lock',
          onclick: (e) => {
            e.stopPropagation();
            app.edit(l.locked ? 'فك القفل' : 'قفل', () => (l.locked = !l.locked));
          }
        }, icon(l.locked ? 'lock' : 'unlock', 20)),
        selected
          ? h('div', { class: 'reorder' },
              h('button', { class: 'mini', type: 'button', 'aria-label': 'رفع', 'data-testid': 'layer-up', onclick: (e) => { e.stopPropagation(); moveLayer(app, l.id, +1); } }, icon('arrowUp', 20)),
              h('button', { class: 'mini', type: 'button', 'aria-label': 'خفض', 'data-testid': 'layer-down', onclick: (e) => { e.stopPropagation(); moveLayer(app, l.id, -1); } }, icon('arrowDown', 20)))
          : null
      );
      this.list.append(row);
    }
    const bg = h('div', { class: 'layer-row bgrow' }, h('div', { class: 'thumb', style: { background: app.doc.background || 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0/12px 12px' } }), h('div', { class: 'lname' }, h('div', { class: 'n' }, 'الخلفية'), h('div', { class: 'sub' }, app.doc.background ? app.doc.background : 'شفافة')));
    this.list.append(bg);
  }
}
