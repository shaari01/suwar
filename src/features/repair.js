// المرحلة 5: الترميم والختم والملء حسب المحتوى، والمنظور وPuppet Warp
import { registerStep } from '../core/render.js';
import { registerSection } from '../ui/props.js';
import { h, iconBtn } from '../ui/dom.js';
import { RetouchTool } from '../tools/retouch.js';
import { WarpTool, warpStep } from '../tools/warp.js';

export default {
  install({ app, toolDefs }) {
    app.registerTool('retouch', new RetouchTool());
    app.registerTool('warp', new WarpTool());
    toolDefs.push({ name: 'retouch', icon: 'heal', label: 'إصلاح', key: 'r' }, { name: 'warp', icon: 'spline', label: 'تشويه', key: 'w' });
    registerStep(warpStep());
    registerSection({
      id: 'repair',
      title: 'الإصلاح والتشويه',
      order: 40,
      when: (l) => l.type === 'image' && (l.retouch || l.warp),
      build: (l) => h('div', {},
        l.retouch ? h('div', { class: 'row-btns' },
          iconBtn('heal', 'إصلاحات محفوظة فوق الأصل', () => app.setTool('retouch')),
          iconBtn('reset', 'مسح الإصلاحات', () => app.edit('مسح الإصلاحات', () => (l.retouch = null)))) : null,
        l.warp ? h('div', { class: 'row-btns' },
          iconBtn('spline', l.warp.kind === 'perspective' ? 'منظور مطبّق' : `دبابيس: ${l.warp.pins.length}`, () => app.setTool('warp')),
          iconBtn('reset', 'إلغاء التشويه', () => app.edit('إلغاء التشويه', () => (l.warp = null)))) : null,
        h('p', { class: 'hint' }, 'الأصل محفوظ: الإصلاحات طبقة فوقه، والتشويه يُحسب عند العرض.'))
    });
  }
};
