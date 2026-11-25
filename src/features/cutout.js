// المرحلة 2: القص وتنقيح الحواف وتنظيف لون الحافة
import { registerStep } from '../core/render.js';
import { registerSection, propSlider } from '../ui/props.js';
import { h, iconBtn } from '../ui/dom.js';
import { CutTool } from '../tools/cut.js';
import { mk, getData, canvasToMask } from '../core/canvas.js';
import { refineAlpha, decontaminate, u8ToF32 } from '../img/mask.js';

const hasRefine = (r) => r && (r.radius || r.feather || r.contrast || r.shift || r.decontam);

export function refineStep(app) {
  return {
    name: 'refine',
    order: 50,
    key: (l) => (l.mask && l.maskOn && hasRefine(l.refine) && !app.fastPreview ? JSON.stringify(l.refine) : null),
    run(canvas, l, ctx) {
      const W = canvas.width;
      const H = canvas.height;
      const img = getData(canvas);
      const rgba = img.data;
      let m = l.mask;
      if (m.width !== W || m.height !== H) {
        const t = mk(W, H);
        t.getContext('2d').drawImage(m, 0, 0, W, H);
        m = t;
      }
      const alpha = u8ToF32(canvasToMask(m));
      const a = refineAlpha(alpha, rgba, W, H, l.refine);
      const out = l.refine.decontam > 0 ? decontaminate(rgba, a, W, H, l.refine.decontam / 100) : rgba;
      const res = new ImageData(W, H);
      const d = res.data;
      for (let i = 0, j = 0; i < a.length; i++, j += 4) {
        d[j] = out[j];
        d[j + 1] = out[j + 1];
        d[j + 2] = out[j + 2];
        d[j + 3] = rgba[j + 3] * a[i];
      }
      const c = mk(W, H);
      c.getContext('2d').putImageData(res, 0, 0);
      ctx.maskApplied = true;
      return c;
    }
  };
}

export default {
  install({ app, toolDefs }) {
    app.registerTool('cut', new CutTool());
    toolDefs.push({ name: 'cut', icon: 'cut', label: 'قص', key: 'c' });
    registerStep(refineStep(app));
    registerSection({
      id: 'refine',
      title: 'القناع وتنقيح الحواف',
      order: 20,
      when: (l) => l.type === 'image',
      build(l) {
        if (!l.mask) {
          return h('div', {}, h('p', { class: 'hint' }, 'لا يوجد قناع بعد. استخدم أداة «قص» ثم زر «اختر العنصر الرئيسي» أو الفرشاة.'),
            iconBtn('cut', 'افتح أداة القص', () => app.setTool('cut')));
        }
        const r = l.refine;
        const ps = (key, label, min, max, unit = '', testid) => propSlider(app, r, key, { label, min, max, unit, testid });
        return h('div', {},
          ps('radius', 'نصف قطر الحافة (ذكي)', 0, 40, ' بكسل', 'refine-radius'),
          ps('feather', 'النعومة', 0, 30, ' بكسل', 'refine-feather'),
          ps('contrast', 'التباين', 0, 100, '٪', 'refine-contrast'),
          ps('shift', 'إزاحة الحافة (− للداخل، + للخارج)', -100, 100, '', 'refine-shift'),
          ps('decontam', 'تنظيف لون الحافة', 0, 100, '٪', 'refine-decontam'),
          h('p', { class: 'hint' }, 'كل هذه الإعدادات غير إتلافية: القناع الأصلي والصورة محفوظان. لكشف بقايا الخلفية اختر «على أبيض» أو «على أسود» من شريط أداة القص.'),
          h('div', { class: 'row-btns' },
            iconBtn(l.maskOn ? 'eyeOff' : 'eye', l.maskOn ? 'تعطيل القناع' : 'تفعيل القناع', () => app.edit('القناع', () => (l.maskOn = !l.maskOn)), { testid: 'mask-toggle' }),
            iconBtn('reset', 'تصفير التنقيح', () => app.edit('تصفير التنقيح', () => Object.assign(r, { radius: 0, feather: 0, contrast: 0, shift: 0, decontam: 0 })))
          )
        );
      }
    });
    // نعيد رسم الخصائص بعد تغير القناع لإظهار قسم التنقيح
    let lastMask = null;
    app.on('props', () => {
      const l = app.selected;
      const m = l && l.mask;
      if ((m && !lastMask) || (!m && lastMask)) app.emit('props-refresh');
      lastMask = m;
    });
  }
};
