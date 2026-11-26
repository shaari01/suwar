// مساعدات بناء الواجهة
import { icon } from './icons.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** زر بأيقونة كبيرة ونص */
export function iconBtn(name, label, onClick, { cls = '', title, showLabel = true, testid } = {}) {
  return h(
    'button',
    { class: 'ibtn ' + cls, title: title || label, 'aria-label': label, onclick: onClick, 'data-testid': testid, type: 'button' },
    icon(name),
    showLabel ? h('span', { class: 'lbl' }, label) : null
  );
}

/** منزلق بقيمة ظاهرة.
 * باللمس: لا يتغير بمجرد مرور الإصبع أثناء تمرير القائمة. يتغير فقط بسحب أفقي واضح،
 * ويتحرك نسبيًا من قيمته الحالية (لا يقفز إلى مكان الإصبع)، بدقة أعلى من المنزلق العادي. */
export function slider({ label, min = 0, max = 100, step = 1, value = 0, onInput, onStart, onChange, unit = '', testid, fmt }) {
  const out = h('output', { class: 'sval' }, fmt ? fmt(value) : value + unit);
  const inp = h('input', { type: 'range', min, max, step, value, 'data-testid': testid, 'aria-label': label });
  let started = false;
  const begin = () => {
    if (!started) {
      started = true;
      onStart && onStart();
    }
  };
  inp.addEventListener('keydown', begin);
  inp.addEventListener('input', () => {
    begin();
    const v = parseFloat(inp.value);
    out.textContent = fmt ? fmt(v) : v + unit;
    onInput && onInput(v);
  });
  inp.addEventListener('change', () => {
    started = false;
    onChange && onChange(parseFloat(inp.value));
  });
  // طبقة لمس فوق المنزلق: تسمح بالتمرير العمودي، وتلتقط السحب الأفقي فقط
  const pad = h('div', { class: 'sl-touch' });
  let g = null;
  const setVal = (v) => {
    const st = parseFloat(inp.step) || 1;
    v = Math.min(+inp.max, Math.max(+inp.min, Math.round(v / st) * st));
    if (v === parseFloat(inp.value)) return;
    inp.value = String(+v.toFixed(4));
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  };
  pad.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, v0: parseFloat(inp.value), on: false, touch: e.pointerType !== 'mouse' };
    if (!g.touch) {
      // بالفأرة: سحب مباشر من القيمة الحالية
      g.on = true;
      pad.setPointerCapture(e.pointerId);
      begin();
    }
  });
  pad.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.on) {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { g = null; return; } // تمرير، لا تعديل
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      g.on = true;
      g.x = e.clientX;
      pad.setPointerCapture(e.pointerId);
      begin();
      return;
    }
    e.preventDefault();
    const w = inp.getBoundingClientRect().width || 200;
    const rtl = getComputedStyle(inp).direction === 'rtl';
    // نسبي من القيمة عند بدء السحب؛ عرض المنزلق ونصف = المدى كله، فالتحكم أدق
    setVal(g.v0 + ((rtl ? -dx : dx) / (w * 1.5)) * (+inp.max - +inp.min));
  });
  const end = (e) => {
    if (!g || e.pointerId !== g.id) return;
    const was = g.on;
    g = null;
    if (was) inp.dispatchEvent(new Event('change', { bubbles: true }));
  };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
  // لمستان سريعتان على المنزلق تعيدانه لقيمته الأولى
  const initial = value;
  pad.addEventListener('dblclick', () => {
    begin();
    setVal(initial);
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const track = h('div', { class: 'sl-track' }, inp, pad);
  const wrap = h('div', { class: 'slider' }, h('span', { class: 'slbl' }, label), out, track);
  wrap.set = (v) => {
    inp.value = v;
    out.textContent = fmt ? fmt(v) : v + unit;
  };
  wrap.input = inp;
  return wrap;
}

export function selectBox(options, value, onChange, { label, testid } = {}) {
  const s = h('select', { 'data-testid': testid, 'aria-label': label });
  for (const [v, t] of options) s.append(h('option', { value: v }, t));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return label ? h('label', { class: 'field' }, h('span', {}, label), s) : s;
}

export function toggle(label, checked, onChange, testid) {
  const inp = h('input', { type: 'checkbox', 'data-testid': testid });
  inp.checked = !!checked;
  inp.addEventListener('change', () => onChange(inp.checked));
  return h('label', { class: 'toggle' }, inp, h('span', {}, label));
}

// ---------- الحوارات ----------
let modalRoot = null;
function root() {
  if (!modalRoot) {
    modalRoot = h('div', { id: 'modals' });
    document.body.append(modalRoot);
  }
  return modalRoot;
}

/** نافذة حوار. buttons: [{label, value, primary}] */
export function modal(title, body, buttons = [{ label: 'إغلاق', value: null }], { wide = false, testid } = {}) {
  return new Promise((resolve) => {
    const close = (v) => {
      back.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
    };
    const btns = buttons.map((b) =>
      h('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), type: 'button', 'data-testid': b.testid, onclick: () => close(typeof b.value === 'function' ? b.value() : b.value) }, b.label)
    );
    const dlg = h(
      'div',
      { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'data-testid': testid },
      h('div', { class: 'mhead' }, h('h2', {}, title), iconBtn('x', 'إغلاق', () => close(null), { showLabel: false, cls: 'flat' })),
      h('div', { class: 'mbody' }, body),
      btns.length ? h('div', { class: 'mfoot' }, btns) : null
    );
    const back = h('div', { class: 'mback', onclick: (e) => e.target === back && close(null) }, dlg);
    dlg.close = close;
    body && (body.closeModal = close);
    root().append(back);
    document.addEventListener('keydown', onKey);
  });
}

export function confirmDialog(msg, { ok = 'نعم', cancel = 'إلغاء', danger = false } = {}) {
  return modal('تأكيد', h('p', {}, msg), [
    { label: cancel, value: false },
    { label: ok, value: true, primary: !danger, danger, testid: 'confirm-ok' }
  ]);
}

export function promptDialog(title, value = '', { placeholder = '' } = {}) {
  const inp = h('input', { type: 'text', value, placeholder, class: 'text', 'data-testid': 'prompt-input' });
  setTimeout(() => inp.focus(), 50);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') inp.closest('.modal').querySelector('.btn.primary').click();
  });
  return modal(title, inp, [
    { label: 'إلغاء', value: null },
    { label: 'موافق', value: () => inp.value, primary: true, testid: 'prompt-ok' }
  ]);
}

let toastBox = null;
export function toast(msg, { kind = 'info', ms = 3200 } = {}) {
  if (!toastBox) {
    toastBox = h('div', { id: 'toasts', 'aria-live': 'polite' });
    document.body.append(toastBox);
  }
  const t = h('div', { class: 'toast ' + kind }, msg);
  toastBox.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

/** مؤشر انتظار للعمليات الطويلة */
export function busy(msg) {
  const el = h('div', { class: 'busy', 'data-testid': 'busy' }, h('div', { class: 'spinner' }), h('div', { class: 'bmsg' }, msg));
  document.body.append(el);
  return {
    set: (m) => (el.querySelector('.bmsg').textContent = m),
    done: () => el.remove()
  };
}

export function pickFiles({ accept = 'image/*', multiple = true } = {}) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    inp.addEventListener('change', () => {
      resolve([...inp.files]);
      inp.remove();
    });
    document.body.append(inp);
    inp.click();
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 2000);
}
